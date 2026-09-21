/**
 * eval-fixtures.test.ts
 *
 * The agent-workflow evaluation harness (design.md "Evaluation" /
 * spec.md "Workflows MUST preserve uncertainty"). Each fixture below seeds a
 * real graph and drives the *actual* MCP tool dispatcher (`dispatchTool` —
 * the same function `createMcpServer`'s `CallToolRequestSchema` handler
 * calls) for the exact tool sequence a workflow prescribes, then asserts a
 * machine-checkable property tied to that workflow's documented decision
 * branch (see `src/agents/workflows/assets/*.md`).
 *
 * This intentionally does not simulate a live LLM agent (no such harness
 * exists in this repo — `eval/run-agent-bench.mjs`'s "agent" is a scripted
 * heuristic too, not a model). What it verifies is narrower but concrete:
 * that the underlying tool signals a workflow's prose depends on ("search
 * returns >1 candidate", "no path found", "risk downgraded to UNKNOWN when
 * coverage is incomplete") are real and actually produced by these tools for
 * the scenario each workflow's decision branch describes — so a workflow
 * asset can never cite a signal the tools don't actually emit. Reuses the
 * same in-process dispatch/fixture-seeding infrastructure as
 * `tests/unit/mcp-server/api-contract-tools.test.ts` and `eval/run-mcp-bench.mjs`
 * rather than introducing a new harness.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createKnowledgeGraph } from '../../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../../src/storage/graph-loader.js';
import { saveMetadata } from '../../../../src/storage/metadata.js';
import { saveRegistry } from '../../../../src/storage/repo-registry.js';
import { dispatchTool, resetRepoGraphCacheForTests } from '../../../../src/mcp-server/server.js';
import { saveGroup, saveSyncResult } from '../../../../src/multi-repo/group-registry.js';
import { Bm25Index, getBm25DbPath } from '../../../../src/search/bm25-index.js';
import { CURRENT_SCHEMA_VERSION } from '../../../../src/migrations/migration-runner.js';
import { projectFactBundle } from '../../../../src/semantic/graph-projector.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../../src/semantic/fact-bundle.js';
import { expressFrameworkAdapter } from '../../../../src/frameworks/adapters/express.js';
import { fetchConsumerAdapter } from '../../../../src/semantic/api-contracts/consumers/fetch.js';
import { Language } from '../../../../src/shared/languages.js';

function mkRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `eval-${name}-`));
  fs.mkdirSync(path.join(dir, '.code-intel'), { recursive: true });
  return dir;
}

async function writeRepoIndex(repoPath: string, graph: KnowledgeGraph): Promise<void> {
  const db = new DbManager(path.join(repoPath, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
  saveMetadata(repoPath, {
    indexedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion: 'v1',
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 1, duration: 0 },
  });
}

async function seedRepo(name: string, build: (graph: KnowledgeGraph) => void): Promise<{ repoId: string; repoPath: string }> {
  const repoPath = mkRepo(name);
  const repoId = name;
  saveRegistry([{ id: repoId, name, path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } }]);
  const graph = createKnowledgeGraph();
  build(graph);
  await writeRepoIndex(repoPath, graph);
  const bm25 = new Bm25Index(getBm25DbPath(repoPath));
  bm25.build(graph);
  return { repoId, repoPath };
}

function call(repoPath: string, repoId: string, tool: string, args: Record<string, unknown> = {}) {
  return dispatchTool(tool, { repoId, ...args }, createKnowledgeGraph(), 'fallback', repoPath);
}

function jsonOf(result: Awaited<ReturnType<typeof dispatchTool>>): any {
  return JSON.parse(result.content[0]?.text ?? 'null');
}

function graphFromExpressSource(filePath: string, source: string): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  const view = { workspaceRoot: '/repo', filePaths: [filePath], fileCache: new Map([[filePath, source]]) };
  const routeBundle = expressFrameworkAdapter.extract(view);
  const consumerBundle = fetchConsumerAdapter.extract(view);
  const merged = createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: Language.JavaScript, adapterId: 'eval-fixture' },
    facts: [...routeBundle.facts, ...consumerBundle.facts],
    diagnostics: [],
  });
  const { nodes, edges } = projectFactBundle(merged);
  for (const node of nodes) graph.addNode(node);
  for (const edge of edges) graph.addEdge(edge);
  return graph;
}

describe('agent-workflow evaluation fixtures', () => {
  beforeEach(() => {
    resetRepoGraphCacheForTests();
  });

  // ── explore (task 4.4): two same-name symbols must not be silently disambiguated ──
  it('explore: ambiguous same-name symbols force disambiguation via inspect, not a silent first-match pick', async () => {
    const { repoId, repoPath } = await seedRepo('explore-ambiguous', (graph) => {
      graph.addNode({ id: 'handler-auth', kind: 'class', name: 'Handler', filePath: 'auth/handler.ts', exported: true, startLine: 1, endLine: 5 });
      graph.addNode({ id: 'handler-billing', kind: 'class', name: 'Handler', filePath: 'billing/handler.ts', exported: true, startLine: 1, endLine: 5 });
    });

    const searchResult = jsonOf(await call(repoPath, repoId, 'search', { query: 'Handler', limit: 10 }));
    const matches = (searchResult.results ?? []).filter((r: any) => r.name === 'Handler');
    assert.ok(matches.length >= 2, `expected ≥2 same-name candidates, got ${matches.length}: ${JSON.stringify(searchResult)}`);

    const filePaths = new Set(matches.map((m: any) => m.filePath));
    assert.equal(filePaths.size, 2, 'the two candidates must be genuinely distinct symbols (different files), proving a first-match pick would be a real, not cosmetic, mistake');
  });

  // ── debug (task 5.4): nearest lexical match is not the actual caller path ──
  it('debug: a lexically-similar decoy with no real call edge must not be reachable via blast_radius/find_path', async () => {
    const { repoId, repoPath } = await seedRepo('debug-lexical-decoy', (graph) => {
      graph.addNode({ id: 'handle-request', kind: 'function', name: 'handleRequest', filePath: 'server.ts', exported: true, startLine: 1, endLine: 10 });
      graph.addNode({ id: 'process-payment', kind: 'function', name: 'processPayment', filePath: 'payments.ts', exported: true, startLine: 1, endLine: 10 });
      graph.addNode({ id: 'process-payment-legacy', kind: 'function', name: 'processPaymentLegacy', filePath: 'payments-legacy.ts', exported: true, startLine: 1, endLine: 10 });
      graph.addEdge({ id: 'hr-calls-pp', source: 'handle-request', target: 'process-payment', kind: 'calls' });
      // No edge to process-payment-legacy — it is a lexical decoy only.
    });

    const realImpact = jsonOf(await call(repoPath, repoId, 'blast_radius', { target: 'processPayment', direction: 'callers' }));
    assert.ok(realImpact.affected?.some((a: any) => a.name === 'handleRequest'), 'the real target must show its real caller');

    // `affected` always includes the target itself at depth 0 (blast-radius-trust.ts
    // seeds the BFS queue with the target and never excludes it from the result) — so
    // "zero callers" is `affected` containing only the target itself, not
    // `affectedCount === 0`. Naively reading affectedCount as 0 is exactly the kind of
    // undocumented-tool-contract mistake this fixture exists to catch.
    const decoyImpact = jsonOf(await call(repoPath, repoId, 'blast_radius', { target: 'processPaymentLegacy', direction: 'callers' }));
    const decoyCallers = decoyImpact.affected.filter((a: any) => a.name !== 'processPaymentLegacy');
    assert.equal(decoyCallers.length, 0, `the lexically-similar decoy must show zero real callers — proving name similarity alone is not evidence of a caller relationship (got: ${JSON.stringify(decoyImpact.affected)})`);

    const pathResult = await call(repoPath, repoId, 'find_path', { from: 'handleRequest', to: 'processPaymentLegacy' });
    assert.match(pathResult.content[0]?.text ?? '', /No path found/, 'find_path must explicitly report no path, not silently succeed');
  });

  // ── impact (task 6.4): a shallow max_hops result must not be read as the whole picture ──
  it('impact: a shallow max_hops traversal undercounts impact that a deeper traversal reveals', async () => {
    const { repoId, repoPath } = await seedRepo('impact-truncation', (graph) => {
      const names = ['a', 'b', 'c', 'd', 'e'];
      for (const n of names) graph.addNode({ id: `fn-${n}`, kind: 'function', name: n, filePath: 'chain.ts', exported: true, startLine: 1, endLine: 2 });
      for (let i = 0; i < names.length - 1; i++) {
        graph.addEdge({ id: `edge-${i}`, source: `fn-${names[i]}`, target: `fn-${names[i + 1]}`, kind: 'calls' });
      }
    });

    const shallow = jsonOf(await call(repoPath, repoId, 'blast_radius', { target: 'a', direction: 'callees', max_hops: 1 }));
    const deep = jsonOf(await call(repoPath, repoId, 'blast_radius', { target: 'a', direction: 'callees', max_hops: 10 }));

    assert.ok(shallow.affectedCount < deep.affectedCount, `expected the shallow (max_hops=1) count (${shallow.affectedCount}) to be smaller than the deep (max_hops=10) count (${deep.affectedCount}) — a workflow that stopped at the shallow result would have understated real impact`);
  });

  // ── plan (task 7.4): a consumer repo only belongs in the plan when group/contract evidence supports it ──
  describe('plan: cross-repo contract change scope', () => {
    it('an unsynced group must not yield consumer-repo evidence', async () => {
      const result = await dispatchTool('group_contracts', { name: 'unsynced-group' }, createKnowledgeGraph(), 'fallback', undefined);
      const text = result.content[0]?.text ?? '';
      assert.match(text, /No sync data for group/, 'plan must be told cross-repo evidence is unavailable, not receive an empty-looking success payload');
    });

    it('a synced group with a real link names the specific consumer repo with a confidence score', async () => {
      const backendPath = mkRepo('plan-group-backend');
      saveRegistry([{ id: 'backend', name: 'backend', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);
      saveGroup({ name: 'plan-group', createdAt: new Date().toISOString(), members: [{ groupPath: 'backend', repoId: 'backend', registryName: 'backend' }] });
      saveSyncResult({
        groupName: 'plan-group',
        syncedAt: new Date().toISOString(),
        memberCount: 2,
        contracts: [{ repoName: 'backend', repoPath: backendPath, kind: 'export', name: 'UserService', nodeId: 'user-service', nodeKind: 'class', filePath: 'src/user-service.ts' }],
        links: [{ providerRepo: 'backend', providerContract: 'UserService', consumerRepo: 'frontend', consumerContract: 'UserServiceClient', matchKind: 'name-match', confidence: 0.92 }],
      });

      const result = await dispatchTool('group_contracts', { name: 'plan-group' }, createKnowledgeGraph(), 'fallback', undefined);
      const payload = jsonOf(result);
      const link = payload.links?.find((l: any) => l.consumerRepo === 'frontend');
      assert.ok(link, `expected a link naming consumer repo 'frontend': ${JSON.stringify(payload)}`);
      assert.ok(link.confidence > 0, 'the consumer link must carry a real confidence score the plan can cite');
    });
  });

  // ── review (task 8.4): a heuristic-only (non-exact) call edge must be visibly less certain than a clean pass ──
  it('review: a heuristic-only call edge is reported with certainty=heuristic, not silently folded into a clean pass', async () => {
    const { repoId, repoPath } = await seedRepo('review-partial', (graph) => {
      graph.addNode({ id: 'handle-request', kind: 'function', name: 'handleRequest', filePath: 'server.ts', exported: true, startLine: 1, endLine: 10 });
      graph.addNode({ id: 'process-payment', kind: 'function', name: 'processPayment', filePath: 'payments.ts', exported: true, startLine: 1, endLine: 10 });
      graph.addEdge({ id: 'hr-calls-pp', source: 'handle-request', target: 'process-payment', kind: 'calls', certainty: 'heuristic' });
    });

    const impact = jsonOf(await call(repoPath, repoId, 'pr_impact', { changedFiles: ['payments.ts'] }));
    const changed = impact.changedSymbols?.find((s: any) => s.name === 'processPayment');
    assert.ok(changed, `expected processPayment among changedSymbols: ${JSON.stringify(impact)}`);
    // pr_impact's `risk` (LOW/MEDIUM/HIGH/UNKNOWN) only downgrades on genuinely
    // incomplete evidence-store coverage — it does NOT reflect edge-level certainty.
    // `certainty` is the field that does: a review workflow reading `risk` alone would
    // silently miss that the only supporting edge here is heuristic, not exact.
    assert.equal(changed.certainty, 'heuristic', `expected certainty='heuristic' for a heuristic-only supporting edge, got: ${JSON.stringify(changed)}`);
  });

  // ── api-review (task 9.4): known consumer vs. dynamic/unknown consumer ──
  describe('api-review: response-field removal', () => {
    const SERVER_SOURCE = [
      "const express = require('express');",
      'const app = express();',
      "app.get('/users/:id', getUser);",
      'function getUser(req, res) {',
      "  res.status(200).json({ id: req.params.id, name: 'x', ssn: '000' });",
      '}',
    ].join('\n');
    const HEAD_SERVER_SOURCE = SERVER_SOURCE.replace(", ssn: '000'", '');
    const STATIC_CLIENT_SOURCE = [
      'async function loadUser(id) {',
      "  const response = await fetch(`/users/${id}`);",
      '  const { id: userId, ssn } = await response.json();',
      '  return { userId, ssn };',
      '}',
    ].join('\n');

    it('with a statically-resolved (known) frontend consumer, api_drift classifies the removal as breaking', async () => {
      const basePath = mkRepo('api-review-known-base');
      const headPath = mkRepo('api-review-known-head');
      saveRegistry([
        { id: 'base-repo', name: 'base', path: basePath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
        { id: 'head-repo', name: 'head', path: headPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } },
      ]);
      await writeRepoIndex(basePath, graphFromExpressSource('src/app.js', SERVER_SOURCE + '\n' + STATIC_CLIENT_SOURCE));
      await writeRepoIndex(headPath, graphFromExpressSource('src/app.js', HEAD_SERVER_SOURCE + '\n' + STATIC_CLIENT_SOURCE));

      const result = await dispatchTool('api_drift', { repoId: 'head-repo', base_repo_id: 'base-repo' }, createKnowledgeGraph(), 'fallback', headPath);
      const payload = jsonOf(result);
      const breaking = payload.findings.find((f: any) => f.rule === 'response-field-removed' && f.fieldKey === 'ssn');
      assert.ok(breaking, `expected a response-field-removed finding: ${JSON.stringify(payload.findings)}`);
      assert.equal(breaking.verdict, 'breaking', 'a known, statically-resolved consumer of the removed field must be classified as breaking, not left unverified');
    });

    it('with no statically-resolvable consumer, api_impact reports zero consumers — which must read as "unknown", not "safe"', async () => {
      const repoPath = mkRepo('api-review-unknown-consumer');
      saveRegistry([{ id: 'repo-id', name: 'repo', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 1, files: 1 } }]);
      // A dynamic URL built from a runtime variable defeats static consumer resolution —
      // no `consumers` fact is emitted for it, even though the route is still consumed at runtime.
      const dynamicClientSource = [
        'async function loadUser(base, id) {',
        '  const url = base + "/users/" + id;',
        '  const response = await fetch(url);',
        '  return response.json();',
        '}',
      ].join('\n');
      await writeRepoIndex(repoPath, graphFromExpressSource('src/app.js', SERVER_SOURCE + '\n' + dynamicClientSource));

      const result = await dispatchTool('api_impact', { repoId: 'repo-id', method: 'GET', path: '/users/{}' }, createKnowledgeGraph(), 'fallback', repoPath);
      const payload = jsonOf(result);
      assert.equal(payload.routes.length, 1, 'the route itself must still be found');
      assert.equal(payload.consumers.length, 0, 'a dynamically-built URL must not be statically resolved as a consumer — this is the "unknown", not "no consumers", case api-review.md requires');
    });
  });

  // ── test-coverage (task 10.3): an uncovered exported symbol must never be read as "no tests required" ──
  it('test-coverage: an exported, uncovered symbol appears in coverage_gaps with no "not required" signal anywhere in the response', async () => {
    const { repoId, repoPath } = await seedRepo('test-coverage-gap', (graph) => {
      graph.addNode({ id: 'fn-untested', kind: 'function', name: 'untestedExport', filePath: 'lib.ts', exported: true, startLine: 1, endLine: 3 });
    });

    const coverage = jsonOf(await call(repoPath, repoId, 'coverage_gaps', {}));
    const gap = coverage.untestedByRisk?.find((g: any) => g.name === 'untestedExport');
    assert.ok(gap, `expected untestedExport in coverage_gaps: ${JSON.stringify(coverage)}`);
    assert.equal(gap.exported, true);
    assert.equal(gap.tested, false);

    const suggestions = await call(repoPath, repoId, 'suggest_tests', { symbol: 'untestedExport' });
    const suggestionsPayload = jsonOf(suggestions);
    assert.deepEqual(suggestionsPayload.existingTests, [], 'no existing tests must be found for this symbol');

    // Neither response contains any waiver/exemption concept — confirming there is no
    // tool-provided basis for a workflow to ever conclude "no tests required".
    const flat = JSON.stringify({ coverage, suggestionsPayload }).toLowerCase();
    assert.ok(!flat.includes('not required') && !flat.includes('no tests needed'), 'tool responses must never contain a waiver signal a workflow could misread as license to skip testing');
  });

  // ── security-investigation (task 11.3): a scanner finding with no proven call path stays a candidate ──
  it('security-investigation: a vulnerability_scan finding carries no path proof, and find_path confirms none exists between the named source and sink', async () => {
    const { repoId, repoPath } = await seedRepo('security-scanner-candidate', (graph) => {
      // vulnerability-detector.ts's SQL_PATTERN matches a call-site node named
      // like `db.query`, gated by `metadata.hasStringConcatenation` (or a caller) —
      // this is the plain name-pattern heuristic path (no securitySignals, so the
      // resulting finding carries no `confidence`/`evidence`, only a bare heuristic match).
      graph.addNode({
        id: 'sql-query-callsite',
        kind: 'function',
        name: 'db.query',
        filePath: 'reports.ts',
        startLine: 2,
        endLine: 2,
        metadata: { hasStringConcatenation: true },
      });
      // A plausible "source" that is never actually connected to the sink above.
      graph.addNode({ id: 'user-input-fn', kind: 'function', name: 'readUserInput', filePath: 'http.ts', exported: true, startLine: 1, endLine: 2 });
    });

    const scan = jsonOf(await call(repoPath, repoId, 'vulnerability_scan', { types: ['SQL_INJECTION'] }));
    const finding = scan.findings?.find((f: any) => f.type === 'SQL_INJECTION');
    assert.ok(finding, `expected a SQL_INJECTION finding: ${JSON.stringify(scan)}`);
    assert.equal('provenSink' in finding, false, 'a scanner finding must never carry a path-proof field — it is heuristic signal only');
    assert.equal('evidence' in finding, false, 'the plain name-pattern heuristic path carries no evidence block either — it is weaker signal than a securitySignals-derived finding, and both are still not a proven path');

    const pathResult = await call(repoPath, repoId, 'find_path', { from: 'readUserInput', to: 'db.query' });
    assert.match(pathResult.content[0]?.text ?? '', /No path found/, 'with no real edge between the candidate source and sink, find_path must say so explicitly rather than the workflow assuming a path exists');
  });
});
