import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../../src/graph/knowledge-graph.js';
import { buildCommitPlan } from '../../../../src/agents/workflows/commit-plan.js';
import { runReviewLenses } from '../../../../src/agents/workflows/review-lenses.js';
import { assessRepository } from '../../../../src/agents/workflows/verification.js';
import type { RepositoryObservation } from '../../../../src/agents/workflows/conditions.js';
import type { WorkflowRepoRuntime } from '../../../../src/agents/workflows/repo-runtime.js';
import type { IndexTrustResult } from '../../../../src/storage/index-trust.js';
import {
  CHANGE_WORKFLOW_SCHEMA_VERSION,
  REVIEW_LENS_IDS,
  type ChangeWorkflowSession,
  type RepositoryBaseline,
  type WorkflowCapabilityId,
} from '../../../../src/agents/workflows/session-types.js';

const REPO = 'repo-1';

function observation(overrides: Partial<RepositoryObservation> = {}): RepositoryObservation {
  return {
    repositoryId: REPO,
    available: true,
    nodes: [],
    baseNodes: new Map(),
    headNodeIds: new Set(),
    relationships: [],
    headRelationships: { certainties: new Map() },
    contracts: { findings: [], consumerCoverageComplete: true },
    flows: { supported: true, deltas: [] },
    baseFlows: new Map(),
    headFlows: new Map(),
    cycles: { base: [], head: [] },
    security: { baseKeys: [], headKeys: [], nodeIdsByKey: new Map() },
    aliases: new Map(),
    coverage: { complete: true, examinedCount: 0, incompleteReasons: [] },
    ...overrides,
  };
}

function lensInput(capabilities: WorkflowCapabilityId[], obs = observation()) {
  return {
    repositoryId: REPO,
    repoDir: '/nonexistent',
    observation: obs,
    headGraph: createKnowledgeGraph(),
    changedNodeIds: [],
    changedFiles: [],
    unexpected: [],
    conditions: [],
    capabilities: new Set(capabilities),
  };
}

describe('review lenses', () => {
  it('report unavailable (never pass) when a required capability is missing', () => {
    const results = runReviewLenses([...REVIEW_LENS_IDS], lensInput([]));
    const byId = new Map(results.map((r) => [r.lensId, r]));
    for (const id of ['architecture', 'api', 'tests', 'security'] as const) {
      assert.equal(byId.get(id)?.status, 'unavailable', id);
      assert.ok(byId.get(id)?.reducedGuarantee, `${id} states the lost guarantee`);
      assert.equal(byId.get(id)?.coverage.complete, false);
    }
    assert.equal(byId.get('scope')?.status, 'pass', 'scope needs no optional capability');
    assert.equal(byId.get('change-risk')?.status, 'pass');
  });

  it('run in a stable order and are unavailable for an incomparable repository', () => {
    const ids = runReviewLenses(['scope', 'api', 'architecture'], lensInput(['api-contracts', 'structural-review'])).map((r) => r.lensId);
    assert.deepEqual(ids, ['api', 'architecture', 'scope']);
    const blocked = runReviewLenses(['scope'], lensInput([], observation({ available: false })));
    assert.equal(blocked[0]!.status, 'unavailable');
  });

  it('architecture fails on a new cycle; api fails on an unplanned break but not a planned one', () => {
    const arch = runReviewLenses(['architecture'], lensInput(['structural-review'], observation({ cycles: { base: [], head: ['a|b'] } })));
    assert.equal(arch[0]!.status, 'fail');
    const finding = { rule: 'response-field-removed' as const, verdict: 'breaking' as const, routeFactId: 'route:1', affectedConsumerFactIds: ['c1'], reason: 'x', boundaryReasons: [] };
    const obs = observation({ contracts: { findings: [finding], consumerCoverageComplete: true } });
    assert.equal(runReviewLenses(['api'], lensInput(['api-contracts'], obs))[0]!.status, 'fail');
    const planned = { ...lensInput(['api-contracts'], obs), conditions: [{ id: 'cond-1', kind: 'contract-expected-breaking' as const, repositoryId: REPO, contractId: 'route:1' }] };
    assert.equal(runReviewLenses(['api'], planned)[0]!.status, 'pass');
  });

  it('scope warns on every unplanned change', () => {
    const input = { ...lensInput([]), unexpected: [{ repositoryId: REPO, category: 'node' as const, key: 'fn:x', change: 'added', name: 'x' }] };
    const [scope] = runReviewLenses(['scope'], input);
    assert.equal(scope!.status, 'warn');
    assert.match(scope!.findings[0]!.message, /unplanned node added: x/);
  });
});

