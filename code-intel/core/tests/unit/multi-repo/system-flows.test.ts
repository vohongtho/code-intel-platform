import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph, type KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { stitchSystemFlows } from '../../../src/multi-repo/system-flows/stitcher.js';
import {
  boundariesFromLinks,
  getGroupSystemFlows,
  querySystemFlows,
  resolveSystemFlowCachePath,
  systemFlowImpactForContracts,
  systemFlowsTouching,
  type MemberDescriptor,
} from '../../../src/multi-repo/system-flows/service.js';
import type { ContractBoundaryEdge, LocalFlowRecord, StitchInput } from '../../../src/multi-repo/system-flows/types.js';
import type { ContractLink, GroupSyncResult, RepoGroup } from '../../../src/multi-repo/types.js';
import { FLOW_IDENTITY_VERSION } from '../../../src/flow-detection/identity.js';

function flow(repositoryId: string, flowId: string, steps: string[], fingerprint = `${flowId}-fp`): LocalFlowRecord {
  return { repositoryId, flowId, flowFingerprint: fingerprint, entrySymbolId: steps[0]!, stepSymbolIds: steps };
}

function edge(overrides: Partial<ContractBoundaryEdge> & Pick<ContractBoundaryEdge, 'contractId' | 'fromRepositoryId' | 'toRepositoryId'>): ContractBoundaryEdge {
  return {
    kind: 'route',
    providerRepositoryId: overrides.toRepositoryId,
    consumerRepositoryId: overrides.fromRepositoryId,
    consumerId: `${overrides.contractId}:consumer`,
    certainty: 'exact',
    evidence: 'http-route-fact',
    ...overrides,
  };
}

function repo(repositoryId: string, flows: LocalFlowRecord[], coverageComplete = true) {
  return { repositoryId, snapshotId: `${repositoryId}-gen`, flowIdentityVersion: FLOW_IDENTITY_VERSION, coverageComplete, flows };
}

/** web --HTTP POST /payments/capture--> payments --event payment.captured--> notifications */
function threeRepoInput(): StitchInput {
  return {
    repositories: [
      repo('web', [flow('web', 'flow:web:submit', ['web:CheckoutPage.submit', 'web:apiClient.capturePayment'])]),
      repo('payments', [flow('payments', 'flow:pay:capture', ['pay:PaymentController.capture', 'pay:PaymentService.capture', 'pay:publishCaptured'])]),
      repo('notifications', [flow('notifications', 'flow:notif:handle', ['notif:PaymentCapturedConsumer.handle', 'notif:ReceiptSender.send'])]),
    ],
    boundaries: [
      edge({ contractId: 'route:POST /payments/capture', fromRepositoryId: 'web', fromSymbolId: 'web:apiClient.capturePayment', toRepositoryId: 'payments', toSymbolId: 'pay:PaymentController.capture' }),
      edge({ contractId: 'event:payment.captured', kind: 'event', evidence: 'event-topic', fromRepositoryId: 'payments', fromSymbolId: 'pay:publishCaptured', toRepositoryId: 'notifications', toSymbolId: 'notif:PaymentCapturedConsumer.handle', providerRepositoryId: 'payments', consumerRepositoryId: 'notifications' }),
    ],
  };
}

