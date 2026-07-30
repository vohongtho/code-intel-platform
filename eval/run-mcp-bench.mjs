#!/usr/bin/env node
/**
 * MCP Server Benchmark
 *
 * Starts the code-intel MCP server as a child process and exercises
 * all tools directly via the JSON-RPC stdio transport.
 *
 * Tests: repos, search (default / bm25 / vector), context,
 * inspect, blast_radius, routes, raw_query
 * + ListTools, ListResources, ReadResource
 *
 * Usage:
 *   node eval/run-mcp-bench.mjs [--json]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeGraph } from '../code-intel/core/dist-tests/src/graph/knowledge-graph.js';
import { DbManager } from '../code-intel/core/dist-tests/src/storage/db-manager.js';
import { loadGraphToDB } from '../code-intel/core/dist-tests/src/storage/graph-loader.js';
import { saveMetadata } from '../code-intel/core/dist-tests/src/storage/metadata.js';
import { Bm25Index, getBm25DbPath } from '../code-intel/core/dist-tests/src/search/bm25-index.js';
import { CURRENT_SCHEMA_VERSION } from '../code-intel/core/dist-tests/src/migrations/migration-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'code-intel', 'core', 'dist', 'cli', 'main.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'simple-ts');
const RESULTS_DIR = path.join(__dirname, 'results');
const jsonOut = process.argv.includes('--json');

// ── Seed fixture graph directly so the benchmark is deterministic ────────────
async function seedFixture() {
  fs.mkdirSync(path.join(FIXTURE, '.code-intel'), { recursive: true });
  const graph = createKnowledgeGraph();
  graph.addNode({ id: 'fn-add', kind: 'function', name: 'add', filePath: 'math.ts', content: 'export function add(a, b) { return a + b; }', exported: true, startLine: 2, endLine: 4 });
  graph.addNode({ id: 'fn-multiply', kind: 'function', name: 'multiply', filePath: 'math.ts', content: 'export function multiply(a, b) { return a * b; }', exported: true, startLine: 6, endLine: 8 });
  graph.addNode({ id: 'fn-helper', kind: 'function', name: 'internalHelper', filePath: 'math.ts', content: 'function internalHelper(x) { return x * 2; }', exported: false, startLine: 10, endLine: 12 });
  graph.addNode({ id: 'cls-calculator', kind: 'class', name: 'Calculator', filePath: 'math.ts', content: 'export class Calculator { compute(a, b, op) { if (op === "add") return add(a, b); return multiply(a, b); } }', exported: true, startLine: 14, endLine: 29 });
  graph.addNode({ id: 'method-compute', kind: 'method', name: 'compute', filePath: 'math.ts', content: 'compute(a, b, op) { if (op === "add") return add(a, b); return multiply(a, b); }', exported: false, startLine: 17, endLine: 22 });
  graph.addNode({ id: 'method-history', kind: 'method', name: 'getHistory', filePath: 'math.ts', content: 'getHistory() { return this.history; }', exported: false, startLine: 24, endLine: 26 });
  graph.addNode({ id: 'method-reset', kind: 'method', name: 'reset', filePath: 'math.ts', content: 'reset() { this.history = []; }', exported: false, startLine: 28, endLine: 30 });
  graph.addEdge({ id: 'compute-add', source: 'method-compute', target: 'fn-add', kind: 'calls' });
  graph.addEdge({ id: 'compute-multiply', source: 'method-compute', target: 'fn-multiply', kind: 'calls' });
  graph.addEdge({ id: 'calculator-compute', source: 'cls-calculator', target: 'method-compute', kind: 'has_member' });
  graph.addEdge({ id: 'calculator-history', source: 'cls-calculator', target: 'method-history', kind: 'has_member' });
  graph.addEdge({ id: 'calculator-reset', source: 'cls-calculator', target: 'method-reset', kind: 'has_member' });

  const db = new DbManager(path.join(FIXTURE, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();

  const bm25 = new Bm25Index(getBm25DbPath(FIXTURE));
  bm25.build(graph);

  saveMetadata(FIXTURE, {
    indexedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion: `bench-${Date.now()}`,
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 1, duration: 0 },
  });
}

await seedFixture();

// ── MCP client (JSON-RPC over stdio) ─────────────────────────────────────────
class McpClient {
  constructor() {
    this._msgId = 1;
    this._pending = new Map();
    this._buf = '';
  }

  start() {
    return new Promise((resolve, reject) => {
      this._proc = spawn('node', [CLI, 'mcp', FIXTURE], { stdio: ['pipe', 'pipe', 'pipe'] });

      this._proc.stdout.on('data', (chunk) => {
        this._buf += chunk.toString();
        const lines = this._buf.split('\n');
        this._buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id != null && this._pending.has(msg.id)) {
              const { resolve } = this._pending.get(msg.id);
              this._pending.delete(msg.id);
              resolve(msg);
            }
          } catch { /* ignore non-JSON */ }
        }
      });

      this._proc.stderr.on('data', () => {});
      this._proc.on('error', reject);

      // Send initialize handshake
      setTimeout(() => {
        this._sendRaw({
          jsonrpc: '2.0', id: 0, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bench', version: '1.0' } }
        });
        // Wait for initialized notification then resolve
        setTimeout(resolve, 800);
      }, 300);
    });
  }

  _sendRaw(msg) {
    this._proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this._msgId++;
      this._pending.set(id, { resolve, reject });
      this._sendRaw({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          resolve({ error: { message: 'timeout' } });
        }
      }, 8000);
    });
  }

  stop() {
    try { this._proc.kill(); } catch { }
  }
}

