#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createKnowledgeGraph } from '../../dist-tests/src/graph/knowledge-graph.js';
import { textSearch } from '../../dist-tests/src/search/text-search.js';
import { dispatchTool } from '../../dist-tests/src/mcp-server/server.js';

const graph = createKnowledgeGraph();
graph.addNode({ id: 'page', kind: 'file', name: 'LoginPage', filePath: 'web/pages/LoginPage.tsx', content: 'portal authentication login page' });
graph.addNode({ id: 'api', kind: 'method', name: 'login', filePath: 'web/api/client.ts', content: 'login to portal' });
graph.addNode({ id: 'exact', kind: 'variable', name: 'tree_node_name', filePath: 'core/query.ts', content: 'tree_node_name exact symbol query benchmark' });
graph.addNode({ id: 'noise', kind: 'variable', name: 'token', filePath: 'core/token.ts', content: 'login token processing' });
for (let i = 0; i < 10_000; i++) graph.addNode({ id: `noise-${i}`, kind: 'variable', name: `value${i}`, filePath: `src/generated/${i}.ts`, content: 'unrelated generated value' });

const started = performance.now();
const cold = textSearch(graph, 'how to login portal', 20);
const coldMs = performance.now() - started;
const warmStarted = performance.now();
const warm = textSearch(graph, 'how to login portal', 20);
const warmMs = performance.now() - warmStarted;

assert.deepEqual(new Set(cold.slice(0, 2).map(({ nodeId }) => nodeId)), new Set(['api', 'page']));
assert.deepEqual(warm.map(({ nodeId }) => nodeId), cold.map(({ nodeId }) => nodeId));
assert.ok(coldMs < 250, `cold search ${coldMs.toFixed(2)}ms exceeded 250ms`);
assert.ok(warmMs < 25, `warm search ${warmMs.toFixed(2)}ms exceeded 25ms`);

const exactStarted = performance.now();
const exactCli = textSearch(graph, 'tree_node_name', 10);
const exactCliMs = performance.now() - exactStarted;
const exactMcpStarted = performance.now();
const mcpResult = await dispatchTool('search', { query: 'tree_node_name', mode: 'bm25' }, graph, 'fixture', undefined);
const exactMcpMs = performance.now() - exactMcpStarted;
const mcpPayload = JSON.parse(mcpResult.content[0]?.text ?? '{}');
const exactMcp = mcpPayload.results ?? [];

assert.equal(exactCli[0]?.name, 'tree_node_name');
assert.equal(exactMcp[0]?.name, 'tree_node_name');
assert.equal(mcpPayload.searchMode, 'bm25');
assert.ok(exactMcpMs < Math.max(exactCliMs * 5, 50), `mcp bm25 exact search ${exactMcpMs.toFixed(2)}ms unexpectedly slow vs cli ${exactCliMs.toFixed(2)}ms`);
console.log(JSON.stringify({ nodes: graph.size.nodes, coldMs, warmMs, top: cold.slice(0, 2).map(({ nodeId }) => nodeId), exactCliMs, exactMcpMs, exactTop: exactMcp[0]?.name }));
