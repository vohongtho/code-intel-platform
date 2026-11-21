import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPH_RERANK_VERSION,
  classifyPath,
  rerankCandidates,
  topContributions,
  type RerankCandidate,
} from '../../../src/search/graph-reranker.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { CodeNode, RelationshipCertainty } from '../../../src/shared/index.js';

type Graph = ReturnType<typeof createKnowledgeGraph>;

function node(graph: Graph, id: string, name: string, filePath = `src/${name}.ts`, kind: CodeNode['kind'] = 'function'): RerankCandidate {
  graph.addNode({ id, kind, name, filePath });
  return { nodeId: id, name, kind, filePath, score: 1 };
}

function calls(graph: Graph, source: string, target: string, certainty?: RelationshipCertainty): void {
  graph.addEdge({ id: `${source}->${target}`, source, target, kind: 'calls', certainty });
}

describe('graph-reranker', () => {
  it('is deterministic and keeps first-stage order on ties', () => {
    const graph = createKnowledgeGraph();
    const candidates = [node(graph, 'b', 'beta'), node(graph, 'a', 'alpha'), node(graph, 'c', 'gamma')];
    const first = rerankCandidates(graph, 'unrelated words', candidates);
    assert.deepEqual(first.map((c) => c.nodeId), ['b', 'a', 'c']);
    assert.deepEqual(rerankCandidates(graph, 'unrelated words', candidates), first);
  });

  it('boosts exact identity matches above a higher lexical score', () => {
    const graph = createKnowledgeGraph();
    const a = { ...node(graph, 'a', 'handleRequest'), score: 1 };
    const b = { ...node(graph, 'b', 'createSession'), score: 0.9 };
    const ranked = rerankCandidates(graph, 'where is createSession implemented', [a, b]);
    assert.equal(ranked[0]!.nodeId, 'b');
    assert.ok(ranked[0]!.contributions.some((c) => c.feature === 'exact-identity'));
  });

  it('keeps candidates with no graph evidence, including nodes absent from the graph', () => {
    const graph = createKnowledgeGraph();
    const lonely = node(graph, 'a', 'lonelySymbol');
    const ghost: RerankCandidate = { nodeId: 'ghost', name: 'ghost', kind: 'function', filePath: 'src/ghost.ts', score: 0.7 };
    const ranked = rerankCandidates(graph, 'lonely', [lonely, ghost]);
    assert.equal(ranked.length, 2);
    for (const candidate of ranked) {
      assert.equal(candidate.graphEvidence, 'none');
      assert.equal(candidate.exactPathEvidence, false);
      assert.ok(candidate.rerankScore > 0);
    }
  });

  it('exact edges count as exact path evidence', () => {
    const graph = createKnowledgeGraph();
    const a = node(graph, 'a', 'login');
    const b = node(graph, 'b', 'persistSession');
    calls(graph, 'a', 'b', 'exact');
    for (const candidate of rerankCandidates(graph, 'login session', [a, b])) {
      assert.equal(candidate.exactPathEvidence, true);
      assert.equal(candidate.graphEvidence, 'exact');
    }
  });

  it('ambiguous (candidate/heuristic/legacy) edges never become exact ranking evidence', () => {
    for (const certainty of ['candidate', 'heuristic', undefined] as const) {
      const graph = createKnowledgeGraph();
      const a = node(graph, 'a', 'login');
      const b = node(graph, 'b', 'persistSession');
      calls(graph, 'a', 'b', certainty);
      for (const candidate of rerankCandidates(graph, 'login session', [a, b])) {
        assert.equal(candidate.exactPathEvidence, false, `certainty=${String(certainty)}`);
        assert.equal(candidate.graphEvidence, 'bounded', `certainty=${String(certainty)}`);
      }
    }
  });

  it('bounds ambiguous contribution below exact contribution', () => {
    const proximityFor = (certainty: RelationshipCertainty): number => {
      const graph = createKnowledgeGraph();
      const a = node(graph, 'a', 'login');
      const b = node(graph, 'b', 'persistSession');
      calls(graph, 'a', 'b', certainty);
      const ranked = rerankCandidates(graph, 'zzz', [a, b]);
      return ranked.find((c) => c.nodeId === 'a')!.contributions.find((c) => c.feature === 'graph-proximity')!.value;
    };
    assert.ok(proximityFor('candidate') < proximityFor('exact'));
    assert.ok(proximityFor('heuristic') < proximityFor('candidate'));
  });

  it('caps total graph proximity', () => {
    const graph = createKnowledgeGraph();
    const hub = node(graph, 'hub', 'hub');
    const spokes = Array.from({ length: 30 }, (_, i) => {
      const spoke = node(graph, `s${i}`, `spoke${i}`);
      calls(graph, 'hub', `s${i}`, 'exact');
      return spoke;
    });
    const ranked = rerankCandidates(graph, 'zzz', [hub, ...spokes]);
    const proximity = ranked.find((c) => c.nodeId === 'hub')!.contributions.find((c) => c.feature === 'graph-proximity')!;
    assert.ok(proximity.value <= 0.4 + 1e-9);
  });

  it('penalizes generated paths, and test paths outside review/debug', () => {
    const graph = createKnowledgeGraph();
    const src = node(graph, 'a', 'build', 'src/build.ts');
    const gen = node(graph, 'b', 'build', 'dist/build.js');
    const test = node(graph, 'c', 'build', 'tests/build.test.ts');
    assert.equal(rerankCandidates(graph, 'zzz', [gen, test, src], { intent: 'change' })[0]!.nodeId, 'a');
    const review = rerankCandidates(graph, 'zzz', [test, src], { intent: 'review' });
    assert.ok(!review.find((c) => c.nodeId === 'c')!.contributions.some((c) => c.feature === 'path-category'));
  });

  it('classifies path categories', () => {
    assert.equal(classifyPath('dist/index.js'), 'generated');
    assert.equal(classifyPath('src/types.d.ts'), 'generated');
    assert.equal(classifyPath('tests/unit/a.test.ts'), 'test');
    assert.equal(classifyPath('package.json'), 'config');
    assert.equal(classifyPath('src/auth/login.ts'), 'source');
  });

  it('boosts routes for api intent', () => {
    const graph = createKnowledgeGraph();
    const route = node(graph, 'r', 'POST /login', 'src/routes.ts', 'route');
    const fn = node(graph, 'f', 'loginHelper');
    assert.equal(rerankCandidates(graph, 'zzz', [fn, route], { intent: 'api' })[0]!.nodeId, 'r');
  });

  it('exposes top contributions without mutating the candidate', () => {
    const graph = createKnowledgeGraph();
    const [ranked] = rerankCandidates(graph, 'login', [node(graph, 'a', 'login')]);
    const top = topContributions(ranked!, 1);
    assert.equal(top.length, 1);
    assert.equal(top[0]!.feature, 'lexical');
    assert.ok(ranked!.contributions.length >= 1);
  });

  it('is versioned', () => {
    assert.equal(GRAPH_RERANK_VERSION, 'graph-rerank-v1');
  });
});
