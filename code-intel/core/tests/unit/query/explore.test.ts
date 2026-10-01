import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPLORE_INTENTS,
  EXPLORE_LIMITS,
  ExploreRequestError,
  detectExploreIntent,
  normalizeExploreRequest,
  runExplore,
  type ExploreDeps,
  type ExploreIntent,
} from '../../../src/query/explore.js';
import { ContextDeliverySession } from '../../../src/context/session.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { CodeNode } from '../../../src/shared/index.js';

function body(name: string, extra = ''): string {
  const filler = Array.from({ length: 12 }, (_, i) => `  const v${i} = step${i}(${i}) + ${i};`).join('\n');
  return `export function ${name}(input: string): string {\n${filler}\n  audit(input);\n${extra}  return done(input);\n}`;
}

function fixture() {
  const graph = createKnowledgeGraph();
  const add = (node: CodeNode): void => graph.addNode(node);
  add({ id: 'login', kind: 'function', name: 'login', filePath: 'src/auth/login.ts', startLine: 1, content: body('login', '  await persistSession(input);\n') });
  add({ id: 'persist', kind: 'function', name: 'persistSession', filePath: 'src/auth/session.ts', startLine: 1, content: body('persistSession') });
  add({ id: 'verify', kind: 'function', name: 'verifyPassword', filePath: 'src/auth/verify.ts', startLine: 1, content: body('verifyPassword'), metadata: { securitySignals: [{ type: 'SQL_INJECTION', sink: 'db.query', line: 4, expression: 'q', source: 'req', tier: 'generic-heuristic', flags: { hasUserInput: true, isDynamic: true, hasStringConcat: true, hasTemplateInterpolation: false, isParameterized: false, hasSanitizer: false } }] } });
  add({ id: 'route', kind: 'route', name: 'POST /login', filePath: 'src/routes.ts', startLine: 3, content: "router.post('/login', login);" });
  add({ id: 'test', kind: 'function', name: 'loginTest', filePath: 'src/auth/login.test.ts', startLine: 1, content: body('loginTest') });
  graph.addEdge({ id: 'e1', source: 'login', target: 'persist', kind: 'calls', certainty: 'exact' });
  graph.addEdge({ id: 'e2', source: 'login', target: 'verify', kind: 'calls', certainty: 'candidate' });
  graph.addEdge({ id: 'e3', source: 'test', target: 'login', kind: 'calls', certainty: 'exact' });
  graph.addEdge({ id: 'e4', source: 'route', target: 'login', kind: 'handles' });
  return graph;
}

function depsFor(graph: ReturnType<typeof fixture>, over: Partial<ExploreDeps> = {}): ExploreDeps {
  return {
    graph,
    search: async (query, limit) => {
      const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
      const hits = [...graph.allNodes()]
        .map((node) => ({
          nodeId: node.id, name: node.name, kind: node.kind, filePath: node.filePath,
          score: tokens.filter((t) => (node.name + ' ' + node.filePath).toLowerCase().includes(t)).length,
        }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId))
        .slice(0, limit);
      return { hits, actualMode: 'bm25', vectorReady: false, fallbackReason: 'VECTOR_INDEX_UNAVAILABLE' };
    },
    now: () => 0,
    ...over,
  };
}

describe('explore — request normalization', () => {
  it('rejects empty tasks and bad enums', () => {
    assert.throws(() => normalizeExploreRequest({ task: '   ' }), ExploreRequestError);
    assert.throws(() => normalizeExploreRequest({ task: 'x', intent: 'nope' as ExploreIntent }), /Invalid intent/);
    assert.throws(() => normalizeExploreRequest({ task: 'x', compression: 'zip' as 'auto' }), /Invalid compression/);
  });

  it('clamps the token budget and seed count', () => {
    assert.equal(normalizeExploreRequest({ task: 'x', maxTokens: 999999 }).maxTokens, 6000);
    assert.equal(normalizeExploreRequest({ task: 'x', maxTokens: 10 }).maxTokens, 128);
    assert.equal(normalizeExploreRequest({ task: 'x', seeds: 99 }).seeds, EXPLORE_LIMITS.maxSeeds);
  });

  it('detects intents from task text and honors an explicit intent', () => {
    assert.equal(detectExploreIntent('how does login reach session persistence?'), 'understand');
    assert.equal(detectExploreIntent('what must change to add MFA?'), 'change');
    assert.equal(detectExploreIntent('why does login fail with an error'), 'debug');
    assert.equal(detectExploreIntent('is there SQL injection in verify'), 'security');
    assert.equal(detectExploreIntent('which endpoint handles login'), 'api');
    assert.equal(detectExploreIntent('review this diff'), 'review');
    const explicit = normalizeExploreRequest({ task: 'how does login work', intent: 'security' });
    assert.equal(explicit.intent, 'security');
    assert.equal(explicit.intentSource, 'requested');
  });
});

