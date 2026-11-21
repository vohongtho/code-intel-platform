import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  startWorkflow,
  workflowCheckpoint,
  workflowComplete,
  workflowStatus,
  workflowVerify,
  type ChangeWorkflowServiceDeps,
} from '../../src/agents/workflows/session-service.js';
import { defaultRepoRuntime, type WorkflowRepoRuntime } from '../../src/agents/workflows/repo-runtime.js';
import { verificationDigest } from '../../src/agents/workflows/verification.js';
import { WorkflowSessionError } from '../../src/agents/workflows/session-store.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');
const MARKER = 'zebra-unique-literal-4242';

function ensureDistTestsPackageJson() {
  const target = path.join(CORE_ROOT, 'dist-tests', 'package.json');
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), target);
}

function git(repoDir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim();
}

function write(repoDir: string, file: string, lines: string[]) {
  fs.mkdirSync(path.dirname(path.join(repoDir, file)), { recursive: true });
  fs.writeFileSync(path.join(repoDir, file), lines.join('\n') + '\n');
}

function makeRepo(home: string): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-int-'));
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'wf-fixture', private: true }));
  fs.writeFileSync(path.join(repoDir, '.gitignore'), '.code-intel/\nAGENTS.md\nCLAUDE.md\n');
  write(repoDir, 'src/pricing.ts', [
    'export function taxFor(amount: number): number {',
    '  return amount * 0.1;',
    '}',
    '',
    'export function computeTotal(amount: number): number {',
    `  const label = '${MARKER}';`,
    '  return amount + taxFor(amount) + label.length * 0;',
    '}',
  ]);
  write(repoDir, 'src/checkout.ts', [
    "import { computeTotal } from './pricing';",
    '',
    'export function checkout(amount: number): number {',
    '  return computeTotal(amount);',
    '}',
  ]);
  write(repoDir, 'tests/pricing.test.ts', [
    "import { computeTotal } from '../src/pricing';",
    '',
    'export function testComputeTotal(): boolean {',
    '  return computeTotal(10) === 11;',
    '}',
  ]);
  git(repoDir, 'init', '-q', '-b', 'main');
  git(repoDir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.');
  git(repoDir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  analyze(repoDir, home);
  return repoDir;
}

function analyze(repoDir: string, home: string) {
  ensureDistTestsPackageJson();
  const child = spawnSync(process.execPath, [CLI_MAIN, 'analyze', repoDir, '--skip-agents-md'], {
    cwd: CORE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', HOME: home, USERPROFILE: home },
    timeout: 180000,
  });
  if (child.status !== 0) throw new Error(`analyze failed (${child.status})\n${child.stdout}\n${child.stderr}`);
}

function sessionFiles(repoDir: string): string[] {
  const dir = path.join(repoDir, '.code-intel', 'workflows', 'sessions');
  return fs.readdirSync(dir).map((file) => path.join(dir, file));
}

describe('change workflow: plan -> external edit -> analyze -> verify', () => {
  let home: string;
  let repoDir: string;
  const deps: ChangeWorkflowServiceDeps = { homeDir: '' };

  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-home-'));
    deps.homeDir = home;
    repoDir = makeRepo(home);
  });
  after(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('refuses to start from a stale index so the baseline is always pinned to analyzed source', async () => {
    const scratch = makeRepo(home);
    try {
      fs.appendFileSync(path.join(scratch, 'src/pricing.ts'), 'export const late = 1;\n');
      await assert.rejects(
        startWorkflow({ task: 'change pricing', scope: { type: 'repo', repoDir: scratch } }, deps),
        (err: unknown) => err instanceof WorkflowSessionError && err.code === 'INDEX_NOT_READY',
      );
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('runs the full lifecycle with deterministic expected-vs-actual verification and no Git mutation', async () => {
    const gitBefore = { head: git(repoDir, 'rev-parse', 'HEAD'), log: git(repoDir, 'log', '--oneline'), staged: git(repoDir, 'diff', '--cached', '--name-only') };

    const started = await startWorkflow({ task: 'add a discount to computeTotal', scope: { type: 'repo', repoDir }, targets: ['computeTotal'] }, deps);
    const session = started.session;
    assert.equal(session.phase, 'ready-for-change');
    assert.equal(session.revision, 1);
    const required = session.plan.steps.filter((step) => step.category === 'required');
    assert.equal(required.length, 1);
    assert.equal(required[0]!.targets[0]!.name, 'computeTotal');
    assert.equal(required[0]!.certainty, 'exact');
    assert.ok(required[0]!.expected.some((c) => c.kind === 'node-modified'));
    assert.ok(session.plan.steps.some((step) => step.category === 'candidate' && step.title === 'Check callers of computeTotal'), 'exact callers are planned as candidates');
    assert.ok(session.plan.contextFingerprints.some((entry) => entry.targetId === required[0]!.targets[0]!.id));
    assert.equal(session.baselines.length, 1);
    assert.ok(session.baselines[0]!.artifact!.nodeCount > 0);
    assert.equal(session.baselines[0]!.branch, 'main');

    // Session state and baseline sidecar hold identities/fingerprints, never source text.
    for (const file of sessionFiles(repoDir)) {
      assert.ok(!fs.readFileSync(file, 'utf8').includes(MARKER), `${path.basename(file)} must not contain source text`);
    }

    // No edit yet: status keeps the session ready.
    const idle = await workflowStatus({ sessionId: session.id, repoDir }, deps);
    assert.equal(idle.session.phase, 'ready-for-change');
    assert.equal(idle.repositories![0]!.state, 'unchanged');

    // External edit (the workflow never edits source).
    write(repoDir, 'src/pricing.ts', [
      'export function taxFor(amount: number): number {',
      '  return amount * 0.1;',
      '}',
      '',
      'export function computeTotal(amount: number): number {',
      `  const label = '${MARKER}';`,
      '  const discounted = amount * 0.95;',
      '  return discounted + taxFor(discounted) + label.length * 0;',
      '}',
    ]);

    const stale = await workflowStatus({ sessionId: session.id, repoDir }, deps);
    assert.equal(stale.session.phase, 'reindex-required');
    const staleVerify = await workflowVerify({ sessionId: session.id, repoDir }, deps);
    assert.equal(staleVerify.session.latestVerification!.outcome, 'reindex-required');
    assert.deepEqual(staleVerify.session.latestVerification!.conditions, [], 'no semantic reasoning from a stale graph');

    analyze(repoDir, home);
    const verified = await workflowVerify({ sessionId: session.id, repoDir }, deps);
    const result = verified.session.latestVerification!;
    const nodeModified = result.conditions.find((c) => c.kind === 'node-modified' && c.conditionId === required[0]!.expected.find((e) => e.kind === 'node-modified')!.id);
    assert.equal(nodeModified?.status, 'satisfied', JSON.stringify(result.conditions, null, 2));
    assert.ok(result.changedSymbols.some((symbol) => symbol.name === 'computeTotal'));
    assert.ok(result.changedFiles.includes('src/pricing.ts'));
    assert.equal(result.outcome, 'passed', JSON.stringify({ conditions: result.conditions, lenses: result.lenses, coverage: result.coverage }, null, 2));
    assert.equal(verified.session.phase, 'review');
    assert.ok(result.lenses.some((lens) => lens.lensId === 'scope'));

    // Deterministic: re-verifying unchanged state yields an identical result.
    const again = await workflowVerify({ sessionId: session.id, repoDir }, deps);
    assert.equal(verificationDigest(again.session.latestVerification!), verificationDigest(result));

    // Optimistic concurrency: a stale client revision cannot overwrite the newer checkpoint.
    await assert.rejects(
      workflowCheckpoint({ sessionId: session.id, repoDir, expectedRevision: verified.session.revision, note: 'stale' }, deps),
      (err: unknown) => err instanceof WorkflowSessionError && err.code === 'REVISION_CONFLICT',
    );

    const completed = await workflowComplete({ sessionId: session.id, repoDir }, deps);
    assert.equal(completed.session.phase, 'complete');
    const plan = completed.session.commitPlan!;
    assert.ok(plan.groups.length > 0);
    assert.ok(plan.groups.some((group) => group.files.includes('src/pricing.ts')));
    assert.match(plan.note, /Suggestion only/);

    // Nothing in the lifecycle touched Git state.
    assert.equal(git(repoDir, 'rev-parse', 'HEAD'), gitBefore.head);
    assert.equal(git(repoDir, 'log', '--oneline'), gitBefore.log);
    assert.equal(git(repoDir, 'diff', '--cached', '--name-only'), gitBefore.staged);
    assert.ok(git(repoDir, 'status', '--porcelain').includes('src/pricing.ts'), 'the external edit stays an uncommitted working-tree change');
  });

  it('a signature change is partial (new canonical identity) until the agent restates the step', async () => {
    const scratch = makeRepo(home);
    try {
      const started = await startWorkflow({ task: 'add a discount parameter to computeTotal', scope: { type: 'repo', repoDir: scratch }, targets: ['computeTotal'] }, deps);
      const step = started.session.plan.steps.find((s) => s.category === 'required')!;
      const oldId = step.targets[0]!.id;
      const modified = step.expected.find((c) => c.kind === 'node-modified')!;
      write(scratch, 'src/pricing.ts', [
        'export function taxFor(amount: number): number {',
        '  return amount * 0.1;',
        '}',
        '',
        'export function computeTotal(amount: number, discount = 0): number {',
        '  return amount - discount + taxFor(amount - discount);',
        '}',
      ]);
      analyze(scratch, home);
      const first = await workflowVerify({ sessionId: started.session.id, repoDir: scratch }, deps);
      const partial = first.session.latestVerification!.conditions.find((c) => c.conditionId === modified.id)!;
      assert.equal(partial.status, 'partially-satisfied', partial.reason);
      assert.equal(first.session.latestVerification!.outcome, 'needs-revision', 'partial evidence never passes a required step');
      const newId = partial.evidenceRefs.find((ref) => ref.startsWith('node:added:'))!.split('->')[1]!;
      assert.notEqual(newId, oldId);

      const restated = await workflowCheckpoint({
        sessionId: started.session.id,
        repoDir: scratch,
        expectedRevision: first.session.revision,
        stepId: step.id,
        removeConditionIds: [modified.id],
        conditions: [{ kind: 'node-absent', nodeId: oldId }, { kind: 'node-exists', nodeId: newId }],
        note: 'signature change replaces the declaration',
      }, deps);
      assert.equal(restated.session.phase, 'needs-revision');
      const second = await workflowVerify({ sessionId: started.session.id, repoDir: scratch }, deps);
      const result = second.session.latestVerification!;
      assert.equal(result.outcome, 'passed', JSON.stringify({ conditions: result.conditions, lenses: result.lenses, coverage: result.coverage }, null, 2));
      assert.ok(!result.unexpected.some((change) => change.key === newId), 'the replacement is accounted for, not unplanned');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('flags an unexpected extra dependency (new import cycle) and refuses completion', async () => {
    const scratch = makeRepo(home);
    try {
      const started = await startWorkflow({ task: 'adjust checkout', scope: { type: 'repo', repoDir: scratch }, targets: ['checkout'] }, deps);
      write(scratch, 'src/checkout.ts', [
        "import { computeTotal } from './pricing';",
        '',
        'export function checkout(amount: number): number {',
        '  return computeTotal(amount) + 1;',
        '}',
      ]);
      // Unplanned: pricing now imports checkout, creating a cycle.
      fs.appendFileSync(path.join(scratch, 'src/pricing.ts'), "import { checkout } from './checkout';\nexport function loop(): number { return checkout(1); }\n");
      analyze(scratch, home);
      const verified = await workflowVerify({ sessionId: started.session.id, repoDir: scratch }, deps);
      const result = verified.session.latestVerification!;
      const structural = result.conditions.find((c) => c.kind === 'structural-rule-no-new-violation');
      assert.equal(structural?.status, 'unexpected-change', JSON.stringify(result.conditions, null, 2));
      assert.ok(result.unexpected.some((u) => u.name === 'loop'), 'unplanned symbol is reported');
      assert.equal(result.outcome, 'needs-revision');
      assert.equal(verified.session.phase, 'needs-revision');
      await assert.rejects(workflowComplete({ sessionId: started.session.id, repoDir: scratch }, deps), (err: unknown) => err instanceof WorkflowSessionError && err.code === 'INVALID_TRANSITION');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('detects a branch change as an explicit blocked boundary', async () => {
    const scratch = makeRepo(home);
    try {
      const started = await startWorkflow({ task: 'adjust checkout', scope: { type: 'repo', repoDir: scratch }, targets: ['checkout'] }, deps);
      git(scratch, 'checkout', '-q', '-b', 'other');
      const verified = await workflowVerify({ sessionId: started.session.id, repoDir: scratch }, deps);
      assert.equal(verified.session.latestVerification!.outcome, 'blocked');
      assert.ok(verified.session.latestVerification!.boundaries.some((b) => b.kind === 'branch-changed'));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('plans deterministically and records degraded capabilities explicitly', async () => {
    const a = await startWorkflow({ task: 'add a discount to computeTotal', scope: { type: 'repo', repoDir }, targets: ['computeTotal'] }, deps);
    const b = await startWorkflow({ task: 'add a discount to computeTotal', scope: { type: 'repo', repoDir }, targets: ['computeTotal'] }, deps);
    assert.notEqual(a.session.id, b.session.id);
    assert.deepEqual(b.session.plan, a.session.plan);
    assert.deepEqual(b.session.selectedTargets, a.session.selectedTargets);

    // No Explore and no stable flow identity: the plan still works from lower-level evidence.
    const runtime: WorkflowRepoRuntime = {
      ...defaultRepoRuntime,
      verifyTrust(dir) {
        const trust = defaultRepoRuntime.verifyTrust(dir);
        if (!trust.metadata?.compatibilityReceipt) return trust;
        return { ...trust, metadata: { ...trust.metadata, compatibilityReceipt: { ...trust.metadata.compatibilityReceipt, flowIdentityFingerprint: undefined } } };
      },
    };
    const degraded = await startWorkflow({ task: 'add a discount to computeTotal', scope: { type: 'repo', repoDir }, targets: ['computeTotal'], taskRetention: 'fingerprint-only' }, {
      ...deps,
      runtime,
      discover: async ({ graph, task, limit }) => ({ nodeIds: [...graph.allNodes()].filter((n) => task.includes(n.name)).slice(0, limit).map((n) => n.id), via: 'search', fallbackReason: 'explore disabled for test' }),
    });
    const unavailable = degraded.session.capabilities.unavailable.map((u) => u.capability);
    assert.ok(unavailable.includes('explore'));
    assert.ok(unavailable.includes('stable-flows'));
    assert.ok(degraded.session.capabilities.unavailable.every((u) => u.reducedGuarantee.length > 0));
    assert.ok(!degraded.session.plan.steps.some((step) => step.expected.some((c) => c.kind === 'flow-preserved')), 'no fabricated flow evidence');
    assert.ok(degraded.session.plan.steps.some((step) => step.category === 'required'), 'symbol-level planning still works');
    assert.equal(degraded.session.taskSummary, undefined);
    assert.equal(degraded.session.taskRetention, 'fingerprint-only');
  });
});
