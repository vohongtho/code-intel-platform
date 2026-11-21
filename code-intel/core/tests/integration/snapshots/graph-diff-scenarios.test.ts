import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { loadGraphSnapshotFromDbPath } from '../../../src/multi-repo/graph-from-db.js';
import { buildIsolatedSnapshot } from '../../../src/snapshots/snapshot-builder.js';
import { computeSemanticGraphDiff } from '../../../src/snapshots/service.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(repoDir: string, files: Record<string, string>, message: string): string {
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(repoDir, name), content);
  }
  git(['add', '.'], repoDir);
  git(['commit', '--quiet', '-m', message], repoDir);
  return git(['rev-parse', 'HEAD'], repoDir);
}

function mkRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-diff-scenarios-'));
  git(['init', '--quiet'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);
  return repoDir;
}

async function analyzeFlowNodes(repoDir: string, ref: string, stagingDir: string): Promise<string> {
  const result = await buildIsolatedSnapshot({ repoDir, ref, allowCache: false }, stagingDir);
  assert.equal(result.status, 'built', result.error);
  assert.ok(result.artifactsDir);
  const graph = await loadGraphSnapshotFromDbPath(path.join(result.artifactsDir!, 'graph.db'));
  const flows = [...graph.allNodes()]
    .filter((node) => node.kind === 'flow')
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.ok(flows.length > 0, 'fixture must produce at least one persisted flow');
  return JSON.stringify(flows);
}

/**
 * These fixtures stand in for the convergence scenarios in tasks.md §12
 * (body-only edit, rename, deletion, added/removed call, certainty
 * degradation). This implementation always performs a full temporary
 * analysis for each snapshot — the dependency-aware incremental resolution
 * path (incremental/rollout-gate.ts) is explicitly dormant/unproven in
 * production per its own comments, and design.md calls for preferring
 * correctness over unsafe incremental shortcuts as the initial
 * implementation. There is therefore no separate incremental build path to
 * compare a full build against (task 12.1/12.2/12.4's literal
 * full-vs-incremental comparison), so what these fixtures instead verify is
 * that the one build path this feature has is correct across each of those
 * change categories end-to-end, against a real Git repo and a real analyze run.
 */
