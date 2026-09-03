import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  detectSourceChangeState,
  resolveAnalysisPlan,
  type SourceChangeState,
} from '../../../src/pipeline/analysis-plan.js';
import type { IndexMetadata } from '../../../src/storage/metadata.js';
import type { IndexSnapshot } from '../../../src/storage/index-snapshot.js';
import type { SemanticDelta } from '../../../src/incremental/semantic-delta.js';

function provenDelta(overrides: Partial<SemanticDelta> = {}): SemanticDelta {
  return {
    changedFiles: ['src/a.ts'],
    deletedFiles: [],
    addedFacts: [],
    removedFacts: [],
    changedFacts: [],
    bodyOnlyFiles: [],
    invalidatedReferences: [],
    invalidatedCallSites: [],
    invalidatedSymbols: [],
    affectedArtifacts: new Set(['graph', 'bm25']),
    requiresFullResolution: false,
    ...overrides,
  };
}

function fixture(vector = true): { root: string; snapshot: IndexSnapshot; metadata: IndexMetadata } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-plan-'));
  const dir = path.join(root, '.code-intel', 'generations', 'g1');
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ['graph.db', 'bm25.db', 'meta.json']) fs.writeFileSync(path.join(dir, file), file);
  if (vector) fs.writeFileSync(path.join(dir, 'vector.db'), 'vector');
  const snapshot: IndexSnapshot = {
    repositoryRoot: root, generationId: 'g1', generationDir: dir, legacy: false, manifestVersion: 2, manifest: null,
    graphDbPath: path.join(dir, 'graph.db'), bm25DbPath: path.join(dir, 'bm25.db'),
    vectorDbPath: path.join(dir, 'vector.db'), metadataPath: path.join(dir, 'meta.json'),
    semanticIndexPath: path.join(dir, 'semantic-index.json'),
  };
  const metadata: IndexMetadata = {
    indexedAt: new Date().toISOString(), schemaVersion: 8, indexVersion: 'v', parser: 'tree-sitter',
    embeddings: { enabled: true, status: 'ready', provider: 'test', model: 'test', dimension: 3 },
    stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
  };
  return { root, snapshot, metadata };
}

function gitFixture(): { root: string; metadata: IndexMetadata } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-plan-git-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const sourcePath = path.join(root, 'src', 'a.ts');
  fs.writeFileSync(sourcePath, 'export const value = 1;\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: root });
  const commitHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const metadata: IndexMetadata = {
    indexedAt: new Date().toISOString(), schemaVersion: 8, indexVersion: 'v', parser: 'tree-sitter',
    commitHash,
    lastAnalyzedMtimes: { 'src/a.ts': fs.statSync(sourcePath).mtimeMs },
    stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
  };
  return { root, metadata };
}

const unchanged: SourceChangeState = { kind: 'unchanged', changedPaths: [], reason: 'none' };
const changed: SourceChangeState = { kind: 'changed', changedPaths: ['src/a.ts'], reason: 'one change' };

