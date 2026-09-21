import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { createEvidenceStore } from '../../../src/evidence/store.js';
import { computePRImpact, parseDiffFiles } from '../../../src/query/pr-impact.js';

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-impact-'));
}

function buildTestGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();

  // Core symbol (many callers → HIGH risk)
  graph.addNode({ id: 'coreAuth', kind: 'function', name: 'authenticate', filePath: 'src/auth/core.ts' });

  // Leaf function (no callers → LOW risk)
  graph.addNode({ id: 'utilFn', kind: 'function', name: 'formatDate', filePath: 'src/util/date.ts' });

  // Medium-impact symbol
  graph.addNode({ id: 'midFn', kind: 'function', name: 'processOrder', filePath: 'src/orders/process.ts' });

  // Test file that imports authenticate
  graph.addNode({ id: 'testAuth', kind: 'file', name: 'auth.test', filePath: 'src/auth/core.test.ts' });

  // Many callers for authenticate (to make it HIGH)
  for (let i = 0; i < 60; i++) {
    graph.addNode({ id: `caller${i}`, kind: 'function', name: `callerFn${i}`, filePath: `src/callers/fn${i}.ts` });
    graph.addEdge({ id: `ecall${i}`, source: `caller${i}`, target: 'coreAuth', kind: 'calls' });
  }

  // Test file imports authenticate (testCoverage = true)
  graph.addEdge({ id: 'eTestImport', source: 'testAuth', target: 'coreAuth', kind: 'imports' });

  // processOrder has 15 callers (MEDIUM risk)
  for (let i = 0; i < 15; i++) {
    graph.addNode({ id: `ordCaller${i}`, kind: 'function', name: `orderCaller${i}`, filePath: `src/shop/fn${i}.ts` });
    graph.addEdge({ id: `eOrd${i}`, source: `ordCaller${i}`, target: 'midFn', kind: 'calls' });
  }

  return graph;
}

describe('parseDiffFiles', () => {
  it('parses unified diff to extract changed file paths', () => {
    const diff = `diff --git a/src/api/users.ts b/src/api/users.ts
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -1,3 +1,4 @@
+import foo from './foo';
 export function getUser() {}
diff --git a/src/util.ts b/src/util.ts
--- a/src/util.ts
+++ b/src/util.ts
@@ -2,2 +2,3 @@
+// added
`;
    const files = parseDiffFiles(diff);
    assert.deepEqual(files, ['src/api/users.ts', 'src/util.ts']);
  });

  it('returns empty array for diff with no file changes', () => {
    const files = parseDiffFiles('no file lines here');
    assert.deepEqual(files, []);
  });
});