function session(): ChangeWorkflowSession {
  const at = '2026-10-01T00:00:00.000Z';
  return {
    schemaVersion: CHANGE_WORKFLOW_SCHEMA_VERSION,
    id: `wf_${'a'.repeat(32)}`,
    revision: 3,
    phase: 'review',
    createdAt: at,
    updatedAt: at,
    scope: { type: 'repo', repositoryId: REPO, repositoryName: 'shop', repoPath: '/tmp/shop' },
    taskFingerprint: 'f'.repeat(64),
    taskRetention: 'fingerprint-only',
    baselines: [{ repositoryId: REPO, repositoryName: 'shop', repoPath: '/tmp/shop', dirty: false, analyzer: {} }],
    selectedTargets: [],
    plan: {
      steps: [{
        id: 'step-1',
        title: 'Change computeTotal',
        category: 'required',
        repositories: [REPO],
        targets: [{ kind: 'symbol', id: 'fn:total', repositoryId: REPO, name: 'computeTotal', certainty: 'exact', source: 'user' }],
        expected: [],
        tests: [],
        reviewLenses: [],
        dependsOn: [],
        certainty: 'exact',
        boundaries: [],
      }],
      boundaries: [],
      contextFingerprints: [],
      truncated: false,
    },
    checkpoints: [],
    capabilities: { available: [], unavailable: [] },
    phaseHistory: [],
    latestVerification: {
      verifiedAt: at,
      outcome: 'passed',
      repositories: [],
      conditions: [],
      unexpected: [],
      lenses: [],
      changedFiles: ['src/checkout.ts', 'src/pricing.ts', 'tests/pricing.test.ts'],
      changedSymbols: [
        { repositoryId: REPO, id: 'fn:total', kind: 'function', change: 'changed', name: 'computeTotal', filePath: 'src/pricing.ts' },
        { repositoryId: REPO, id: 'fn:helper', kind: 'function', change: 'added', name: 'helper', filePath: 'src/checkout.ts' },
        { repositoryId: REPO, id: 'fn:test', kind: 'function', change: 'changed', name: 'testTotal', filePath: 'tests/pricing.test.ts' },
      ],
      counts: { plannedConditions: 0, satisfied: 0, unexpectedChanges: 0, changedNodes: 3, changedRelationships: 0, contractFindings: 0, flowDeltas: 0 },
      coverage: { complete: true, examinedCount: 3, incompleteReasons: [] },
      boundaries: [],
      truncated: false,
    },
  };
}

describe('commit plan', () => {
  it('groups changes per plan step, tests, then supporting changes — deterministically', () => {
    const a = buildCommitPlan(session(), '2026-10-02T00:00:00.000Z');
    const b = buildCommitPlan(structuredClone(session()), '2026-10-02T00:00:00.000Z');
    assert.deepEqual(a, b);
    assert.deepEqual(a.groups.map((g) => g.title), [
      'refactor(src): Change computeTotal',
      'test(tests): cover workflow changes',
      'feat(src): supporting changes',
    ]);
    assert.deepEqual(a.groups[0]!.files, ['src/pricing.ts']);
    assert.deepEqual(a.groups[2]!.files, ['src/checkout.ts']);
    assert.match(a.note, /does not stage, commit, rewrite history or push/);
  });

  it('returns an empty plan when nothing has been verified', () => {
    const s = session();
    delete s.latestVerification;
    assert.deepEqual(buildCommitPlan(s, 'now').groups, []);
  });
});