describe('system-flow stitcher', () => {
  it('stitches a deterministic three-repository chain across HTTP and event boundaries', () => {
    const result = stitchSystemFlows(threeRepoInput());
    assert.equal(result.flows.length, 1);
    const [systemFlow] = result.flows;
    assert.deepEqual(systemFlow!.segments.map((s) => s.repositoryId), ['web', 'payments', 'notifications']);
    assert.deepEqual(systemFlow!.segments.map((s) => s.boundaryToNext?.contractId), ['route:POST /payments/capture', 'event:payment.captured', undefined]);
    assert.equal(systemFlow!.segments[0]!.exitSymbolId, 'web:apiClient.capturePayment');
    assert.equal(systemFlow!.certainty, 'exact');
    assert.equal(systemFlow!.coverage.complete, true);
    assert.equal(result.candidates.length, 0);

    // Stable across runs and independent of input order.
    const reordered = threeRepoInput();
    reordered.repositories.reverse();
    reordered.boundaries.reverse();
    assert.deepEqual(stitchSystemFlows(reordered).flows, result.flows);
    assert.equal(stitchSystemFlows(threeRepoInput()).flows[0]!.id, systemFlow!.id);
  });

  it('changes identity when a local segment or a contract boundary changes', () => {
    const base = stitchSystemFlows(threeRepoInput()).flows[0]!;
    const segmentChanged = threeRepoInput();
    segmentChanged.repositories[1]!.flows[0]!.flowFingerprint = 'different';
    assert.notEqual(stitchSystemFlows(segmentChanged).flows[0]!.fingerprint, base.fingerprint);
    const boundaryChanged = threeRepoInput();
    boundaryChanged.boundaries[0]!.contractId = 'route:POST /payments/capture/v2';
    assert.notEqual(stitchSystemFlows(boundaryChanged).flows[0]!.id, base.id);
  });

  it('never stitches a candidate consumer exactly; it is returned separately', () => {
    const input = threeRepoInput();
    input.boundaries[0]!.certainty = 'heuristic';
    const result = stitchSystemFlows(input);
    assert.ok(!result.flows.some((f) => f.segments[0]!.repositoryId === 'web'), 'no exact flow through a heuristic consumer');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]!.fromFlowId, 'flow:web:submit');
    assert.match(result.candidates[0]!.reason, /certainty is heuristic/);
    // payments -> notifications is still exact on its own.
    assert.deepEqual(result.flows.map((f) => f.segments.map((s) => s.repositoryId)), [['payments', 'notifications']]);
  });

  it('same endpoint-like names without an evidence-backed contract never create an exact continuation', () => {
    const input = threeRepoInput();
    input.boundaries = [edge({ contractId: 'export:capture', kind: 'export', evidence: 'name-match', certainty: 'exact', fromRepositoryId: 'web', fromSymbolId: 'web:apiClient.capturePayment', toRepositoryId: 'payments', toSymbolId: 'pay:PaymentController.capture' })];
    const result = stitchSystemFlows(input);
    assert.equal(result.flows.length, 0);
    assert.equal(result.candidates.length, 1);
    assert.match(result.candidates[0]!.reason, /name-only/);
  });

  it('keeps unresolved boundary endpoints as candidates', () => {
    const input = threeRepoInput();
    input.boundaries[0]!.toSymbolId = undefined;
    input.boundaries[0]!.unresolvedReason = 'route has no unique handler';
    const result = stitchSystemFlows(input);
    assert.ok(result.candidates.some((c) => c.reason === 'route has no unique handler'));
  });

  it('stops at repository cycles with an explicit boundary', () => {
    const input: StitchInput = {
      repositories: [
        repo('a', [flow('a', 'flow:a', ['a:start', 'a:callB'])]),
        repo('b', [flow('b', 'flow:b', ['b:handle', 'b:callA'])]),
      ],
      boundaries: [
        edge({ contractId: 'route:b', fromRepositoryId: 'a', fromSymbolId: 'a:callB', toRepositoryId: 'b', toSymbolId: 'b:handle' }),
        edge({ contractId: 'route:a', fromRepositoryId: 'b', fromSymbolId: 'b:callA', toRepositoryId: 'a', toSymbolId: 'a:start' }),
      ],
    };
    const result = stitchSystemFlows(input);
    assert.ok(result.flows.length >= 1);
    for (const f of result.flows) {
      assert.ok(f.segments.length <= 2);
      assert.equal(f.boundaries[0]?.kind, 'cycle');
    }
  });

  it('falls back to an entry-only segment (lower-bound) when the consumer symbol is in no local flow', () => {
    const input = threeRepoInput();
    input.repositories[2]!.flows = [];
    const result = stitchSystemFlows(input);
    const longest = result.flows.find((f) => f.segments.length === 3)!;
    assert.equal(longest.segments[2]!.localFlowId, undefined);
    assert.deepEqual(longest.segments[2]!.stepSymbolIds, ['notif:PaymentCapturedConsumer.handle']);
    assert.equal(longest.certainty, 'lower-bound');
    assert.equal(longest.boundaries[0]!.kind, 'missing-local-flow');
  });

  it('enforces hop/segment caps as truncated lower bounds', () => {
    const result = stitchSystemFlows({ ...threeRepoInput(), limits: { maxHops: 1 } });
    assert.equal(result.flows.length, 1);
    assert.equal(result.flows[0]!.segments.length, 2);
    assert.equal(result.flows[0]!.certainty, 'truncated');
    assert.equal(result.flows[0]!.boundaries[0]!.kind, 'hop-cap');
    assert.ok(result.counters.capHits > 0);
    assert.equal(result.coverage.complete, false);
  });

  it('enforces the candidate cap', () => {
    const input = threeRepoInput();
    input.boundaries = Array.from({ length: 10 }, (_, i) => edge({ contractId: `route:${i}`, certainty: 'heuristic', fromRepositoryId: 'web', fromSymbolId: 'web:apiClient.capturePayment', toRepositoryId: 'payments', toSymbolId: 'pay:PaymentController.capture' }));
    const result = stitchSystemFlows({ ...input, limits: { maxCandidates: 3 } });
    assert.equal(result.candidates.length, 3);
    assert.ok(result.boundaries.some((b) => b.kind === 'candidate-cap'));
  });

  it('partial group coverage turns otherwise-exact boundaries into candidates', () => {
    const input = threeRepoInput();
    input.repositories[1]!.coverageComplete = false;
    const result = stitchSystemFlows(input);
    assert.equal(result.flows.length, 0);
    assert.ok(result.candidates.every((c) => /partial\/unknown coverage/.test(c.reason)));
    assert.equal(result.coverage.complete, false);
    assert.ok(result.boundaries.some((b) => b.kind === 'partial-coverage'));
  });

  it('treats GraphQL operation and gRPC method evidence as exact boundaries, never names', () => {
    const input: StitchInput = {
      repositories: [
        repo('gateway', [flow('gateway', 'flow:gw', ['gw:resolveOrder', 'gw:callOrders'])]),
        repo('orders', [flow('orders', 'flow:orders', ['orders:OrderService.Get', 'orders:loadOrder'])]),
        repo('billing', [flow('billing', 'flow:billing', ['billing:Query.invoice', 'billing:findInvoice'])]),
      ],
      boundaries: [
        edge({ contractId: 'grpc:orders.OrderService/Get', kind: 'grpc', evidence: 'grpc-method', fromRepositoryId: 'gateway', fromSymbolId: 'gw:callOrders', toRepositoryId: 'orders', toSymbolId: 'orders:OrderService.Get' }),
        edge({ contractId: 'graphql:Query.invoice', kind: 'graphql', evidence: 'graphql-operation', fromRepositoryId: 'orders', fromSymbolId: 'orders:loadOrder', toRepositoryId: 'billing', toSymbolId: 'billing:Query.invoice' }),
      ],
    };
    const result = stitchSystemFlows(input);
    assert.equal(result.flows.length, 1);
    assert.deepEqual(result.flows[0]!.segments.map((s) => s.boundaryToNext?.evidence), ['grpc-method', 'graphql-operation', undefined]);
    input.boundaries[1]!.evidence = 'name-match';
    assert.deepEqual(stitchSystemFlows(input).flows.map((f) => f.segments.length), [2], 'a name-only GraphQL match does not extend the chain');
  });

  it('scales by index probes, not all-flows x all-boundaries', () => {
    const repos = 20;
    const flowsPerRepo = 100;
    const repositories = Array.from({ length: repos }, (_, r) => repo(`r${r}`, Array.from({ length: flowsPerRepo }, (_, f) => flow(`r${r}`, `flow:r${r}:${f}`, [`r${r}:s${f}:0`, `r${r}:s${f}:1`, `r${r}:s${f}:2`]))));
    const boundaries: ContractBoundaryEdge[] = [];
    for (let r = 0; r < repos - 1; r += 1) {
      for (let f = 0; f < flowsPerRepo; f += 1) {
        boundaries.push(edge({ contractId: `route:r${r}:${f}`, fromRepositoryId: `r${r}`, fromSymbolId: `r${r}:s${f}:2`, toRepositoryId: `r${r + 1}`, toSymbolId: `r${r + 1}:s${f}:0` }));
      }
    }
    const started = Date.now();
    const result = stitchSystemFlows({ repositories, boundaries, limits: { maxHops: 3, maxSegments: 4, maxSystemFlows: 100_000 } });
    const elapsed = Date.now() - started;
    const totalSteps = repos * flowsPerRepo * 3;
    assert.equal(result.counters.boundaryLookups, totalSteps, 'exactly one outgoing-boundary probe per local flow step');
    assert.ok(result.counters.boundaryLookups < repositories.length * flowsPerRepo * boundaries.length / 100, 'far below an all-by-all scan');
    assert.ok(result.flows.length > 0);
    assert.ok(elapsed < 5000, `stitching took ${elapsed}ms`);
  });
});

