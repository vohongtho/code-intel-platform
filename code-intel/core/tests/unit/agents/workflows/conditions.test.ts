import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph, type KnowledgeGraph } from '../../../../src/graph/knowledge-graph.js';
import { projectFactBundle } from '../../../../src/semantic/graph-projector.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../../src/semantic/fact-bundle.js';
import { expressFrameworkAdapter } from '../../../../src/frameworks/adapters/express.js';
import { fetchConsumerAdapter } from '../../../../src/semantic/api-contracts/consumers/fetch.js';
import { collectGraphFacts, getApiDrift } from '../../../../src/semantic/api-contracts/service.js';
import { captureBaseline, rehydrateApiGraph } from '../../../../src/agents/workflows/baseline.js';
import {
  collectUnexpectedChanges,
  regradeWithCrossRepoConsumers,
  conditionId,
  evaluateCondition,
  evaluateConditions,
  type RepositoryObservation,
} from '../../../../src/agents/workflows/conditions.js';
import type {
  ConditionStatus,
  ExpectedSemanticCondition,
  ExpectedSemanticConditionInput,
} from '../../../../src/agents/workflows/session-types.js';
import type { NormalizedNode } from '../../../../src/snapshots/normalizer.js';

const REPO = 'repo-1';

function cond(input: ExpectedSemanticConditionInput): ExpectedSemanticCondition {
  return { ...input, id: conditionId(input) } as ExpectedSemanticCondition;
}

function node(id: string, fingerprint?: string): NormalizedNode {
  return { id, kind: 'function', properties: { name: id, filePath: 'src/a.ts', startLine: 1, contentFingerprint: fingerprint } };
}

function observation(overrides: Partial<RepositoryObservation> = {}): RepositoryObservation {
  return {
    repositoryId: REPO,
    available: true,
    nodes: [],
    baseNodes: new Map([['fn:a', node('fn:a', 'h1')], ['fn:b', node('fn:b', 'h2')]]),
    headNodeIds: new Set(['fn:a', 'fn:b']),
    relationships: [],
    headRelationships: { certainties: new Map() },
    contracts: { findings: [], consumerCoverageComplete: true },
    flows: { supported: true, deltas: [] },
    baseFlows: new Map([['flow:1', { flowId: 'flow:1', entryPointId: 'fn:a', stepCanonicalIds: ['fn:a', 'fn:b'], callSiteIds: [] }]]),
    headFlows: new Map([['flow:1', { flowId: 'flow:1', entryPointId: 'fn:a', stepCanonicalIds: ['fn:a', 'fn:b'], callSiteIds: [] }]]),
    tests: new Map(),
    cycles: { base: [], head: [] },
    security: { baseKeys: [], headKeys: [], nodeIdsByKey: new Map() },
    aliases: new Map(),
    coverage: { complete: true, examinedCount: 0, incompleteReasons: [] },
    ...overrides,
  };
}

function status(condition: ExpectedSemanticCondition, obs: RepositoryObservation | undefined): ConditionStatus {
  return evaluateCondition(condition, obs).status;
}