describe('explore — all six intents', () => {
  for (const intent of EXPLORE_INTENTS) {
    it(`${intent}: returns a bounded, trust-annotated result`, async () => {
      const graph = fixture();
      const result = await runExplore({ task: 'login session verify password', intent, maxTokens: 3000 }, depsFor(graph));
      assert.equal(result.intent, intent);
      assert.ok(result.seeds.length > 0);
      assert.ok(result.context.blockTokens!.total <= 3000);
      assert.ok(result.context.focusCode.length > 0);
      assert.ok(['exact', 'lower-bound', 'heuristic', 'truncated', 'unavailable'].includes(result.certainty));
      assert.ok(result.capabilities.degraded.some((line) => line.startsWith('ref:')));
      assert.equal(result.capabilities.alternateRef, 'unavailable');
      assert.equal(result.ranking, undefined, 'ranking diagnostics are opt-in');
    });
  }

  it('change/review: gathers impact and test evidence', async () => {
    const graph = fixture();
    const result = await runExplore({ task: 'login', intent: 'change' }, depsFor(graph));
    assert.ok(result.evidence.impactedSymbols.length >= 0);
    assert.ok(result.evidence.tests.some((t) => t.symbol === 'login'));
    assert.ok(result.evidence.highestRisk);
  });

  it('security: reports recorded signals and a no-taint-proof boundary without mutating the graph', async () => {
    const graph = fixture();
    const before = graph.size;
    const result = await runExplore({ task: 'verifyPassword', intent: 'security' }, depsFor(graph));
    assert.ok(result.evidence.security.some((s) => s.type === 'SQL_INJECTION'));
    assert.ok(result.capabilities.degraded.some((line) => line.includes('no end-to-end taint proof')));
    assert.ok(result.boundaries.some((b) => b.kind === 'unsupported-semantics'));
    assert.deepEqual(graph.size, before);
  });

  it('api: reports route evidence, or an explicit degradation when no route is seeded', async () => {
    const graph = fixture();
    const withRoute = await runExplore({ task: 'POST login route', intent: 'api' }, depsFor(graph));
    assert.ok(withRoute.seeds.some((s) => s.kind === 'route'));
    const noRoute = await runExplore({ task: 'verifyPassword', intent: 'api', seeds: 1 }, depsFor(graph));
    assert.ok(noRoute.capabilities.degraded.some((line) => line.startsWith('api:')));
  });

  it('debug/understand: collects caller and callee evidence', async () => {
    const graph = fixture();
    const result = await runExplore({ task: 'login', intent: 'debug' }, depsFor(graph));
    assert.ok(result.evidence.callees.includes('persistSession'));
    assert.ok(result.evidence.callers.includes('loginTest'));
  });
});

describe('explore — empty / partial evidence', () => {
  it('no candidates → unavailable certainty and an explicit absence-is-not-proof note', async () => {
    const graph = fixture();
    const result = await runExplore({ task: 'zzzzzz qqqqq' }, depsFor(graph));
    assert.equal(result.seeds.length, 0);
    assert.equal(result.certainty, 'unavailable');
    assert.ok(result.capabilities.degraded.some((line) => line.includes('absence is not proof')));
    assert.equal(result.context.focusCode, '');
  });

  it('search fallback is surfaced, not hidden', async () => {
    const graph = fixture();
    const result = await runExplore({ task: 'login' }, depsFor(graph));
    assert.equal(result.capabilities.search.fallbackReason, 'VECTOR_INDEX_UNAVAILABLE');
    assert.ok(result.capabilities.degraded.some((line) => line.startsWith('search:')));
  });

  it('hits whose nodes are missing from the graph are skipped without error', async () => {
    const graph = fixture();
    const deps = depsFor(graph, {
      search: async () => ({
        hits: [{ nodeId: 'ghost', name: 'ghost', kind: 'function', filePath: 'x.ts', score: 1 }, { nodeId: 'login', name: 'login', kind: 'function', filePath: 'src/auth/login.ts', score: 0.5 }],
        actualMode: 'bm25', vectorReady: false,
      }),
    });
    const result = await runExplore({ task: 'login' }, deps);
    assert.deepEqual(result.seeds.map((s) => s.symbol), ['login']);
  });

  it('propagates search errors as ExploreRequestError from the bound search', async () => {
    const graph = fixture();
    const deps = depsFor(graph, { search: async () => { throw new ExploreRequestError('Repo not found', 404); } });
    await assert.rejects(() => runExplore({ task: 'login' }, deps), (err: unknown) => err instanceof ExploreRequestError && err.status === 404);
  });
});