// ─── Service: boundary derivation, cache, queries ────────────────────────────

function providerGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  graph.addNode({ id: 'pay:route', kind: 'route', name: 'POST /payments/capture', filePath: 'src/routes.ts', startLine: 3, metadata: { apiContract: { factId: 'fact:route:capture', method: 'POST', normalizedPath: '/payments/capture' } } });
  graph.addNode({ id: 'pay:handler', identityId: 'pay:PaymentController.capture', kind: 'function', name: 'capture', filePath: 'src/controller.ts', startLine: 1, endLine: 10 });
  graph.addEdge({ id: 'e1', source: 'pay:route', target: 'pay:handler', kind: 'handles' });
  graph.addNode({ id: 'pay:flow', kind: 'flow', name: 'capture flow', filePath: 'src/controller.ts', metadata: { algorithmVersion: FLOW_IDENTITY_VERSION, entryPointCanonicalId: 'pay:PaymentController.capture', stepCanonicalIds: ['pay:PaymentController.capture', 'pay:PaymentService.capture'], flowFingerprint: 'fp-pay' } });
  return graph;
}

function consumerGraph(withSpan = true): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  graph.addNode({ id: 'web:fn', identityId: 'web:apiClient.capturePayment', kind: 'function', name: 'capturePayment', filePath: 'src/api.ts', startLine: 4, endLine: withSpan ? 12 : 4 });
  graph.addNode({ id: 'web:consumer', kind: 'api_consumer', name: 'POST /payments/capture', filePath: 'src/api.ts', startLine: 7, metadata: { semantic: { factId: 'fact:consumer:1' } } });
  graph.addNode({ id: 'web:flow', kind: 'flow', name: 'submit flow', filePath: 'src/page.ts', metadata: { algorithmVersion: FLOW_IDENTITY_VERSION, entryPointCanonicalId: 'web:CheckoutPage.submit', stepCanonicalIds: ['web:CheckoutPage.submit', 'web:apiClient.capturePayment'], flowFingerprint: 'fp-web' } });
  return graph;
}