describe('workflow service never mutates Git', () => {
  it('contains no stage/commit/push/reset/checkout/rebase/merge/tag/rm invocation', () => {
    const dir = path.resolve(import.meta.dirname, '../../../../src/agents/workflows');
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.js'));
    assert.ok(files.length > 5);
    let gitCalls = 0;
    const mutating = /['"`](add|commit|push|reset|checkout|switch|rebase|merge|cherry-pick|revert|tag|rm|mv|stash|apply|am|restore|update-ref|branch)['"`]/;
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const call of source.matchAll(/execFile(?:Sync)?\(\s*['"]git['"]\s*,\s*\[([^\]]*)\]/g)) {
        assert.doesNotMatch(call[1]!, mutating, `${file} invokes a mutating git command: ${call[0]}`);
        gitCalls += 1;
      }
      for (const call of source.matchAll(/\bgit\([^,]+,\s*\[([^\]]*)\]/g)) {
        assert.doesNotMatch(call[1]!, mutating, `${file} invokes a mutating git command: ${call[0]}`);
      }
      gitCalls += [...source.matchAll(/\bgit\([^,]+,\s*\[/g)].length;
      assert.doesNotMatch(source, /\b(spawn|exec)(Sync)?\(\s*['"]git ['"]/, `${file} must not shell out to git with a command string`);
    }
    assert.ok(gitCalls >= 4, 'the scan must actually see the read-only git calls it is checking');
  });
});

describe('repository scope checks', () => {
  function trust(identityFingerprint: string, overrides: Partial<IndexTrustResult> = {}): IndexTrustResult {
    return {
      state: 'trusted', trusted: true, fresh: true, reasons: [], generationId: 'gen-2',
      metadata: { indexedAt: 'x', identityFingerprint, stats: { nodes: 0, edges: 0, files: 0, duration: 0 } },
      artifacts: {} as IndexTrustResult['artifacts'],
      ...overrides,
    };
  }
  function runtime(overrides: Partial<WorkflowRepoRuntime>): WorkflowRepoRuntime {
    return {
      verifyTrust: () => trust('id-1'),
      sourceChanges: () => ({ kind: 'unchanged', changedPaths: [], reason: '' }),
      loadGraph: async () => ({ graph: createKnowledgeGraph() }),
      gitHead: () => 'c2',
      gitBranch: () => 'main',
      gitIsAncestor: () => true,
      gitDirty: () => false,
      ...overrides,
    };
  }
  const baseline: RepositoryBaseline = { repositoryId: REPO, repositoryName: 'shop', repoPath: '/tmp/shop', commit: 'c1', branch: 'main', generationId: 'gen-1', dirty: false, analyzer: { identityFingerprint: 'id-1' } };

  it('fresh when HEAD advanced on the same branch and the index is current', () => {
    assert.equal(assessRepository(baseline, runtime({})).freshness.state, 'fresh');
  });
  it('blocked when the baseline commit is no longer an ancestor of HEAD (history rewritten/reset)', () => {
    const result = assessRepository(baseline, runtime({ gitIsAncestor: () => false }));
    assert.equal(result.freshness.state, 'blocked');
    assert.equal(result.boundaries[0]!.kind, 'head-diverged');
  });
  it('blocked when the canonical identity fingerprint changed (analyzer incompatible)', () => {
    const result = assessRepository(baseline, runtime({ verifyTrust: () => trust('id-2') }));
    assert.equal(result.freshness.state, 'blocked');
    assert.equal(result.boundaries[0]!.kind, 'analyzer-incompatible');
  });
  it('reindex-required when source changed since the index was published', () => {
    const result = assessRepository(baseline, runtime({ sourceChanges: () => ({ kind: 'changed', changedPaths: ['src/a.ts'], reason: '1 changed' }) }));
    assert.equal(result.freshness.state, 'reindex-required');
    assert.equal(result.boundaries[0]!.kind, 'stale-index');
  });
  it('unchanged when the same generation is still published', () => {
    assert.equal(assessRepository(baseline, runtime({ verifyTrust: () => trust('id-1', { generationId: 'gen-1' }) })).freshness.state, 'unchanged');
  });
  it('freshness that cannot be proven is reported, not assumed', () => {
    const result = assessRepository(baseline, runtime({ sourceChanges: () => ({ kind: 'unknown', changedPaths: [], reason: 'no commit' }) }));
    assert.equal(result.freshnessUnknown, true);
    assert.ok(result.boundaries.some((b) => b.kind === 'coverage-incomplete'));
  });
});