describe('explore — determinism and limits', () => {
  it('is deterministic (identical output with a fixed clock)', async () => {
    const a = await runExplore({ task: 'login session verify', intent: 'change', explainRanking: true }, depsFor(fixture()));
    const b = await runExplore({ task: 'login session verify', intent: 'change', explainRanking: true }, depsFor(fixture()));
    assert.deepEqual(a, b);
  });

  it('explainRanking adds compact top-contribution diagnostics only on request', async () => {
    const result = await runExplore({ task: 'login', explainRanking: true }, depsFor(fixture()));
    assert.ok(result.ranking && result.ranking.length > 0);
    for (const row of result.ranking!) assert.ok(row.top.length <= 3);
  });

  it('keeps default output compact and expands only on request', async () => {
    const compact = await runExplore({ task: 'login session' }, depsFor(fixture()));
    for (const seed of compact.seeds) {
      assert.equal(seed.nodeId, undefined);
      assert.equal(seed.rank, undefined);
      assert.equal(seed.score, undefined);
    }
    for (const decision of compact.context.renderDecisions) {
      assert.equal(decision.reason, undefined);
      assert.equal(decision.artifactId, undefined);
    }
    assert.equal(compact.capabilities.skeletonLanguages, undefined);

    const detailed = await runExplore({ task: 'login session', explainRanking: true }, depsFor(fixture()));
    assert.ok(detailed.seeds.every((seed) => seed.nodeId && seed.rank && seed.score !== undefined));
    assert.ok(detailed.context.renderDecisions.every((decision) => decision.reason !== undefined));
    assert.ok(detailed.capabilities.skeletonLanguages!.includes('typescript'));
  });

  it('respects the seed limit and the hard token budget', async () => {
    const graph = fixture();
    const result = await runExplore({ task: 'login session verify password route', seeds: 2, maxTokens: 200 }, depsFor(graph));
    assert.ok(result.seeds.length <= 2);
    assert.ok(result.context.blockTokens!.total <= 200);
    assert.equal(result.maxTokens, 200);
  });

  it('keeps graph work and expansion within the hard limits', async () => {
    const graph = createKnowledgeGraph();
    for (let i = 0; i < 8; i++) {
      graph.addNode({ id: `hub${i}`, kind: 'function', name: `hub${i}`, filePath: `src/h${i}.ts`, content: body(`hub${i}`) });
    }
    const result = await runExplore({ task: 'hub', intent: 'debug', seeds: 8 }, depsFor(graph as ReturnType<typeof fixture>));
    assert.ok(result.counters.graphLookups <= EXPLORE_LIMITS.maxGraphLookups);
    assert.ok(result.counters.expandedNodes <= EXPLORE_LIMITS.maxExpandedNodes);
    assert.ok(result.seeds.length <= EXPLORE_LIMITS.maxSeeds);
  });

  it('records counters and per-stage durations without raw source', async () => {
    const result = await runExplore({ task: 'login session' }, depsFor(fixture()));
    assert.equal(result.counters.tokensRequested, 6000);
    assert.ok(result.counters.tokensDelivered > 0);
    assert.ok(Object.keys(result.durationsMs).sort().join() === 'build,expand,render,rerank,search,total');
    assert.ok(Object.values(result.counters.renderModes).reduce((a, b) => a + b, 0) > 0);
  });
});

describe('explore — session freshness', () => {
  it('repeat call references unchanged source; a changed node is resent', async () => {
    const graph = fixture();
    const session = new ContextDeliverySession('ws');
    const deps = depsFor(graph, { session, indexIdentity: 'gen-1' });
    const first = await runExplore({ task: 'login session', maxTokens: 6000 }, deps);
    assert.ok(first.context.renderDecisions.length > 0);

    const second = await runExplore({ task: 'login session', maxTokens: 6000 }, deps);
    assert.ok(second.context.renderDecisions.some((d) => d.mode === 'reference'));

    const login = graph.getNode('login')!;
    login.content = body('login', '  mfaCheck(input);\n');
    const third = await runExplore({ task: 'login session', maxTokens: 6000 }, deps);
    const loginDecision = third.context.renderDecisions.find((d) => d.name === 'login');
    assert.ok(loginDecision && loginDecision.mode !== 'reference', 'changed source must be resent');
    assert.match(third.context.focusCode, /mfaCheck/);

    const movedIndex = await runExplore({ task: 'login session' }, depsFor(graph, { session, indexIdentity: 'gen-2' }));
    assert.ok(!movedIndex.context.renderDecisions.some((d) => d.mode === 'reference'));
  });
});