const ROUTE_LINK: ContractLink = {
  providerRepo: 'payments', providerContract: 'POST /payments/capture', consumerRepo: 'web', consumerContract: 'src/api.ts:7',
  matchKind: 'route-match', confidence: 1, providerContractId: 'contract:route:capture',
  providerSourceCanonicalId: 'fact:route:capture', consumerSourceCanonicalId: 'fact:consumer:1', certainty: 'exact',
};

describe('system-flow boundary derivation from group links', () => {
  it('resolves an exact HTTP route-match link to enclosing consumer function -> route handler', () => {
    const [boundary] = boundariesFromLinks({ links: [ROUTE_LINK], graphs: new Map([['payments', providerGraph()], ['web', consumerGraph()]]) });
    assert.equal(boundary!.fromSymbolId, 'web:apiClient.capturePayment');
    assert.equal(boundary!.toSymbolId, 'pay:PaymentController.capture');
    assert.equal(boundary!.evidence, 'http-route-fact');
    assert.equal(boundary!.unresolvedReason, undefined);
  });

  it('does not guess the enclosing function from an anchor-only line (no real span)', () => {
    const [boundary] = boundariesFromLinks({ links: [ROUTE_LINK], graphs: new Map([['payments', providerGraph()], ['web', consumerGraph(false)]]) });
    assert.equal(boundary!.fromSymbolId, undefined);
    assert.match(boundary!.unresolvedReason!, /no function\/method span/);
  });

  it('marks name-match links as name-match evidence', () => {
    const [boundary] = boundariesFromLinks({
      links: [{ ...ROUTE_LINK, matchKind: 'name-match', providerContractId: 'contract:event:x', providerSourceCanonicalId: 'pay:Evt', consumerSourceCanonicalId: 'web:Evt' }],
      graphs: new Map(),
      contracts: [{ repoName: 'payments', repoPath: '/p', kind: 'event', name: 'PaymentCapturedEvent', nodeId: 'n', nodeKind: 'interface', filePath: 'x', contractId: 'contract:event:x' }],
    });
    assert.equal(boundary!.evidence, 'name-match');
    assert.equal(boundary!.kind, 'event');
  });
});

