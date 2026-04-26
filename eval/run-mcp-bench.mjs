#!/usr/bin/env node
/**
 * MCP Server Benchmark
 *
 * Starts the code-intel MCP server as a child process and exercises
 * all tools directly via the JSON-RPC stdio transport.
 *
 * Tests: repos, search, inspect, blast_radius, routes, raw_query
 * + ListTools, ListResources, ReadResource
 *
 * Usage:
 *   node eval/run-mcp-bench.mjs [--json]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'code-intel', 'core', 'dist', 'cli', 'main.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'simple-ts');
const RESULTS_DIR = path.join(__dirname, 'results');
const jsonOut = process.argv.includes('--json');

// ── Ensure fixture is analyzed first ─────────────────────────────────────────
spawnSync('node', [CLI, 'analyze', FIXTURE], { encoding: 'utf-8', timeout: 30_000 });

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
  const expected = ['repos', 'search', 'inspect', 'blast_radius', 'routes', 'raw_query'];
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
  const repo = data[0] ?? {};
  return repo.nodes > 0 && repo.edges > 0
    ? { ok: true, note: `${repo.nodes}n ${repo.edges}e` }
    : { ok: false, note: JSON.stringify(repo) };
});

// ── Tool: search ──────────────────────────────────────────────────────────────
console.log('\n▶ Tool: search');
await bench('search: finds Calculator', async () => {
  const r = await client.call('tools/call', { name: 'search', arguments: { query: 'Calculator', limit: 5 } });
  const text = r.result?.content?.[0]?.text ?? '';
  return text.includes('Calculator')
    ? { ok: true }
    : { ok: false, note: text.slice(0, 80) };
});

await bench('search: finds add function', async () => {
  const r = await client.call('tools/call', { name: 'search', arguments: { query: 'add', limit: 10 } });
  const text = r.result?.content?.[0]?.text ?? '';
  return text.includes('add')
    ? { ok: true }
    : { ok: false, note: text.slice(0, 80) };
});

await bench('search: respects limit', async () => {
  const r = await client.call('tools/call', { name: 'search', arguments: { query: 'Calculator', limit: 2 } });
  const text = r.result?.content?.[0]?.text ?? '';
  const results = JSON.parse(text);
  return Array.isArray(results) && results.length <= 2
    ? { ok: true, note: `${results.length} results` }
    : { ok: false, note: `${Array.isArray(results) ? results.length : '?'} results` };
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
  return Array.isArray(data) && data.some(n => n.kind === 'function')
    ? { ok: true, note: `${data.length} functions` }
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