describe('computePRImpact', () => {
  const graph = buildTestGraph();

  it('assigns HIGH risk to a symbol with blast radius > 50', () => {
    const result = computePRImpact(graph, ['src/auth/core.ts'], 5);
    const sym = result.changedSymbols.find((s) => s.name === 'authenticate');
    assert.ok(sym !== undefined, 'authenticate should be in changedSymbols');
    assert.equal(sym!.risk, 'HIGH', `expected HIGH risk, got ${sym!.risk}`);
  });

  it('assigns LOW risk to a leaf function with no callers', () => {
    const result = computePRImpact(graph, ['src/util/date.ts'], 5);
    const sym = result.changedSymbols.find((s) => s.name === 'formatDate');
    assert.ok(sym !== undefined, 'formatDate should be in changedSymbols');
    assert.equal(sym!.risk, 'LOW', `expected LOW risk, got ${sym!.risk}`);
  });

  it('assigns MEDIUM risk to a symbol with 10–50 callers in blast radius', () => {
    const result = computePRImpact(graph, ['src/orders/process.ts'], 5);
    const sym = result.changedSymbols.find((s) => s.name === 'processOrder');
    assert.ok(sym !== undefined, 'processOrder should be in changedSymbols');
    assert.equal(sym!.risk, 'MEDIUM', `expected MEDIUM risk, got ${sym!.risk}`);
  });

  it('detects test coverage for a symbol with an importing test file', () => {
    const result = computePRImpact(graph, ['src/auth/core.ts'], 5);
    const sym = result.changedSymbols.find((s) => s.name === 'authenticate');
    assert.ok(sym !== undefined);
    assert.equal(sym!.testCoverage, true, 'authenticate should have test coverage');
  });

  it('marks coverage gap for HIGH/MEDIUM risk symbols without test coverage', () => {
    const result = computePRImpact(graph, ['src/orders/process.ts'], 5);
    const sym = result.changedSymbols.find((s) => s.name === 'processOrder');
    assert.ok(sym !== undefined);
    assert.equal(sym!.testCoverage, false, 'processOrder should not have test coverage');
    assert.ok(result.coverageGaps.length > 0, 'should have coverage gaps');
    assert.ok(
      result.coverageGaps.some((g) => g.includes('processOrder')),
      `coverage gap should mention processOrder, got: ${JSON.stringify(result.coverageGaps)}`,
    );
  });

  it('accepts diff string input and extracts changed files', () => {
    const diff = `diff --git a/src/auth/core.ts b/src/auth/core.ts
--- a/src/auth/core.ts
+++ b/src/auth/core.ts
@@ -1,1 +1,2 @@
+// changed
`;
    const files = parseDiffFiles(diff);
    assert.ok(files.includes('src/auth/core.ts'));
    const result = computePRImpact(graph, files, 5);
    const sym = result.changedSymbols.find((s) => s.name === 'authenticate');
    assert.ok(sym !== undefined, 'should find authenticate from diff-extracted path');
  });

  it('handles unknown file path gracefully (no error, empty changedSymbols)', () => {
    const result = computePRImpact(graph, ['src/nonexistent/file.ts'], 5);
    assert.equal(result.changedSymbols.length, 0, 'should have no changed symbols for unknown file');
    assert.deepEqual(result.riskSummary, { HIGH: 0, MEDIUM: 0, LOW: 0 });
  });

  it('populates filesToReview with top impacted files', () => {
    const result = computePRImpact(graph, ['src/auth/core.ts'], 5);
    // Should have filesToReview from impacted caller files
    assert.ok(result.filesToReview.length > 0, 'should have files to review');
    assert.ok(result.filesToReview.length <= 5, 'should return at most 5 files to review');
  });

  it('crossRepoImpact is null', () => {
    const result = computePRImpact(graph, ['src/auth/core.ts'], 5);
    assert.equal(result.crossRepoImpact, null);
  });

  it('marks uncertain impact as UNKNOWN when evidence coverage is incomplete', () => {
    const repoDir = tempRepo();
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'target', kind: 'function', name: 'target', filePath: 'src/target.ts' });
    graph.addNode({ id: 'caller', kind: 'function', name: 'caller', filePath: 'src/caller.ts' });
    const store = createEvidenceStore(repoDir);
    store.put({
      id: 'ev:impact-1',
      version: 1,
      referenceId: 'ref:impact-1',
      resolverVersion: 'evidence-based-v1',
      strategy: 'semantic-call',
      coverage: { complete: false, examinedCount: 1, totalKnownCount: 2, incompleteReasons: ['analysis-limit'] },
      boundaries: [{ kind: 'analysis-limit', evidenceRefs: ['ev:impact-1'] }],
      recordedAt: '2025-01-01T00:00:00.000Z',
    });
    store.close();
    graph.addEdge({ id: 'e1', source: 'caller', target: 'target', kind: 'calls', certainty: 'candidate', evidenceRef: 'ev:impact-1' });

    const result = computePRImpact(graph, ['src/target.ts'], 5, repoDir);
    const sym = result.changedSymbols.find((s) => s.name === 'target');
    assert.equal(sym?.risk, 'UNKNOWN');
    assert.equal(sym?.certainty, 'lower-bound');
    assert.equal(sym?.coverage?.complete, false);
    assert.deepEqual(sym?.boundaries?.map((item) => item.kind), ['analysis-limit']);
    assert.equal(result.riskSummary.UNKNOWN, 1);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('omits apiImpact entirely when no changed file touches an API-contract route', () => {
    const result = computePRImpact(graph, ['src/auth/core.ts'], 5);
    assert.equal(result.apiImpact, undefined);
  });

  it('adds an additive apiImpact section when a changed file contains an API-contract route', async () => {
    const { expressFrameworkAdapter } = await import('../../../src/frameworks/adapters/express.js');
    const { fetchConsumerAdapter } = await import('../../../src/semantic/api-contracts/consumers/fetch.js');
    const { projectFactBundle } = await import('../../../src/semantic/graph-projector.js');
    const { createFactBundle, FACT_SCHEMA_VERSION } = await import('../../../src/semantic/fact-bundle.js');
    const { Language } = await import('../../../src/shared/languages.js');

    const serverSource = [
      "const express = require('express');",
      'const app = express();',
      "app.get('/users/:id', getUser);",
      'function getUser(req, res) {',
      "  res.status(200).json({ id: req.params.id, name: 'x' });",
      '}',
    ].join('\n');
    const clientSource = [
      'async function loadUser(id) {',
      "  const response = await fetch(`/users/${id}`);",
      '  const { id: userId, name } = await response.json();',
      '  return { userId, name };',
      '}',
    ].join('\n');

    const view = { workspaceRoot: '/repo', filePaths: ['src/api/app.js'], fileCache: new Map([['src/api/app.js', serverSource + '\n' + clientSource]]) };
    const routeBundle = expressFrameworkAdapter.extract(view);
    const consumerBundle = fetchConsumerAdapter.extract(view);
    const merged = createFactBundle({
      schema: { version: FACT_SCHEMA_VERSION, language: Language.JavaScript, adapterId: 'test' },
      facts: [...routeBundle.facts, ...consumerBundle.facts],
      diagnostics: [],
    });
    const apiGraph = createKnowledgeGraph();
    const { nodes, edges } = projectFactBundle(merged);
    for (const node of nodes) apiGraph.addNode(node);
    for (const edge of edges) apiGraph.addEdge(edge);

    const result = computePRImpact(apiGraph, ['src/api/app.js'], 5);
    assert.ok(result.apiImpact, 'expected an additive apiImpact section');
    assert.equal(result.apiImpact!.routes.length, 1);
    assert.equal(result.apiImpact!.routes[0]!.method, 'GET');
    assert.equal(result.apiImpact!.consumers.length, 1);
    assert.deepEqual([...result.apiImpact!.consumers[0]!.consumedKeys].sort(), ['id', 'name']);
  });
});
