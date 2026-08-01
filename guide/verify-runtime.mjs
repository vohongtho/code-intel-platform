import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'code-intel/core/dist/cli/main.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-runtime-'));
const home = path.join(tempRoot, 'home');
const repo = path.join(tempRoot, 'fixture');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });

const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  CI: '1',
  NO_COLOR: '1',
  UPDATE_CHECK_DISABLED: '1',
  CODE_INTEL_TELEMETRY_DISABLED: '1',
};

fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'runtime-fixture', version: '1.0.0', type: 'module' }, null, 2));
fs.writeFileSync(path.join(repo, 'src/math.ts'), `
/** @deprecated use add instead */
export function legacyAdd(a: number, b: number) { return a + b; }
export function add(a: number, b: number) { return a + b; }
export function multiply(a: number, b: number) { return a * b; }
export class Calculator {
  compute(a: number, b: number, op: 'add' | 'multiply') {
    return op === 'add' ? add(a, b) : multiply(a, b);
  }
}
export const DEMO_API_KEY = 'sk-runtimeVerification123456789';
`);
fs.writeFileSync(path.join(repo, 'src/server.ts'), `
import express from 'express';
import { Calculator } from './math.js';
export const app = express();
export function healthHandler(_req: unknown, res: { json(v: unknown): void }) {
  res.json({ ok: true, value: new Calculator().compute(1, 2, 'add') });
}
app.get('/health', healthHandler);
`);
fs.writeFileSync(path.join(repo, 'tests/math.test.ts'), `
import { add, Calculator } from '../src/math.js';
export function testAdd() { return add(1, 2) === 3; }
export function testCalculator() { return new Calculator().compute(2, 3, 'multiply') === 6; }
`);

run('git', ['init'], repo);
run('git', ['config', 'user.email', 'runtime@example.com'], repo);
run('git', ['config', 'user.name', 'Runtime Verify'], repo);
run('git', ['add', '.'], repo);
run('git', ['commit', '-m', 'fixture'], repo);