describe('expected condition evaluator', () => {
  it('derives stable condition IDs from content, independent of description and key order', () => {
    const a = conditionId({ kind: 'node-modified', repositoryId: REPO, nodeId: 'fn:a' });
    const b = conditionId({ nodeId: 'fn:a', repositoryId: REPO, kind: 'node-modified', description: 'x' } as ExpectedSemanticConditionInput);
    assert.equal(a, b);
    assert.notEqual(a, conditionId({ kind: 'node-modified', repositoryId: REPO, nodeId: 'fn:b' }));
  });

  it('node-modified: changed body satisfies, position-only shift does not, removal is unexpected', () => {
    const c = cond({ kind: 'node-modified', repositoryId: REPO, nodeId: 'fn:a' });
    assert.equal(status(c, observation({ nodes: [{ kind: 'changed', nodeKind: 'function', baseId: 'fn:a', headId: 'fn:a', changedProperties: ['contentFingerprint'] }] })), 'satisfied');
    assert.equal(status(c, observation({ nodes: [{ kind: 'changed', nodeKind: 'function', baseId: 'fn:a', headId: 'fn:a', changedProperties: ['startLine', 'endLine'] }] })), 'not-observed');
    assert.equal(status(c, observation({ nodes: [{ kind: 'removed', nodeKind: 'function', baseId: 'fn:a' }] })), 'unexpected-change');
    assert.equal(status(c, observation()), 'not-observed');
  });

  it('node-modified without a baseline content fingerprint is unknown, never satisfied or not-observed', () => {
    const c = cond({ kind: 'node-modified', repositoryId: REPO, nodeId: 'fn:a' });
    assert.equal(status(c, observation({ baseNodes: new Map([['fn:a', node('fn:a')]]) })), 'unknown');
  });

  it('identity-change: proven rename satisfies; ambiguous continuity is unknown', () => {
    const c = cond({ kind: 'identity-change', repositoryId: REPO, nodeId: 'fn:a', change: 'renamed' });
    assert.equal(status(c, observation({ nodes: [{ kind: 'renamed', nodeKind: 'function', baseId: 'fn:a', headId: 'fn:a2', continuity: { certainty: 'proven', reason: 'fp', evidenceKinds: ['content-fingerprint'] } }] })), 'satisfied');
    assert.equal(status(c, observation({ nodes: [{ kind: 'moved', nodeKind: 'function', baseId: 'fn:a', headId: 'fn:a2', continuity: { certainty: 'proven', reason: 'fp', evidenceKinds: [] } }] })), 'partially-satisfied');
    assert.equal(status(c, observation({ nodes: [{ kind: 'removed', nodeKind: 'function', baseId: 'fn:a', continuity: { certainty: 'candidate', reason: 'ambiguous', evidenceKinds: [] }, continuityCandidates: ['fn:x', 'fn:y'] }] })), 'unknown');
    assert.equal(status(c, observation({ nodes: [{ kind: 'removed', nodeKind: 'function', baseId: 'fn:a' }] })), 'unexpected-change');
  });

  it('node-absent / node-exists follow the current index', () => {
    const absent = cond({ kind: 'node-absent', repositoryId: REPO, nodeId: 'fn:a' });
    assert.equal(status(absent, observation()), 'not-observed');
    assert.equal(status(absent, observation({ headNodeIds: new Set(['fn:b']), nodes: [{ kind: 'removed', nodeKind: 'function', baseId: 'fn:a' }] })), 'satisfied');
    const exists = cond({ kind: 'node-exists', repositoryId: REPO, nodeId: 'fn:new' });
    assert.equal(status(exists, observation({ headNodeIds: new Set(['fn:a', 'fn:b', 'fn:new']), nodes: [{ kind: 'added', nodeKind: 'function', headId: 'fn:new' }] })), 'satisfied');
    assert.equal(status(exists, observation()), 'not-observed');
  });

  it('relationship-exists only satisfies with exact evidence', () => {
    const c = cond({ kind: 'relationship-exists', repositoryId: REPO, sourceId: 'fn:a', targetId: 'fn:b', edgeKind: 'calls' });
    assert.equal(status(c, observation({ headRelationships: { certainties: new Map([['fn:a::calls::fn:b', ['exact']]]) } })), 'satisfied');
    assert.equal(status(c, observation({ headRelationships: { certainties: new Map([['fn:a::calls::fn:b', ['heuristic']]]) } })), 'partially-satisfied');
    assert.equal(status(c, observation()), 'not-observed');
  });

  it('flow conditions are blocked (not satisfied) when stable flow identity is unavailable', () => {
    const preserved = cond({ kind: 'flow-preserved', repositoryId: REPO, flowId: 'flow:1' });
    assert.equal(status(preserved, observation()), 'satisfied');
    assert.equal(status(preserved, observation({ headFlows: new Map() })), 'unexpected-change');
    assert.equal(status(preserved, observation({ flows: { supported: false, reason: 'no stable flows' } })), 'blocked');
  });

  it('structural and security guardrails flag only new violations', () => {
    const cycles = cond({ kind: 'structural-rule-no-new-violation', repositoryId: REPO, rule: 'no-new-cycles' });
    assert.equal(status(cycles, observation({ cycles: { base: ['a|b'], head: ['a|b'] } })), 'satisfied');
    assert.equal(status(cycles, observation({ cycles: { base: [], head: ['a|b'] } })), 'unexpected-change');
    assert.equal(status(cycles, observation({ cycles: undefined })), 'blocked');
    const security = cond({ kind: 'security-no-new-finding', repositoryId: REPO, nodeIds: ['fn:b'] });
    const key = 'SQL_INJECTION\u0000src/a.ts\u0000fn:a';
    assert.equal(status(security, observation({ security: { baseKeys: [], headKeys: [key], nodeIdsByKey: new Map([[key, 'fn:a']]) } })), 'satisfied', 'out-of-scope finding is ignored');
    assert.equal(status(security, observation({ security: { baseKeys: [], headKeys: [key], nodeIdsByKey: new Map([[key, 'fn:b']]) } })), 'unexpected-change');
  });

  it('test evidence: incomplete coverage is unknown, candidate-only is partial', () => {
    const c = cond({ kind: 'test-evidence-present', repositoryId: REPO, nodeId: 'fn:a' });
    const coverage = { complete: false, examinedCount: 1, incompleteReasons: ['x'] };
    assert.equal(status(c, observation({ tests: new Map([['fn:a', { evidence: [{ kind: 'direct', certainty: 'exact', boundaries: [], testId: 't1' }], coverage }]]) })), 'satisfied');
    assert.equal(status(c, observation({ tests: new Map([['fn:a', { evidence: [{ kind: 'candidate', certainty: 'heuristic', boundaries: [] }], coverage }]]) })), 'partially-satisfied');
    assert.equal(status(c, observation({ tests: new Map([['fn:a', { evidence: [{ kind: 'unknown', certainty: 'lower-bound', boundaries: [] }], coverage, missingTestFinding: { definitive: false, reason: 'incomplete' } }]]) })), 'unknown');
    assert.equal(status(c, observation({ tests: undefined })), 'blocked');
  });

  it('a planned cross-repo consumer update with partial coverage is never satisfied', () => {
    const c = cond({ kind: 'consumer-updated', repositoryId: REPO, contractId: 'contract:1', consumerIds: ['c1', 'c2'] });
    assert.equal(status(c, observation({ consumers: { states: new Map([['c1', 'updated'], ['c2', 'updated']]), coverageComplete: true } })), 'satisfied');
    assert.equal(status(c, observation({ consumers: { states: new Map([['c1', 'updated'], ['c2', 'updated']]), coverageComplete: false } })), 'partially-satisfied');
    assert.equal(status(c, observation({ consumers: { states: new Map([['c1', 'updated']]), coverageComplete: true } })), 'unknown');
    assert.equal(status(c, observation({ consumers: undefined })), 'blocked');
    assert.equal(status(c, undefined), 'blocked');
  });

  it('INVARIANT: unknown / partial / unavailable evidence never upgrades to satisfied', () => {
    const conditions: ExpectedSemanticCondition[] = [
      cond({ kind: 'node-exists', repositoryId: REPO, nodeId: 'fn:a' }),
      cond({ kind: 'node-modified', repositoryId: REPO, nodeId: 'fn:a' }),
      cond({ kind: 'identity-change', repositoryId: REPO, nodeId: 'fn:a', change: 'renamed-or-moved' }),
      cond({ kind: 'contract-compatible', repositoryId: REPO, contractId: 'route:1' }),
      cond({ kind: 'contract-expected-breaking', repositoryId: REPO, contractId: 'route:1' }),
      cond({ kind: 'consumer-updated', repositoryId: REPO, contractId: 'route:1', consumerIds: ['c1'] }),
      cond({ kind: 'flow-preserved', repositoryId: REPO, flowId: 'flow:1' }),
      cond({ kind: 'test-evidence-present', repositoryId: REPO, nodeId: 'fn:a' }),
      cond({ kind: 'structural-rule-no-new-violation', repositoryId: REPO, rule: 'no-new-cycles' }),
      cond({ kind: 'security-no-new-finding', repositoryId: REPO, nodeIds: [] }),
    ];
    const degraded: RepositoryObservation[] = [
      observation({ available: false, unavailableReason: 'stale' }),
      observation({
        contracts: { findings: [], consumerCoverageComplete: false },
        consumers: { states: new Map([['c1', 'unknown']]), coverageComplete: false },
        flows: { supported: false, reason: 'no stable flows' },
        tests: new Map([['fn:a', { evidence: [{ kind: 'unknown', certainty: 'lower-bound', boundaries: [] }], coverage: { complete: false, examinedCount: 0, incompleteReasons: ['x'] }, missingTestFinding: { definitive: false, reason: 'incomplete' } }]]),
        cycles: undefined,
        security: undefined,
        baseNodes: new Map([['fn:a', node('fn:a')]]),
        nodes: [{ kind: 'removed', nodeKind: 'function', baseId: 'fn:a', continuity: { certainty: 'candidate', reason: 'ambiguous', evidenceKinds: [] }, continuityCandidates: ['fn:x'] }],
        headNodeIds: new Set(),
      }),
    ];
    for (const obs of degraded) {
      for (const evaluation of evaluateConditions(conditions, new Map([[REPO, obs]]))) {
        assert.notEqual(evaluation.status, 'satisfied', `${evaluation.kind} must not be satisfied under degraded evidence (${evaluation.reason})`);
      }
    }
  });
});