// ── Benchmark harness ─────────────────────────────────────────────────────────
const results = [];
let passed = 0, total = 0;

function pass(label, note = '', ms = 0) {
  const msg = `  ✅ PASS  ${label}${note ? '  (' + note + ')' : ''}${ms ? '  [' + ms + 'ms]' : ''}`;
  console.log(msg);
  results.push({ label, pass: true, note, ms });
  passed++; total++;
}
function fail(label, note = '', ms = 0) {
  const msg = `  ❌ FAIL  ${label}${note ? '  (' + note + ')' : ''}${ms ? '  [' + ms + 'ms]' : ''}`;
  console.log(msg);
  results.push({ label, pass: false, note, ms });
  total++;
}

async function bench(label, fn) {
  const t0 = Date.now();
  try {
    const { ok, note } = await fn();
    const ms = Date.now() - t0;
    ok ? pass(label, note, ms) : fail(label, note, ms);
  } catch (e) {
    fail(label, e.message, Date.now() - t0);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║            MCP Server Benchmark — code-intel tools              ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

const client = new McpClient();
await client.start();
console.log('  MCP server started\n');

// ── ListTools ─────────────────────────────────────────────────────────────────
console.log('▶ Protocol');
await bench('ListTools returns tool list', async () => {
  const r = await client.call('tools/list');
  const tools = r.result?.tools ?? [];
  const names = tools.map(t => t.name);
  const expected = ['repos', 'search', 'context', 'inspect', 'blast_radius', 'routes', 'raw_query'];
  const missing = expected.filter(e => !names.includes(e));
  return missing.length === 0
    ? { ok: true, note: `${tools.length} tools` }
    : { ok: false, note: `missing: ${missing.join(', ')}` };
});

await bench('ListResources returns resource list', async () => {
  const r = await client.call('resources/list');
  const resources = r.result?.resources ?? [];
  return resources.length >= 1
    ? { ok: true, note: `${resources.length} resources` }
    : { ok: false, note: 'no resources' };
});

// ── Tool: repos ───────────────────────────────────────────────────────────────
console.log('\n▶ Tool: repos');
await bench('repos: returns indexed repo', async () => {
  const r = await client.call('tools/call', { name: 'repos', arguments: {} });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return Array.isArray(data) && data.length > 0
    ? { ok: true, note: data[0].name }
    : { ok: false, note: text.slice(0, 60) };
});

await bench('repos: has node+edge counts', async () => {
  const r = await client.call('tools/call', { name: 'repos', arguments: {} });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  const repo = data.find((row) => row.name === 'simple-ts') ?? data[0] ?? {};
  const nodes = repo.nodes ?? repo.stats?.nodes;
  const edges = repo.edges ?? repo.stats?.edges;
  return Number.isFinite(nodes) && Number.isFinite(edges)
    ? { ok: true, note: `${nodes}n ${edges}e` }
    : { ok: false, note: JSON.stringify(repo) };
});

// ── Tool: search ──────────────────────────────────────────────────────────────
console.log('\n▶ Tool: search');
await bench('search: default mode finds Calculator', async () => {
  const r = await client.call('tools/call', { name: 'search', arguments: { query: 'Calculator', limit: 5 } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return data.results?.some((row) => row.name === 'Calculator')
    ? { ok: true, note: `mode=${data.searchMode}` }
    : { ok: false, note: text.slice(0, 120) };
});

await bench('search: bm25 mode finds add function', async () => {
  const r = await client.call('tools/call', { name: 'search', arguments: { query: 'add', limit: 10, mode: 'bm25' } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return data.searchMode === 'bm25' && data.results?.some((row) => row.name === 'add')
    ? { ok: true, note: `mode=${data.searchMode}` }
    : { ok: false, note: text.slice(0, 120) };
});

await bench('search: vector mode reports vector or bm25 fallback', async () => {
  const r = await client.call('tools/call', { name: 'search', arguments: { query: 'Calculator', limit: 5, mode: 'vector' } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return (data.searchMode === 'vector' || data.searchMode === 'bm25') && Array.isArray(data.results)
    ? { ok: true, note: `mode=${data.searchMode}` }
    : { ok: false, note: text.slice(0, 120) };
});

await bench('search: omitted mode preserves current default shape', async () => {
  const r = await client.call('tools/call', { name: 'search', arguments: { query: 'Calculator', limit: 2 } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return Array.isArray(data.results) && data.results.length <= 2 && typeof data.searchMode === 'string'
    ? { ok: true, note: `${data.results.length} results` }
    : { ok: false, note: text.slice(0, 120) };
});

// ── Tool: context ─────────────────────────────────────────────────────────────
console.log('\n▶ Tool: context');
await bench('context: single seed returns structured blocks', async () => {
  const r = await client.call('tools/call', { name: 'context', arguments: { symbols: ['Calculator'] } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return typeof data.summary === 'string' && typeof data.logic === 'string' && typeof data.relation === 'string' && typeof data.focusCode === 'string'
    ? { ok: true, note: `truncated=${data.truncated}` }
    : { ok: false, note: text.slice(0, 120) };
});

await bench('context: multi-seed returns combined context', async () => {
  const r = await client.call('tools/call', { name: 'context', arguments: { symbols: ['Calculator', 'add'] } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return typeof data.summary === 'string' && data.summary.includes('Calculator') && data.summary.includes('add')
    ? { ok: true, note: data.symbols?.join(', ') ?? 'summary matched' }
    : { ok: false, note: text.slice(0, 120) };
});

// ── Tool: inspect ─────────────────────────────────────────────────────────────
console.log('\n▶ Tool: inspect');
await bench('inspect: finds Calculator node', async () => {
  const r = await client.call('tools/call', { name: 'inspect', arguments: { symbol_name: 'Calculator' } });
  const text = r.result?.content?.[0]?.text ?? '';
  return text.includes('Calculator')
    ? { ok: true }
    : { ok: false, note: text.slice(0, 80) };
});

await bench('inspect: returns file path + exported flag', async () => {
  const r = await client.call('tools/call', { name: 'inspect', arguments: { symbol_name: 'add' } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return data.node?.filePath && data.node?.exported !== undefined
    ? { ok: true, note: `${data.node.filePath} exported=${data.node.exported}` }
    : { ok: false, note: text.slice(0, 100) };
});

await bench('inspect: not-found returns message', async () => {
  const r = await client.call('tools/call', { name: 'inspect', arguments: { symbol_name: 'nonExistentXYZ999' } });
  const text = r.result?.content?.[0]?.text ?? '';
  return text.includes('not found')
    ? { ok: true }
    : { ok: false, note: text.slice(0, 80) };
});

// ── Tool: blast_radius ────────────────────────────────────────────────────────
console.log('\n▶ Tool: blast_radius');
await bench('blast_radius: add affects ≥ 1 symbol', async () => {
  const r = await client.call('tools/call', { name: 'blast_radius', arguments: { target: 'add', direction: 'both' } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return data.affectedCount >= 1
    ? { ok: true, note: `${data.affectedCount} affected` }
    : { ok: false, note: text.slice(0, 80) };
});

await bench('blast_radius: returns affected array with names', async () => {
  const r = await client.call('tools/call', { name: 'blast_radius', arguments: { target: 'add', direction: 'callers' } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  return Array.isArray(data.affected) && data.affected[0]?.name
    ? { ok: true, note: data.affected.map(a => a.name).join(', ') }
    : { ok: false, note: text.slice(0, 100) };
});

await bench('blast_radius: unknown symbol returns not found', async () => {
  const r = await client.call('tools/call', { name: 'blast_radius', arguments: { target: 'ghostFunction999' } });
  const text = r.result?.content?.[0]?.text ?? '';
  return text.includes('not found')
    ? { ok: true }
    : { ok: false, note: text.slice(0, 80) };
});

// ── Tool: raw_query ───────────────────────────────────────────────────────────
console.log('\n▶ Tool: raw_query');
await bench("raw_query: name='Calculator' returns node", async () => {
  const r = await client.call('tools/call', { name: 'raw_query', arguments: { cypher: "name='Calculator'" } });
  const text = r.result?.content?.[0]?.text ?? '';
  return text.includes('Calculator')
    ? { ok: true }
    : { ok: false, note: text.slice(0, 80) };
});

await bench('raw_query: :function returns functions', async () => {
  const r = await client.call('tools/call', { name: 'raw_query', arguments: { cypher: ':function' } });
  const text = r.result?.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  const results = Array.isArray(data) ? data : data.results;
  return Array.isArray(results) && results.some(n => n.kind === 'function')
    ? { ok: true, note: `${results.length} functions` }
    : { ok: false, note: text.slice(0, 80) };
});

// ── Resources ─────────────────────────────────────────────────────────────────
console.log('\n▶ Resources');
await bench('ReadResource: /overview returns stats', async () => {
  const r = await client.call('resources/list');
  const uri = r.result?.resources?.[0]?.uri;
  if (!uri) return { ok: false, note: 'no resources listed' };
  const rr = await client.call('resources/read', { uri });
  const text = rr.result?.contents?.[0]?.text ?? '';
  return text.includes('nodes') || text.includes('stats')
    ? { ok: true, note: text.slice(0, 60) }
    : { ok: false, note: text.slice(0, 80) };
});

// ── Summary ───────────────────────────────────────────────────────────────────
client.stop();

const score = Math.round((passed / total) * 100);
const avgMs = Math.round(results.filter(r => r.ms).reduce((s, r) => s + r.ms, 0) / results.filter(r => r.ms).length);

console.log('\n═══════════════════════════════════════════════════════');
console.log(`  Score: ${passed}/${total} (${score}%)   Avg latency: ${avgMs}ms/call`);
console.log('═══════════════════════════════════════════════════════\n');

const failures = results.filter(r => !r.pass);
if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  • ${f.label}${f.note ? ': ' + f.note : ''}`);
  console.log('');
}

if (jsonOut) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `bench-mcp-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ fixture: 'simple-ts', type: 'mcp', score, passed, total, avgLatencyMs: avgMs, results }, null, 2));
  console.log(`Results: ${out}\n`);
}

process.exit(score === 100 ? 0 : 1);
