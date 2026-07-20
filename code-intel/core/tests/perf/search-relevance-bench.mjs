#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createKnowledgeGraph, textSearch } from '../../dist/index.js';

const graph = createKnowledgeGraph();
graph.addNode({ id: 'page', kind: 'file', name: 'LoginPage', filePath: 'web/pages/LoginPage.tsx', content: 'portal authentication login page' });
graph.addNode({ id: 'api', kind: 'method', name: 'login', filePath: 'web/api/client.ts', content: 'login to portal' });
graph.addNode({ id: 'noise', kind: 'variable', name: 'token', filePath: 'core/query.ts', content: 'login token processing' });
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
console.log(JSON.stringify({ nodes: graph.size.nodes, coldMs, warmMs, top: cold.slice(0, 2).map(({ nodeId }) => nodeId) }));