// ─── Intentional breaking API change vs unexpected break (real fixtures) ─────

function graphFromSource(source: string): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  const filePath = 'src/app.js';
  const view = { workspaceRoot: '/repo', filePaths: [filePath], fileCache: new Map([[filePath, source]]) };
  const routeBundle = expressFrameworkAdapter.extract(view);
  const consumerBundle = fetchConsumerAdapter.extract(view);
  const merged = createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: routeBundle.schema.language, adapterId: 'test' },
    facts: [...routeBundle.facts, ...consumerBundle.facts],
    diagnostics: [],
  });
  const { nodes, edges } = projectFactBundle(merged);
  for (const n of nodes) graph.addNode(n);
  for (const e of edges) graph.addEdge(e);
  return graph;
}

const SERVER = (fields: string) => [
  "const express = require('express');",
  'const app = express();',
  "app.get('/users/:id', getUser);",
  'function getUser(req, res) {',
  `  res.status(200).json({ ${fields} });`,
  '}',
].join('\n');
const CLIENT = [
  'async function loadUser(id) {',
  '  const response = await fetch(`/users/${id}`);',
  '  const body = await response.json();',
  '  return body.ssn;',
  '}',
].join('\n');

function contractObservation(baseSource: string, headSource: string) {
  const base = graphFromSource(baseSource);
  const head = graphFromSource(headSource);
  // Route through the baseline sidecar projection to prove it preserves contract facts.
  const payload = captureBaseline({ repositoryId: REPO, graph: base, repoDir: '/nonexistent', normalized: { nodesById: new Map(), edgesByKey: new Map() } });
  const drift = getApiDrift(rehydrateApiGraph(payload), head, REPO);
  const routeFactId = collectGraphFacts(base).routes[0]!.factId;
  return { routeFactId, obs: observation({ contracts: { findings: drift.findings, consumerCoverageComplete: drift.coverage.consumerCoverageComplete } }) };
}

