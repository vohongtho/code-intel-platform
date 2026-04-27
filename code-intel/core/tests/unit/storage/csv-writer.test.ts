import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeNodeCSVs, writeEdgeCSV } from '../../../src/storage/csv-writer.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `csv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Wait for write streams to fully flush to disk */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

describe('writeNodeCSVs', () => {
  let dir: string;
  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns empty map for empty graph', async () => {
    const graph = createKnowledgeGraph();
    const result = writeNodeCSVs(graph, path.join(dir, 'empty'));
    await flush();
    assert.equal(result.size, 0);
  });

  it('creates a CSV file for function nodes', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn-1', kind: 'function', name: 'myFunc', filePath: '/src/foo.ts' });
    const outDir = path.join(dir, 'nodes');
    const result = writeNodeCSVs(graph, outDir);
    await flush();
    assert.ok(result.has('func_nodes'));
    const filePath = result.get('func_nodes')!;
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('myFunc'));
  });

  it('creates separate CSV files for different node kinds', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn-2', kind: 'function', name: 'fn2', filePath: '/src/a.ts' });
    graph.addNode({ id: 'cls-1', kind: 'class', name: 'MyClass', filePath: '/src/b.ts' });
    const outDir = path.join(dir, 'multi-kind');
    const result = writeNodeCSVs(graph, outDir);
    await flush();
    assert.ok(result.has('func_nodes'));
    assert.ok(result.has('class_nodes'));
    assert.equal(result.size, 2);
  });

  it('CSV includes header row', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn-3', kind: 'function', name: 'header_test', filePath: '/src/c.ts' });
    const outDir = path.join(dir, 'header');
    const result = writeNodeCSVs(graph, outDir);
    await flush();
    const content = fs.readFileSync(result.get('func_nodes')!, 'utf-8');
    assert.ok(content.startsWith('id,name,file_path'));
  });

  it('CSV contains node data', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'method-1', kind: 'method', name: 'run', filePath: '/src/runner.ts', startLine: 10, endLine: 20, exported: true });
    const outDir = path.join(dir, 'with-meta');
    const result = writeNodeCSVs(graph, outDir);
    await flush();
    const content = fs.readFileSync(result.get('method_nodes')!, 'utf-8');
    assert.ok(content.includes('method-1'));
    assert.ok(content.includes('run'));
  });

  it('handles content with commas by quoting', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn-quote', kind: 'function', name: 'fn,quoted', filePath: '/src/a.ts' });
    const outDir = path.join(dir, 'quoted');
    const result = writeNodeCSVs(graph, outDir);
    await flush();
    const content = fs.readFileSync(result.get('func_nodes')!, 'utf-8');
    assert.ok(content.includes('"'));
  });
});

describe('writeEdgeCSV', () => {
  let dir: string;
  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns empty array for graph with no edges', async () => {
    const graph = createKnowledgeGraph();
    const result = writeEdgeCSV(graph, path.join(dir, 'no-edges'));
    await flush();
    assert.equal(result.length, 0);
  });

  it('creates edge CSV for function→function calls', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'a', kind: 'function', name: 'a', filePath: '/src/a.ts' });
    graph.addNode({ id: 'b', kind: 'function', name: 'b', filePath: '/src/b.ts' });
    graph.addEdge({ id: 'e1', source: 'a', target: 'b', kind: 'calls', weight: 1.0, label: 'b' });
    const outDir = path.join(dir, 'fn-edge');
    const result = writeEdgeCSV(graph, outDir);
    await flush();
    assert.equal(result.length, 1);
    assert.ok(fs.existsSync(result[0]!.filePath));
    const content = fs.readFileSync(result[0]!.filePath, 'utf-8');
    assert.ok(content.includes('calls'));
    assert.ok(content.includes('a'));
    assert.ok(content.includes('b'));
  });

  it('skips edges whose source/target nodes are missing', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'a', kind: 'function', name: 'a', filePath: '/src/a.ts' });
    graph.addEdge({ id: 'e1', source: 'a', target: 'b-missing', kind: 'calls', weight: 1.0 });
    const outDir = path.join(dir, 'skip-missing');
    const result = writeEdgeCSV(graph, outDir);
    await flush();
    assert.equal(result.length, 0);
  });

  it('groups edges by table pair into one file', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'f1', kind: 'function', name: 'f1', filePath: '/src/a.ts' });
    graph.addNode({ id: 'f2', kind: 'function', name: 'f2', filePath: '/src/b.ts' });
    graph.addNode({ id: 'f3', kind: 'function', name: 'f3', filePath: '/src/c.ts' });
    graph.addEdge({ id: 'e1', source: 'f1', target: 'f2', kind: 'calls', weight: 1.0 });
    graph.addEdge({ id: 'e2', source: 'f2', target: 'f3', kind: 'calls', weight: 1.0 });
    const outDir = path.join(dir, 'grouped');
    const result = writeEdgeCSV(graph, outDir);
    await flush();
    // All func→func edges go to a single file
    assert.equal(result.length, 1);
    const content = fs.readFileSync(result[0]!.filePath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 3); // header + 2 data rows
  });

  it('returns groups with correct fromTable and toTable', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn', kind: 'function', name: 'fn', filePath: '/src/a.ts' });
    graph.addNode({ id: 'cls', kind: 'class', name: 'Cls', filePath: '/src/b.ts' });
    graph.addEdge({ id: 'e1', source: 'fn', target: 'cls', kind: 'calls', weight: 1.0 });
    const outDir = path.join(dir, 'fn-cls');
    const result = writeEdgeCSV(graph, outDir);
    await flush();
    assert.equal(result.length, 1);
    assert.equal(result[0]!.fromTable, 'func_nodes');
    assert.equal(result[0]!.toTable, 'class_nodes');
  });
});