describe('detectSourceChangeState', () => {
  it('ignores an untracked non-source file', () => {
    const value = gitFixture();
    try {
      fs.writeFileSync(path.join(value.root, 'status.json'), '{"state":"trusted"}\n');
      const state = detectSourceChangeState(value.root, value.metadata);
      assert.equal(state.kind, 'unchanged');
      assert.deepEqual(state.changedPaths, []);
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });

  it('detects an untracked supported source file', () => {
    const value = gitFixture();
    try {
      fs.writeFileSync(path.join(value.root, 'src', 'b.ts'), 'export const next = 2;\n');
      const state = detectSourceChangeState(value.root, value.metadata);
      assert.equal(state.kind, 'changed');
      assert.deepEqual(state.changedPaths, ['src/b.ts']);
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });
});

describe('resolveAnalysisPlan', () => {
  it('returns a true no-op for a healthy unchanged index', () => {
    const value = fixture();
    try {
      const plan = resolveAnalysisPlan({ args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source: unchanged });
      assert.equal(plan.mode, 'noop');
      assert.equal(plan.evolution, 'reuse');
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });

  it('seeds vector.db and metadata for a known source change with healthy vectors', () => {
    const value = fixture();
    try {
      const plan = resolveAnalysisPlan({ args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source: changed });
      assert.equal(plan.mode, 'publish');
      if (plan.mode !== 'publish') return;
      assert.equal(plan.graph, 'full');
      assert.equal(plan.vector, 'incremental');
      assert.deepEqual(plan.seedArtifacts, ['vector.db', 'meta.json']);
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });

  it('keeps the full rebuild fallback for a changed source even with a proven-complete candidate when the rollout gate is disabled', () => {
    const value = fixture();
    const previousEnv = process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'];
    try {
      process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'] = '0';
      const plan = resolveAnalysisPlan({
        args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source: changed,
        dependencyAwareDelta: provenDelta(),
      });
      assert.equal(plan.mode, 'publish');
      if (plan.mode !== 'publish') return;
      assert.equal(plan.graph, 'full');
      assert.equal(plan.bm25, 'full');
      assert.equal(plan.dependencyAwareCandidate, undefined);
    } finally {
      if (previousEnv === undefined) delete process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'];
      else process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'] = previousEnv;
      fs.rmSync(value.root, { recursive: true, force: true });
    }
  });

  it('publishes incrementally only when the rollout gate is enabled AND the candidate proves a complete closure', () => {
    const value = fixture();
    const previousEnv = process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'];
    try {
      process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'] = '1';

      const truncated = resolveAnalysisPlan({
        args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source: changed,
        dependencyAwareDelta: provenDelta({ requiresFullResolution: true, reason: 'closure truncated' }),
      });
      assert.equal(truncated.mode, 'publish');
      if (truncated.mode === 'publish') assert.equal(truncated.graph, 'full');

      const proven = resolveAnalysisPlan({
        args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source: changed,
        dependencyAwareDelta: provenDelta(),
      });
      assert.equal(proven.mode, 'publish');
      if (proven.mode !== 'publish') return;
      assert.equal(proven.graph, 'incremental');
      assert.equal(proven.bm25, 'incremental');
      assert.ok(proven.seedArtifacts.includes('graph.db'));
      assert.ok(proven.seedArtifacts.includes('semantic-index.json'));
      assert.deepEqual(proven.dependencyAwareCandidate, provenDelta());
    } finally {
      if (previousEnv === undefined) delete process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'];
      else process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'] = previousEnv;
      fs.rmSync(value.root, { recursive: true, force: true });
    }
  });

  it('keeps the full rebuild fallback when the change set touches a non-fact-based language, even with the gate enabled and a proven-complete candidate', () => {
    const value = fixture();
    const previousEnv = process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'];
    try {
      process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'] = '1';
      const plan = resolveAnalysisPlan({
        args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot,
        source: { kind: 'changed', changedPaths: ['src/a.ts', 'src/Service.java'], reason: 'two changes' },
        dependencyAwareDelta: provenDelta({ changedFiles: ['src/a.ts', 'src/Service.java'] }),
      });
      assert.equal(plan.mode, 'publish');
      if (plan.mode !== 'publish') return;
      assert.equal(plan.graph, 'full');
      assert.equal(plan.bm25, 'full');
      assert.equal(plan.dependencyAwareCandidate, undefined);
    } finally {
      if (previousEnv === undefined) delete process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'];
      else process.env['CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED'] = previousEnv;
      fs.rmSync(value.root, { recursive: true, force: true });
    }
  });

  it('preserves graph, BM25, and metadata while rebuilding a missing vector index', () => {
    const value = fixture(false);
    try {
      const plan = resolveAnalysisPlan({ args: ['analyze', '--embeddings'], metadata: value.metadata, snapshot: value.snapshot, source: unchanged });
      assert.equal(plan.mode, 'publish');
      if (plan.mode !== 'publish') return;
      assert.equal(plan.vector, 'full');
      assert.deepEqual(plan.seedArtifacts, ['graph.db', 'bm25.db', 'meta.json']);
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });

  it('selects full semantic reanalysis when identity fingerprint mismatches', () => {
    const value = fixture();
    try {
      value.metadata.identityFingerprint = 'symbol-identity-v1';
      const plan = resolveAnalysisPlan({ args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source: unchanged });
      assert.equal(plan.mode, 'publish');
      if (plan.mode !== 'publish') return;
      assert.equal(plan.evolution, 'full-reanalysis');
      assert.equal(plan.graph, 'full');
      assert.equal(plan.bm25, 'full');
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });

  it('selects full semantic reanalysis when resolver fingerprint mismatches', () => {
    const value = fixture();
    try {
      value.metadata.resolverVersion = 'resolver-v1';
      value.metadata.resolverFingerprint = 'resolver-fp-old';
      const plan = resolveAnalysisPlan({ args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source: unchanged });
      assert.equal(plan.mode, 'publish');
      if (plan.mode !== 'publish') return;
      assert.equal(plan.evolution, 'full-reanalysis');
      assert.equal(plan.graph, 'full');
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });

  it('selects full semantic reanalysis when fact or evidence fingerprints mismatch', () => {
    const value = fixture();
    try {
      value.metadata.factSchemaVersion = '1.0.10';
      value.metadata.evidenceSchemaVersion = 999;
      const plan = resolveAnalysisPlan({ args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source: unchanged });
      assert.equal(plan.mode, 'publish');
      if (plan.mode !== 'publish') return;
      assert.equal(plan.evolution, 'full-reanalysis');
      assert.equal(plan.graph, 'full');
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });

  it('selects full semantic reanalysis when the API-contract schema fingerprint mismatches', () => {
    const value = fixture();
    try {
      value.metadata.apiContractSchemaVersion = '1.0.10';
      value.metadata.apiContractFingerprint = 'api-contract-fp-old';
      const plan = resolveAnalysisPlan({ args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source: unchanged });
      assert.equal(plan.mode, 'publish');
      if (plan.mode !== 'publish') return;
      assert.equal(plan.evolution, 'full-reanalysis');
      assert.equal(plan.graph, 'full');
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });

  it('seeds existing artifacts and metadata conservatively when change scope is unknown', () => {
    const value = fixture();
    try {
      const source: SourceChangeState = { kind: 'unknown', changedPaths: [], reason: 'unknown' };
      const plan = resolveAnalysisPlan({ args: ['analyze'], metadata: value.metadata, snapshot: value.snapshot, source });
      assert.equal(plan.mode, 'publish');
      if (plan.mode !== 'publish') return;
      assert.deepEqual(plan.seedArtifacts, ['graph.db', 'bm25.db', 'vector.db', 'meta.json']);
    } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
  });
});