const results = [];
function record(kind, name, ok, detail = '') {
  results.push({ kind, name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${kind.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}
function run(command, args, cwd = root, options = {}) {
  const r = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: options.timeout ?? 120000,
    input: options.input,
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}
function cliRun(args, cwd = repo, options = {}) {
  return run(process.execPath, [cli, ...args], cwd, options);
}
function expectCli(name, args, check, cwd = repo, options = {}) {
  const r = cliRun(args, cwd, options);
  const text = `${r.stdout}\n${r.stderr}`;
  const ok = r.code === 0 && (!check || check(text, r));
  record('CLI', name, ok, ok ? 'runtime happy path' : `exit=${r.code}; ${text.slice(0, 240).replace(/\s+/g, ' ')}`);
  return r;
}

expectCli('--version', ['--version'], (t) => /1\.0\.9/.test(t));
expectCli('init --yes', ['init', '--yes'], () => fs.existsSync(path.join(home, '.code-intel/config.json')));
expectCli('config validate', ['config', 'validate'], (t) => /valid/i.test(t));
expectCli('completion bash', ['completion', 'bash'], (t) => t.includes('code-intel'));
expectCli('analyze', ['analyze', repo, '--name', 'runtime-fixture', '--force', '--skip-embeddings', '--skip-agents-md', '--no-group-sync'], () => fs.existsSync(path.join(repo, '.code-intel/graph.db')), repo, { timeout: 240000 });
expectCli('status', ['status', repo], (t) => /Nodes\s*:/i.test(t));
expectCli('index-status', ['index-status', repo], (t) => /indexed|fresh|schema/i.test(t));
expectCli('repo list', ['repo', 'list'], (t) => t.includes('runtime-fixture'));
expectCli('repo show', ['repo', 'show', 'runtime-fixture'], (t) => t.includes('runtime-fixture'));
expectCli('search', ['search', 'Calculator', '--path', repo, '--json'], (t) => t.includes('Calculator'));
expectCli('inspect', ['inspect', 'Calculator', '--path', repo, '--json'], (t) => t.includes('Calculator'));
expectCli('impact', ['impact', 'add', '--path', repo, '--depth', '3'], (t) => /add|Calculator|compute/i.test(t));
expectCli('context', ['context', 'Calculator', '--path', repo, '--max-tokens', '1200', '--show-context'], (t) => /SUMMARY|FOCUS CODE|tokens/i.test(t));
expectCli('query', ['query', 'FIND function LIMIT 10', '--path', repo, '--format', 'json'], (t) => /add|multiply|legacyAdd/.test(t));
expectCli('health', ['health', repo], (t) => /health|score|dead code|cycles/i.test(t));
expectCli('complexity', ['complexity', repo, '--format', 'json'], (t) => /compute|complexity|\[/.test(t));
expectCli('coverage', ['coverage', repo, '--format', 'json'], (t) => /coverage|Calculator|add|\[/.test(t));
expectCli('secrets', ['secrets', repo, '--format', 'json', '--include-tests'], (t) => /DEMO_API_KEY|openai-api-key|severity|\[/.test(t));
expectCli('scan', ['scan', repo, '--format', 'json'], (t) => /findings|vulnerabilit|\[|\{/.test(t));
expectCli('deprecated', ['deprecated', repo, '--format', 'json'], (t) => /legacyAdd|deprecated|\[/.test(t));
expectCli('clean --dry-run', ['clean', repo, '--dry-run'], (t) => /Would delete/i.test(t));

expectCli('group create', ['group', 'create', 'runtime-group'], (t) => /created|runtime-group/i.test(t));
expectCli('group add', ['group', 'add', 'runtime-group', 'services/runtime', 'runtime-fixture'], (t) => /added|runtime-fixture|runtime-group/i.test(t));
expectCli('group sync', ['group', 'sync', 'runtime-group'], (t) => /sync|contract|runtime-group/i.test(t), repo, { timeout: 120000 });
expectCli('group status', ['group', 'status', 'runtime-group'], (t) => /runtime-fixture|fresh|status/i.test(t));
expectCli('group contracts', ['group', 'contracts', 'runtime-group'], (t) => /contract|runtime-fixture|No contracts/i.test(t));
expectCli('group query', ['group', 'query', 'runtime-group', 'Calculator'], (t) => /Calculator|result|runtime-fixture/i.test(t));

fs.appendFileSync(path.join(repo, 'src/math.ts'), '\nexport function subtract(a: number, b: number) { return a - b; }\n');
expectCli('change-context', ['change-context', repo, '--files', 'src/math.ts'], (t) => /math\.ts|change|impact|symbol/i.test(t));

class McpClient {
  constructor() { this.id = 1; this.pending = new Map(); this.buffer = ''; }
  async start() {
    this.proc = spawn(process.execPath, [cli, 'mcp', repo], { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            this.pending.get(msg.id).resolve(msg);
            this.pending.delete(msg.id);
          }
        } catch {}
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const init = await this.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'runtime-verifier', version: '1.0' } });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    if (init.error) throw new Error(init.error.message ?? 'MCP initialize failed');
  }
  call(method, params = {}, timeout = 30000) {
    return new Promise((resolve) => {
      const id = this.id++;
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ error: { message: 'timeout' } }); }, timeout);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); } });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  stop() { try { this.proc.kill('SIGTERM'); } catch {} }
}

function parseToolText(response) {
  const text = response?.result?.content?.map((c) => c.text ?? '').join('\n') ?? '';
  return { text, isError: Boolean(response?.result?.isError), rpcError: response?.error };
}

const toolArgs = {
  repos: {}, overview: {},
  search: { query: 'Calculator', mode: 'bm25', limit: 10 },
  inspect: { symbol_name: 'Calculator' },
  context: { symbols: ['Calculator'], max_tokens: 1200 },
  blast_radius: { target: 'add', direction: 'both', max_hops: 3 },
  file_symbols: { file_path: 'src/math.ts', limit: 50 },
  find_path: { from: 'compute', to: 'add', max_hops: 8 },
  list_exports: { limit: 50 }, routes: {}, clusters: { limit: 50 }, flows: { limit: 50 },
  detect_changes: { diff_text: 'diff --git a/src/math.ts b/src/math.ts\n--- a/src/math.ts\n+++ b/src/math.ts\n@@ -1,1 +1,2 @@\n export function add(a,b){return a+b}\n+export function subtract(a,b){return a-b}\n' },
  query: { gql: 'FIND function LIMIT 10' }, raw_query: { cypher: ':function' },
  group_list: { name: 'runtime-group' }, group_sync: { name: 'runtime-group' },
  group_contracts: { name: 'runtime-group' }, group_query: { name: 'runtime-group', query: 'Calculator', limit: 10 },
  group_status: { name: 'runtime-group' }, explain_relationship: { from: 'compute', to: 'add' },
  pr_impact: { changedFiles: ['src/math.ts'], maxHops: 3 }, similar_symbols: { symbol: 'add', limit: 10 },
  health_report: { scope: '.' }, suggest_tests: { symbol: 'Calculator' }, cluster_summary: { cluster: 'src' },
  deprecated_usage: { scope: 'src' }, complexity_hotspots: { scope: 'src', limit: 20 },
  coverage_gaps: { scope: 'src', limit: 20 }, secrets: { scope: 'src', includeTestFiles: true },
  vulnerability_scan: { scope: 'src' },
};

const client = new McpClient();
try {
  await client.start();
  const list = await client.call('tools/list');
  const names = list.result?.tools?.map((t) => t.name) ?? [];
  record('MCP', 'initialize + tools/list', names.length === 31, `${names.length} tools`);
  for (const name of names) {
    const response = await client.call('tools/call', { name, arguments: toolArgs[name] ?? {} }, name === 'group_sync' ? 60000 : 30000);
    const parsed = parseToolText(response);
    const ok = !parsed.rpcError && !parsed.isError && parsed.text.length > 0 && !/^Error\b/i.test(parsed.text.trim());
    record('MCP', name, ok, ok ? 'successful tools/call response' : (parsed.rpcError?.message ?? parsed.text.slice(0, 220).replace(/\s+/g, ' ')));
  }
  const resources = await client.call('resources/list');
  const uris = resources.result?.resources?.map((r) => r.uri) ?? [];
  record('MCP', 'resources/list', uris.length === 3, `${uris.length} resources`);
  for (const uri of uris) {
    const read = await client.call('resources/read', { uri });
    const ok = !read.error && Array.isArray(read.result?.contents) && read.result.contents.length > 0;
    record('MCP', `resources/read ${uri.split('/').pop()}`, ok, ok ? 'successful read' : (read.error?.message ?? 'empty'));
  }
} finally {
  client.stop();
}

const port = 4789;
const serverProc = spawn(process.execPath, [cli, 'serve', repo, '--port', String(port)], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
const waitForHttp = async () => {
  for (let i = 0; i < 40; i++) {
    const status = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/health/live`, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', () => resolve(0));
      req.setTimeout(1000, () => { req.destroy(); resolve(0); });
    });
    if (status === 200) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};
const serveOk = await waitForHttp();
record('CLI', 'serve + GET /health/live', serveOk, serveOk ? 'HTTP 200' : 'server did not become ready');
try { serverProc.kill('SIGTERM'); } catch {}

const failed = results.filter((r) => !r.ok);
const summary = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  sourceVersion: '1.0.9',
  cliPassed: results.filter((r) => r.kind === 'CLI' && r.ok).map((r) => r.name),
  mcpPassed: results.filter((r) => r.kind === 'MCP' && r.ok).map((r) => r.name),
  failures: failed,
};
fs.writeFileSync(path.join(root, 'guide/runtime-verification-result.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`\nRuntime verification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}