describe('API contract conditions on real Express/fetch fixtures', () => {
  const base = `${SERVER("id: req.params.id, name: 'x', ssn: '000'")}\n${CLIENT}`;
  const breakingHead = `${SERVER("id: req.params.id, name: 'x'")}\n${CLIENT}`;
  const compatibleHead = `${SERVER("id: req.params.id, name: 'x', ssn: '000', email: 'e'")}\n${CLIENT}`;

  it('intentional breaking change: expected-breaking is satisfied and the change is not unexpected', () => {
    const { routeFactId, obs } = contractObservation(base, breakingHead);
    const expected = cond({ kind: 'contract-expected-breaking', repositoryId: REPO, contractId: routeFactId });
    assert.equal(evaluateCondition(expected, obs).status, 'satisfied');
    const unexpected = collectUnexpectedChanges({ observation: obs, conditions: [expected], targets: [] });
    assert.equal(unexpected.filter((u) => u.category === 'contract').length, 0);
  });

  it('unexpected break: contract-compatible becomes unexpected-change and is reported as unplanned', () => {
    const { routeFactId, obs } = contractObservation(base, breakingHead);
    const compatible = cond({ kind: 'contract-compatible', repositoryId: REPO, contractId: routeFactId });
    const evaluation = evaluateCondition(compatible, obs);
    assert.equal(evaluation.status, 'unexpected-change');
    assert.ok(evaluation.evidenceRefs.some((ref) => ref.includes('response-field-removed')));
    const unexpected = collectUnexpectedChanges({ observation: obs, conditions: [], targets: [] });
    assert.ok(unexpected.some((u) => u.category === 'contract' && u.change.startsWith('breaking:response-field-removed')));
  });

  it('additive optional field keeps contract-compatible satisfied; expected-breaking is not observed', () => {
    const { routeFactId, obs } = contractObservation(base, compatibleHead);
    assert.equal(evaluateCondition(cond({ kind: 'contract-compatible', repositoryId: REPO, contractId: routeFactId }), obs).status, 'satisfied');
    assert.equal(evaluateCondition(cond({ kind: 'contract-expected-breaking', repositoryId: REPO, contractId: routeFactId }), obs).status, 'not-observed');
  });
});

