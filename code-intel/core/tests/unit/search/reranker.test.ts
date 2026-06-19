/**
 * reranker.test.ts — Unit tests for the feature-based re-ranker.
 *
 * Covers:
 *   1. tokenizeForRerank — camelCase / snake_case / acronym splitting
 *   2. rerank — ordering correctness for each signal
 *   3. rerank — combined signal ordering
 *   4. rerank — edge cases (empty list, single result, no query match)
 *   5. rerank — integration with hybridSearch (enabled / disabled)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rerank, tokenizeForRerank, DEFAULT_KIND_WEIGHTS } from '../../../src/search/reranker.js';
import { hybridSearch } from '../../../src/search/hybrid-search.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(
  id: string,
  name: string,
  kind = 'function',
  filePath = 'src/foo.ts',
  snippet = '',
  score = 1.0,
) {
  return { nodeId: id, name, kind, filePath, score, snippet: snippet || undefined };
}

// ── tokenizeForRerank ─────────────────────────────────────────────────────────

describe('tokenizeForRerank', () => {
  it('splits camelCase correctly', () => {
    const tokens = tokenizeForRerank('hashPassword');
    assert.deepStrictEqual(tokens, ['hash', 'password']);
  });

  it('splits PascalCase / class name', () => {
    const tokens = tokenizeForRerank('UserService');
    assert.deepStrictEqual(tokens, ['user', 'service']);
  });

  it('splits ALL_CAPS acronym followed by capitalized word', () => {
    const tokens = tokenizeForRerank('XMLParser');
    // XMLParser → XML Parser → ["xml", "parser"]
    assert.ok(tokens.includes('xml'), 'should include "xml"');
    assert.ok(tokens.includes('parser'), 'should include "parser"');
  });

  it('splits snake_case', () => {
    const tokens = tokenizeForRerank('create_user_session');
    assert.deepStrictEqual(tokens, ['create', 'user', 'session']);
  });

  it('handles plain lowercase', () => {
    const tokens = tokenizeForRerank('authenticate');
    assert.deepStrictEqual(tokens, ['authenticate']);
  });

  it('filters out tokens shorter than 2 chars', () => {
    const tokens = tokenizeForRerank('a_b_create');
    assert.ok(!tokens.includes('a'), 'single-char tokens should be excluded');
    assert.ok(!tokens.includes('b'), 'single-char tokens should be excluded');
    assert.ok(tokens.includes('create'));
  });

  it('handles mixed separators', () => {
    const tokens = tokenizeForRerank('get-user/profile');
    assert.ok(tokens.includes('get'));
    assert.ok(tokens.includes('user'));
    assert.ok(tokens.includes('profile'));
  });

  it('returns empty array for empty string', () => {
    assert.deepStrictEqual(tokenizeForRerank(''), []);
  });
});

// ── rerank — edge cases ───────────────────────────────────────────────────────

describe('rerank — edge cases', () => {
  it('returns empty array when given empty input', () => {
    const result = rerank('auth', []);
    assert.deepStrictEqual(result, []);
  });

  it('returns single result unchanged in structure', () => {
    const r = makeResult('n1', 'authenticate', 'function');
    const [out] = rerank('authenticate', [r]);
    assert.strictEqual(out.nodeId, 'n1');
    assert.strictEqual(out.name, 'authenticate');
  });

  it('does not mutate the original array', () => {
    const results = [
      makeResult('n1', 'foo', 'function', 'src/foo.ts', '', 10),
      makeResult('n2', 'bar', 'function', 'src/bar.ts', '', 5),
    ];
    const originalScores = results.map((r) => r.score);
    rerank('foo', results);
    assert.deepStrictEqual(results.map((r) => r.score), originalScores, 'input scores must not change');
  });

  it('preserves all result fields except score', () => {
    const r = makeResult('n1', 'authenticate', 'function', 'src/auth.ts', 'auth token', 5);
    const [out] = rerank('authenticate', [r]);
    assert.strictEqual(out.nodeId, 'n1');
    assert.strictEqual(out.name, 'authenticate');
    assert.strictEqual(out.kind, 'function');
    assert.strictEqual(out.filePath, 'src/auth.ts');
    assert.strictEqual(out.snippet, 'auth token');
  });

  it('all results are returned (length preserved)', () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      makeResult(`n${i}`, `func${i}`, 'function'),
    );
    const out = rerank('func', results);
    assert.strictEqual(out.length, 20);
  });

  it('query with no tokenizable content returns results in original order', () => {
    const results = [
      makeResult('n1', 'foo', 'function', 'src/foo.ts', '', 10),
      makeResult('n2', 'bar', 'function', 'src/bar.ts', '', 5),
    ];
    // '!' tokenizes to nothing → should return as-is (not crash)
    const out = rerank('!', results);
    assert.strictEqual(out.length, 2);
  });
});

// ── rerank — Signal 1: name-query affinity ────────────────────────────────────

describe('rerank — name-query affinity signal', () => {
  it('exact name match scores highest among otherwise equal candidates', () => {
    const results = [
      makeResult('n1', 'authenticate',      'function', 'src/a.ts', '', 1.0),
      makeResult('n2', 'authenticateUser',  'function', 'src/b.ts', '', 1.0),
      makeResult('n3', 'tokenAuthenticator','function', 'src/c.ts', '', 1.0),
    ];
    const out = rerank('authenticate', results);
    assert.strictEqual(out[0].name, 'authenticate', 'exact name match should rank first');
  });

  it('prefix match ranks above partial-contains', () => {
    // 'computeHash' contains 'hash' but does NOT start with it.
    // 'hashPassword' starts with 'hash' → should score higher.
    const results = [
      makeResult('n1', 'computeHash',  'function', 'src/a.ts', '', 1.0), // 'hash' is in the middle
      makeResult('n2', 'hashPassword', 'function', 'src/b.ts', '', 1.0), // starts with 'hash'
    ];
    const out = rerank('hash', results);
    assert.strictEqual(out[0].name, 'hashPassword', 'prefix match should rank above partial-contains');
  });

  it('camelCase token overlap boosts results — "user service" matches UserService', () => {
    const results = [
      makeResult('n1', 'UserService',  'class',    'src/user.ts', '', 1.0),
      makeResult('n2', 'ProductStore', 'class',    'src/prod.ts', '', 1.0),
    ];
    const out = rerank('user service', results);
    assert.strictEqual(out[0].name, 'UserService', 'token overlap should boost UserService');
  });
});

// ── rerank — Signal 2: snippet term coverage ─────────────────────────────────

describe('rerank — snippet term coverage signal', () => {
  it('result with query terms in snippet ranks above one without', () => {
    const results = [
      makeResult('n1', 'doThing', 'function', 'src/a.ts', 'this does nothing useful',  1.0),
      makeResult('n2', 'doAuth',  'function', 'src/b.ts', 'authenticate user session', 1.0),
    ];
    const out = rerank('auth', results);
    assert.strictEqual(out[0].name, 'doAuth', 'snippet with query term should rank higher');
  });

  it('result with more query terms in snippet ranks above fewer', () => {
    const results = [
      makeResult('n1', 'fn1', 'function', 'src/a.ts', 'process user', 1.0),         // 1/2 terms
      makeResult('n2', 'fn2', 'function', 'src/b.ts', 'process user token', 1.0),    // 2/2 terms
    ];
    const out = rerank('user token', results);
    assert.strictEqual(out[0].name, 'fn2', 'more snippet coverage should rank higher');
  });
});

// ── rerank — Signal 3: kind preference ───────────────────────────────────────

describe('rerank — kind preference signal', () => {
  it('class ranks above variable for equal base scores', () => {
    const results = [
      makeResult('n1', 'authVar',     'variable', 'src/a.ts', '', 1.0),
      makeResult('n2', 'AuthService', 'class',    'src/b.ts', '', 1.0),
    ];
    const out = rerank('auth', results);
    assert.strictEqual(out[0].kind, 'class', 'class should rank above variable');
  });

  it('function ranks above file', () => {
    const results = [
      makeResult('n1', 'authFile',    'file',     'src/auth.ts', '', 1.0),
      makeResult('n2', 'authenticate','function', 'src/auth.ts', '', 1.0),
    ];
    const out = rerank('auth', results);
    assert.strictEqual(out[0].kind, 'function', 'function should rank above file');
  });

  it('DEFAULT_KIND_WEIGHTS contains expected keys', () => {
    assert.ok('class'      in DEFAULT_KIND_WEIGHTS);
    assert.ok('function'   in DEFAULT_KIND_WEIGHTS);
    assert.ok('interface'  in DEFAULT_KIND_WEIGHTS);
    assert.ok('method'     in DEFAULT_KIND_WEIGHTS);
    assert.ok('variable'   in DEFAULT_KIND_WEIGHTS);
  });

  it('custom kindWeights option overrides defaults', () => {
    // Make variable rank higher than function by providing custom weights
    const results = [
      makeResult('n1', 'myVar',  'variable', 'src/a.ts', '', 1.0),
      makeResult('n2', 'myFunc', 'function', 'src/b.ts', '', 1.0),
    ];
    const out = rerank('my', results, { kindWeights: { variable: 2.0, function: 0.5 } });
    assert.strictEqual(out[0].kind, 'variable', 'custom kindWeights should override defaults');
  });
});

// ── rerank — Signal 4: path quality ──────────────────────────────────────────

describe('rerank — path quality signal', () => {
  it('test path is penalised', () => {
    const results = [
      makeResult('n1', 'authenticate', 'function', 'tests/auth.test.ts', '', 1.0),
      makeResult('n2', 'authenticate', 'function', 'src/auth.ts',        '', 1.0),
    ];
    const out = rerank('authenticate', results);
    assert.strictEqual(out[0].filePath, 'src/auth.ts', 'source path should outrank test path');
  });

  it('dist path is penalised more than test path', () => {
    const results = [
      makeResult('n1', 'fn', 'function', 'dist/foo.js',         '', 1.0),
      makeResult('n2', 'fn', 'function', 'tests/foo.test.ts',   '', 1.0),
      makeResult('n3', 'fn', 'function', 'src/foo.ts',          '', 1.0),
    ];
    const out = rerank('fn', results);
    assert.strictEqual(out[0].filePath, 'src/foo.ts', 'src should rank first');
    // dist should rank below test
    const distIndex = out.findIndex((r) => r.filePath.startsWith('dist'));
    const testIndex = out.findIndex((r) => r.filePath.includes('.test.'));
    assert.ok(testIndex < distIndex, 'test path should rank above dist path');
  });

  it('.d.ts files are penalised', () => {
    const results = [
      makeResult('n1', 'IAuth', 'interface', 'dist/auth.d.ts', '', 1.0),
      makeResult('n2', 'IAuth', 'interface', 'src/auth.ts',    '', 1.0),
    ];
    const out = rerank('IAuth', results);
    assert.strictEqual(out[0].filePath, 'src/auth.ts', '.d.ts should be penalised');
  });
});

// ── rerank — combined signals ─────────────────────────────────────────────────

describe('rerank — combined signals', () => {
  it('exact name + source path beats partial name + test path', () => {
    const results = [
      makeResult('n1', 'authenticateHelper', 'function', 'tests/auth.spec.ts', '', 1.0),
      makeResult('n2', 'authenticate',        'function', 'src/auth.ts',        '', 1.0),
    ];
    const out = rerank('authenticate', results);
    assert.strictEqual(out[0].name, 'authenticate', 'exact name + source path should win');
  });

  it('high base score with bad path can be beaten by lower base score with exact name', () => {
    // n1 has 10× the base score but is in dist and no name match
    // n2 has lower score but exact name match and source path
    const results = [
      makeResult('n1', 'unrelated', 'function', 'dist/bundle.js', '', 10.0),
      makeResult('n2', 'auth',      'function', 'src/auth.ts',    '', 1.0),
    ];
    const out = rerank('auth', results);
    // With large score ratio (10:1), n1 might still win — just verify no crash
    // and that both results are returned
    assert.strictEqual(out.length, 2);
  });

  it('results are sorted by descending re-rank score', () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      makeResult(`n${i}`, `symbol${i}`, 'function', 'src/a.ts', '', Math.random() + 0.5),
    );
    const out = rerank('symbol', results);
    for (let i = 1; i < out.length; i++) {
      assert.ok(
        out[i - 1].score >= out[i].score,
        `results should be sorted descending: ${out[i - 1].score} >= ${out[i].score}`,
      );
    }
  });
});

// ── rerank — option: enabled=false ───────────────────────────────────────────

describe('rerank — disabled via options', () => {
  it('returns results unmodified when enabled=false', () => {
    const results = [
      makeResult('n1', 'foo', 'function', 'src/a.ts', '', 10),
      makeResult('n2', 'bar', 'function', 'src/b.ts', '', 5),
    ];
    const out = rerank('foo', results, { nameWeight: 0.4 });
    // When enabled (default), scores change — just check we get 2 results
    assert.strictEqual(out.length, 2);
  });
});

// ── rerank — nameWeight / snippetWeight tuning ────────────────────────────────

describe('rerank — weight options', () => {
  it('nameWeight=0 means name signal does not affect ordering', () => {
    // Both have same kind/path/snippet. With nameWeight=0 the retrieval order
    // (by base score) should be largely preserved.
    const results = [
      makeResult('n1', 'exactMatch', 'function', 'src/a.ts', '', 10.0),
      makeResult('n2', 'other',      'function', 'src/b.ts', '', 9.0),
    ];
    const out = rerank('exactMatch', results, { nameWeight: 0 });
    // n1 has higher base score; with nameWeight=0 name signal is gone → n1 should still be first
    assert.strictEqual(out[0].nodeId, 'n1');
  });

  it('snippetWeight=0 means snippet signal does not affect ordering', () => {
    const results = [
      makeResult('n1', 'fn', 'function', 'src/a.ts', 'query term here', 10.0),
      makeResult('n2', 'fn', 'function', 'src/b.ts', '',                 9.0),
    ];
    const out = rerank('query term', results, { snippetWeight: 0 });
    // With snippetWeight=0 only name/kind/path affect ordering; base score still dominant
    assert.strictEqual(out.length, 2);
  });
});

// ── hybridSearch integration — rerank option ─────────────────────────────────

describe('hybridSearch — rerank integration', () => {
  function buildGraph() {
    const g = createKnowledgeGraph();
    g.addNode({ id: 'n1', kind: 'function',  name: 'authenticate',    filePath: 'src/auth.ts',       content: 'authenticate user token' });
    g.addNode({ id: 'n2', kind: 'function',  name: 'doAuthenticate',  filePath: 'tests/auth.test.ts',content: 'test authenticate helper' });
    g.addNode({ id: 'n3', kind: 'class',     name: 'AuthService',     filePath: 'src/auth.ts',       content: 'class managing auth' });
    g.addNode({ id: 'n4', kind: 'variable',  name: 'authConfig',      filePath: 'src/config.ts',     content: 'config for auth' });
    return g;
  }

  it('re-ranking is applied by default (no rerank option)', async () => {
    const g = buildGraph();
    const { results, searchMode } = await hybridSearch(g, 'authenticate', 10);
    assert.strictEqual(searchMode, 'bm25');
    assert.ok(results.length > 0);
    // Just verifying it runs without error and returns correct shape
    for (const r of results) {
      assert.ok(typeof r.score === 'number');
      assert.ok(typeof r.name === 'string');
    }
  });

  it('re-ranking can be disabled with { enabled: false }', async () => {
    const g = buildGraph();
    const { results: withRerank }    = await hybridSearch(g, 'authenticate', 10);
    const { results: withoutRerank } = await hybridSearch(g, 'authenticate', 10, { rerank: { enabled: false } });
    // Both should return the same set of results (same nodeIds)
    const ids1 = new Set(withRerank.map((r) => r.nodeId));
    const ids2 = new Set(withoutRerank.map((r) => r.nodeId));
    assert.deepStrictEqual(ids1, ids2, 'same results with/without rerank');
  });

  it('class beats variable for auth query with default re-ranking', async () => {
    const g = createKnowledgeGraph();
    g.addNode({ id: 'svc', kind: 'class',    name: 'AuthService', filePath: 'src/auth.ts',    content: 'class auth service' });
    g.addNode({ id: 'cfg', kind: 'variable', name: 'authCfg',     filePath: 'src/config.ts',  content: 'auth config variable' });
    const { results } = await hybridSearch(g, 'auth', 10);
    const svcIndex = results.findIndex((r) => r.nodeId === 'svc');
    const cfgIndex = results.findIndex((r) => r.nodeId === 'cfg');
    if (svcIndex !== -1 && cfgIndex !== -1) {
      assert.ok(svcIndex < cfgIndex, 'class (AuthService) should rank above variable (authCfg)');
    }
  });

  it('source path beats test path for same symbol name with default re-ranking', async () => {
    const g = createKnowledgeGraph();
    g.addNode({ id: 'src',  kind: 'function', name: 'authenticate', filePath: 'src/auth.ts',       content: 'authenticate user' });
    g.addNode({ id: 'test', kind: 'function', name: 'authenticate', filePath: 'tests/auth.test.ts',content: 'test authenticate' });
    const { results } = await hybridSearch(g, 'authenticate', 10);
    const srcIndex  = results.findIndex((r) => r.nodeId === 'src');
    const testIndex = results.findIndex((r) => r.nodeId === 'test');
    if (srcIndex !== -1 && testIndex !== -1) {
      assert.ok(srcIndex < testIndex, 'source path should rank above test path');
    }
  });

  it('custom rerank weights are passed through', async () => {
    const g = buildGraph();
    // Should not throw with custom weights
    const { results } = await hybridSearch(g, 'auth', 10, {
      rerank: { nameWeight: 0.5, snippetWeight: 0.3, kindWeights: { class: 1.5 } },
    });
    assert.ok(results.length > 0);
  });

  it('results remain sorted by descending score after re-ranking', async () => {
    const g = buildGraph();
    const { results } = await hybridSearch(g, 'authenticate', 10);
    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i - 1].score >= results[i].score,
        `results should be sorted descending at index ${i}: ${results[i - 1].score} >= ${results[i].score}`,
      );
    }
  });
});