describe('group system-flow service cache', () => {
  let home: string;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'sysflow-home-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  const group: RepoGroup = { name: 'commerce', createdAt: 'x', members: [{ groupPath: 'web', repoId: 'web', registryName: 'web' }, { groupPath: 'payments', repoId: 'payments', registryName: 'payments' }] };
  function deps(state: { snapshot: string; links: ContractLink[]; loads: { count: number } }) {
    const sync: GroupSyncResult = { groupName: 'commerce', syncedAt: 'x', memberCount: 2, contracts: [], links: state.links, schemaVersion: '1' };
    return {
      homeDir: home,
      loadGroup: () => group,
      loadSyncResult: () => sync,
      describeMember: (id: string): MemberDescriptor => ({ repositoryId: id, repositoryName: id, repoPath: `/repos/${id}`, snapshotId: `${id}-${state.snapshot}`, trusted: true, fresh: true, flowIdentityVersion: FLOW_IDENTITY_VERSION }),
      loadGraph: async (member: MemberDescriptor) => {
        state.loads.count += 1;
        return member.repositoryId === 'web' ? consumerGraph() : providerGraph();
      },
    };
  }

  it('builds, caches, and invalidates on any input fingerprint change', async () => {
    const state = { snapshot: 'g1', links: [ROUTE_LINK], loads: { count: 0 } };
    const first = await getGroupSystemFlows('commerce', {}, deps(state));
    assert.equal(first.cache.hit, false);
    assert.equal(first.result.flows.length, 1);
    assert.deepEqual(first.result.flows[0]!.segments.map((s) => s.repositoryId), ['web', 'payments']);
    assert.equal(state.loads.count, 2);

    const second = await getGroupSystemFlows('commerce', {}, deps(state));
    assert.equal(second.cache.hit, true);
    assert.equal(state.loads.count, 2, 'cache hit loads no graphs');
    assert.deepEqual(second.result, first.result);

    state.snapshot = 'g2';
    assert.equal((await getGroupSystemFlows('commerce', {}, deps(state))).cache.hit, false, 'member snapshot change invalidates');

    state.links = [{ ...ROUTE_LINK, certainty: 'heuristic' }];
    const relinked = await getGroupSystemFlows('commerce', {}, deps(state));
    assert.equal(relinked.cache.hit, false, 'contract link change invalidates');
    assert.equal(relinked.result.flows.length, 0);
    assert.equal(relinked.result.candidates.length, 1);

    assert.equal((await getGroupSystemFlows('commerce', { limits: { maxHops: 1 } }, deps(state))).cache.hit, false, 'limit change invalidates');
  });

  it('never serves a cache entry whose key does not match current inputs', async () => {
    const state = { snapshot: 'g1', links: [ROUTE_LINK], loads: { count: 0 } };
    await getGroupSystemFlows('commerce', {}, deps(state));
    const file = resolveSystemFlowCachePath('commerce', home);
    const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
    tampered.cacheKey = 'f'.repeat(64);
    fs.writeFileSync(file, JSON.stringify(tampered));
    assert.equal((await getGroupSystemFlows('commerce', {}, deps(state))).cache.hit, false);
    fs.writeFileSync(file, '{broken');
    assert.equal((await getGroupSystemFlows('commerce', {}, deps(state))).cache.hit, false);
  });

  it('queries are bounded, filterable and support impact/touching lookups', async () => {
    const state = { snapshot: 'g1', links: [ROUTE_LINK], loads: { count: 0 } };
    const { result } = await getGroupSystemFlows('commerce', {}, deps(state));
    assert.equal(querySystemFlows(result, { symbolId: 'pay:PaymentService.capture' }).total, 1);
    assert.equal(querySystemFlows(result, { contractId: 'contract:route:capture' }).total, 1);
    assert.equal(querySystemFlows(result, { repositoryId: 'nope' }).total, 0);
    const page = querySystemFlows(result, { limit: 1000 });
    assert.equal(page.limit, 100);
    assert.deepEqual(systemFlowsTouching(result, ['web:apiClient.capturePayment']).map((f) => f.id), [result.flows[0]!.id]);
    const impact = systemFlowImpactForContracts(result, ['contract:route:capture']);
    assert.equal(impact.affected.length, 1);
    assert.deepEqual(impact.affected[0]!.repositories, ['web', 'payments']);
  });

  it('rejects path-like group names for the cache location', () => {
    assert.throws(() => resolveSystemFlowCachePath('../x', home));
  });
});