describe('unexpected change collection', () => {
  it('ignores planned nodes, position-only shifts and containment edges; flags unplanned deltas', () => {
    const obs = observation({
      nodes: [
        { kind: 'changed', nodeKind: 'function', baseId: 'fn:a', headId: 'fn:a', changedProperties: ['contentFingerprint'], baseFilePath: 'src/a.ts', headFilePath: 'src/a.ts' },
        { kind: 'changed', nodeKind: 'function', baseId: 'fn:b', headId: 'fn:b', changedProperties: ['startLine'] },
        { kind: 'changed', nodeKind: 'file', baseId: 'file:a', headId: 'file:a', changedProperties: ['contentFingerprint'], baseFilePath: 'src/a.ts', headFilePath: 'src/a.ts' },
        { kind: 'added', nodeKind: 'function', headId: 'fn:surprise', headName: 'surprise', headFilePath: 'src/z.ts' },
      ],
      relationships: [
        { kind: 'added', edgeKind: 'calls', sourceId: 'fn:a', targetId: 'fn:helper' },
        { kind: 'added', edgeKind: 'contains', sourceId: 'file:z', targetId: 'fn:surprise' },
        { kind: 'added', edgeKind: 'imports', sourceId: 'file:x', targetId: 'file:y' },
      ],
    });
    const unexpected = collectUnexpectedChanges({
      observation: obs,
      conditions: [cond({ kind: 'node-modified', repositoryId: REPO, nodeId: 'fn:a' })],
      targets: [],
    });
    assert.deepEqual(unexpected.map((u) => `${u.category}:${u.key}:${u.change}`), [
      'node:fn:surprise:added',
      'relationship:file:x::imports::file:y:added',
    ]);
  });
});

describe('cross-repository consumer re-grading', () => {
  const finding = (rule: 'route-removed' | 'response-field-removed' | 'response-field-added-optional', verdict: 'compatible' | 'breaking', fieldKey?: string) => ({
    rule, verdict, routeFactId: 'route:1', affectedConsumerFactIds: [] as string[], reason: 'local', boundaryReasons: [], ...(fieldKey ? { fieldKey } : {}),
  });
  const records = (consumedFields: string[], certainty = 'exact') => [{ routeFactId: 'route:1', providerRepositoryId: REPO, consumers: [{ repositoryId: 'web', consumerId: 'c1', certainty, consumedFields }] }];

  it('a removed route with a known exact consumer elsewhere is breaking', () => {
    const [out] = regradeWithCrossRepoConsumers(REPO, [finding('route-removed', 'compatible')], records([]));
    assert.equal(out!.verdict, 'breaking');
    assert.deepEqual(out!.affectedConsumerFactIds, ['web:c1']);
  });

  it('a removed response field is breaking only when read; potentially-breaking when reads are unknown', () => {
    assert.equal(regradeWithCrossRepoConsumers(REPO, [finding('response-field-removed', 'compatible', 'receiptId')], records(['receiptId']))[0]!.verdict, 'breaking');
    assert.equal(regradeWithCrossRepoConsumers(REPO, [finding('response-field-removed', 'compatible', 'receiptId')], records([]))[0]!.verdict, 'potentially-breaking');
    assert.equal(regradeWithCrossRepoConsumers(REPO, [finding('response-field-removed', 'compatible', 'receiptId')], records(['amount']))[0]!.verdict, 'compatible');
  });

  it('never lowers a verdict, ignores non-exact consumers, other repositories and additive changes', () => {
    assert.equal(regradeWithCrossRepoConsumers(REPO, [finding('route-removed', 'breaking')], records([]))[0]!.reason, 'local');
    assert.equal(regradeWithCrossRepoConsumers(REPO, [finding('route-removed', 'compatible')], records([], 'heuristic'))[0]!.verdict, 'compatible');
    assert.equal(regradeWithCrossRepoConsumers('other-repo', [finding('route-removed', 'compatible')], records([]))[0]!.verdict, 'compatible');
    assert.equal(regradeWithCrossRepoConsumers(REPO, [finding('response-field-added-optional', 'compatible', 'x')], records([]))[0]!.verdict, 'compatible');
  });
});