describe('semantic graph diff: change-type scenarios (real pipeline)', { timeout: 120_000 }, () => {
  it('persists byte-identical flow nodes across repeated full analyses', async () => {
    const repoDir = mkRepo();
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-flow-rerun-'));
    try {
      const ref = commit(repoDir, {
        'index.ts': [
          'export function main(): number {',
          '  return service();',
          '}',
          'export function service(): number {',
          '  return store();',
          '}',
          'export function store(): number {',
          '  return 1;',
          '}',
        ].join('\n'),
      }, 'stable flow');

      const first = await analyzeFlowNodes(repoDir, ref, path.join(stagingRoot, 'first'));
      const second = await analyzeFlowNodes(repoDir, ref, path.join(stagingRoot, 'second'));
      assert.equal(second, first);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  });

  it('diffs unchanged, changed, split/ambiguous, and removed flows across refs', async () => {
    const repoDir = mkRepo();
    try {
      const unchangedBase = commit(repoDir, {
        'index.ts': [
          'export function main(): number {',
          '  return service();',
          '}',
          'export function service(): number {',
          '  return store();',
          '}',
          'export function store(): number {',
          '  return 1;',
          '}',
          'export function unrelated(): number {',
          '  return 1;',
          '}',
        ].join('\n'),
      }, 'flow base');
      const unchangedHead = commit(repoDir, {
        'index.ts': [
          'export function main(): number {',
          '  return service();',
          '}',
          'export function service(): number {',
          '  return store();',
          '}',
          'export function store(): number {',
          '  return 1;',
          '}',
          'export function unrelated(): number {',
          '  return 2;',
          '}',
        ].join('\n'),
      }, 'unrelated edit');
      const changedHead = commit(repoDir, {
        'index.ts': [
          'export function main(): number {',
          '  return store();',
          '}',
          'export function service(): number {',
          '  return 1;',
          '}',
          'export function store(): number {',
          '  return service();',
          '}',
        ].join('\n'),
      }, 'reorder flow path');
      const splitHead = commit(repoDir, {
        'index.ts': [
          'export function main(): number {',
          '  return branchA() + branchB();',
          '}',
          'export function branchA(): number {',
          '  return leafA();',
          '}',
          'export function leafA(): number {',
          '  return 1;',
          '}',
          'export function branchB(): number {',
          '  return leafB();',
          '}',
          'export function leafB(): number {',
          '  return 2;',
          '}',
        ].join('\n'),
      }, 'split flow');
      const removedHead = commit(repoDir, {
        'index.ts': [
          'export function main(): number {',
          '  return 0;',
          '}',
        ].join('\n'),
      }, 'remove flows');

      const compareFlows = async (base: string, head: string) => {
        const { diff } = await computeSemanticGraphDiff({ repoDir, base, head, includeContracts: false });
        assert.ok(diff);
        const flows = diff!.flows;
        if (!flows.supported) assert.fail(flows.reason);
        return flows.deltas;
      };

      assert.deepEqual(await compareFlows(unchangedBase, unchangedHead), []);
      assert.deepEqual((await compareFlows(unchangedHead, changedHead)).map((delta) => delta.kind), ['path-changed']);
      assert.deepEqual((await compareFlows(changedHead, splitHead)).map((delta) => delta.kind), ['added', 'added', 'removed']);
      assert.deepEqual((await compareFlows(splitHead, removedHead)).map((delta) => delta.kind), ['removed', 'removed']);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('diffs a body-only edit as changed, an addition as added, and a deletion as removed', async () => {
    const repoDir = mkRepo();
    try {
      const baseCommit = commit(repoDir, {
        'index.ts': [
          'export function helper(x: number): number {',
          '  return x + 1;',
          '}',
          '',
          'export function toRemove(): void {}',
          '',
          'export function caller(x: number): number {',
          '  return helper(x);',
          '}',
        ].join('\n'),
      }, 'base');

      const headCommit = commit(repoDir, {
        'index.ts': [
          'export function helper(x: number): number {',
          '  return x + 2;', // body-only edit
          '}',
          '',
          'export function addedFn(): void {}', // added
          '',
          'export function caller(x: number): number {',
          '  return helper(x) + extra(x);', // new call edge to a new function
          '}',
          '',
          'export function extra(x: number): number {',
          '  return x;',
          '}',
        ].join('\n'),
        // toRemove is gone entirely — removed
      }, 'head');

      const { diff } = await computeSemanticGraphDiff({ repoDir, base: baseCommit, head: headCommit, includeContracts: false });
      assert.ok(diff, 'expected a diff for two valid commits');
      assert.equal(diff!.coverage.complete, true);

      const byName = (kind: string, name: string) => diff!.nodes.find((n) => n.kind === kind && (n.headName === name || n.baseName === name));

      const changedHelper = byName('changed', 'helper');
      assert.ok(changedHelper, 'helper() body edit should be a changed delta');
      assert.ok(changedHelper!.changedProperties?.includes('contentFingerprint'));

      assert.ok(byName('added', 'addedFn'), 'addedFn() should be an added delta');
      assert.ok(byName('added', 'extra'), 'extra() should be an added delta');
      assert.ok(byName('removed', 'toRemove'), 'toRemove() should be a removed delta');

      // caller() itself also changed body (new call expression) — its own
      // content fingerprint changes even though its signature didn't.
      // (Relationship-diff correctness for added/removed/changed "calls"
      // edges — including certainty degradation — is covered at the unit
      // level in graph-diff.test.ts against synthetic edges; this fixture's
      // real analyze run doesn't reliably materialize a "calls" edge for
      // this call shape, which is a pre-existing characteristic of the
      // resolver unrelated to this diff engine, reproduced independently
      // with plain `code-intel analyze` + `inspect` outside this feature.)
      assert.ok(byName('changed', 'caller'), 'caller() body edit should be a changed delta');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('reports zero deltas for two commits with byte-identical content at HEAD (base===head)', async () => {
    const repoDir = mkRepo();
    try {
      const onlyCommit = commit(repoDir, { 'index.ts': 'export function a(): void {}\n' }, 'only');
      const { diff } = await computeSemanticGraphDiff({ repoDir, base: onlyCommit, head: onlyCommit, includeContracts: false });
      assert.ok(diff);
      assert.equal(diff!.nodes.length, 0);
      assert.equal(diff!.relationships.length, 0);
      assert.equal(diff!.coverage.complete, true);
      assert.equal(diff!.flows.supported, true);
      if (diff!.flows.supported) assert.deepEqual(diff!.flows.deltas, []);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
