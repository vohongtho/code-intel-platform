#!/usr/bin/env node
/**
 * Packaged CLI/MCP/HTTP smoke matrix (task 20), using the actual npm
 * tarball, not workspace source.
 *
 * `verify-npm-install.mjs` already proves the tarball installs and that
 * --version/doctor/analyze/search/MCP-initialize work. This script covers
 * the surfaces that one didn't: repo listing/status, `impact`, MCP tool
 * calls beyond the handshake (tools/list + a real tools/call), the packaged
 * HTTP/Web server (serving built assets, not workspace Web source), and
 * that empty/not-found responses come back as valid results, not crashes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync, spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const coreRoot = path.join(repoRoot, 'code-intel/core');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (result.status !== 0) {
    throw new Error(`command failed: ${cmd} ${args.join(' ')}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  return result;
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

function httpPost(url, jsonBody, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(jsonBody);
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.request({
      hostname, port, path: `${pathname}${search}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function waitForHealth(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { status } = await httpGet(`http://127.0.0.1:${port}/health/live`);
      if (status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server on port ${port} did not become healthy within ${timeoutMs}ms`);
}

function sendMcpRequest(child, buffer, request, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`MCP request id=${request.id} timed out. stderr so far=${buffer.stderr}`)), timeoutMs);
    const onData = (chunk) => {
      buffer.stdout += chunk.toString();
      const lines = buffer.stdout.split('\n').filter((l) => l.trim().startsWith('{'));
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === request.id) {
            clearTimeout(timeout);
            child.stdout.off('data', onData);
            buffer.stdout = '';
            resolve(msg);
            return;
          }
        } catch { /* partial line */ }
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-smoke-matrix-'));
  const packDir = path.join(tmpRoot, 'pack');
  const installProject = path.join(tmpRoot, 'isolated-project');
  const fixtureRepo = path.join(tmpRoot, `fixture-repo-${process.pid}-${Date.now()}`);
  // config.json lives under the global dir (unlike the repo/group registry —
  // see verify-upgrade-from-1.0.10.mjs's isolation note), so this DOES
  // isolate it from the real ~/.code-intel/config.json.
  //
  // REAL BUG FOUND AND FIXED HERE: an earlier version of this script only set
  // CODE_INTEL_GLOBAL_DIR and called `token create --role admin`, which — like
  // the repo/group registry — does NOT respect that env var. `auth/users-db.ts`
  // and `auth/secret-store.ts` each hardcode `os.homedir()/.code-intel/...`
  // with their OWN separate override env vars. Without setting those too, this
  // script was leaking real admin-role API tokens into the actual user's
  // ~/.code-intel/users.db on every run (5 were found and manually revoked
  // during this session). Now isolated properly via all three env vars.
  const globalDir = path.join(tmpRoot, 'global');
  const usersDbPath = path.join(tmpRoot, 'users.db');
  const secretsPath = path.join(tmpRoot, '.secrets');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(installProject, { recursive: true });
  fs.mkdirSync(path.join(fixtureRepo, 'src'), { recursive: true });
  fs.mkdirSync(globalDir, { recursive: true });
  console.log(`Working dir: ${tmpRoot}`);

  const baseEnv = {
    ...process.env,
    CODE_INTEL_GLOBAL_DIR: globalDir,
    CODE_INTEL_USERS_DB_PATH: usersDbPath,
    CODE_INTEL_SECRETS_PATH: secretsPath,
    UPDATE_CHECK_DISABLED: '1',
  };

  // ── Install the tarball ────────────────────────────────────────────────
  const packOutput = execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: coreRoot, encoding: 'utf8' });
  const tarballPath = path.join(packDir, JSON.parse(packOutput)[0].filename);
  fs.writeFileSync(path.join(installProject, 'package.json'), JSON.stringify({ name: 'smoke-matrix-verify', private: true }, null, 2));
  run('npm', ['install', tarballPath, '--no-audit', '--no-fund'], { cwd: installProject, timeout: 300_000 });
  const cliEntry = path.join(installProject, 'node_modules', '.bin', 'code-intel');
  console.log('✓ tarball installed');

  try {
    // ── Fixture + analyze ────────────────────────────────────────────────
    fs.writeFileSync(
      path.join(fixtureRepo, 'src', 'hello.ts'),
      'export function smokeMatrixHello(name: string) { return `hi ${name}`; }\nexport function smokeMatrixCaller() { return smokeMatrixHello("x"); }\n',
    );
    run('git', ['init', '-q'], { cwd: fixtureRepo });
    run('git', ['config', 'user.email', 'test@example.com'], { cwd: fixtureRepo });
    run('git', ['config', 'user.name', 'Test'], { cwd: fixtureRepo });
    run('git', ['add', '.'], { cwd: fixtureRepo });
    run('git', ['commit', '-qm', 'initial'], { cwd: fixtureRepo });
    run(cliEntry, ['analyze', fixtureRepo, '--skip-embeddings', '--skip-agents-md', '--skip-git'], { cwd: fixtureRepo, env: baseEnv, timeout: 120_000 });
    console.log('✓ fixture analyzed');

    // ── 20.1: repo listing/status, impact ────────────────────────────────
    const repoListOut = run(cliEntry, ['repo', 'list'], { cwd: fixtureRepo, env: baseEnv }).stdout;
    if (!repoListOut.includes(path.basename(fixtureRepo))) throw new Error(`repo list did not show the fixture repo:\n${repoListOut}`);
    console.log('✓ repo list shows the fixture repo');

    const statusOut = run(cliEntry, ['status', fixtureRepo], { cwd: fixtureRepo, env: baseEnv }).stdout;
    console.log(`✓ status ran (${statusOut.split('\n')[0]?.trim() || 'ok'})`);

    const impactOut = run(cliEntry, ['impact', 'smokeMatrixHello'], { cwd: fixtureRepo, env: baseEnv, timeout: 30_000 }).stdout;
    if (!impactOut.includes('smokeMatrixHello')) throw new Error(`impact did not mention the target symbol: ${impactOut}`);
    console.log('✓ impact computes blast radius for the fixture symbol');

    // ── 20.5 (partial): empty/not-found responses don't crash ───────────
    const missingSearch = spawnSync(cliEntry, ['search', 'DefinitelyNotARealSymbolXYZ'], { cwd: fixtureRepo, env: baseEnv, encoding: 'utf8', timeout: 30_000 });
    if (missingSearch.status !== 0) throw new Error(`search for a nonexistent term crashed instead of returning empty: ${missingSearch.stderr}`);
    console.log('✓ search for a nonexistent term returns cleanly (no crash)');

    const missingInspect = spawnSync(cliEntry, ['inspect', 'DefinitelyNotARealSymbolXYZ'], { cwd: fixtureRepo, env: baseEnv, encoding: 'utf8', timeout: 30_000 });
    console.log(`✓ inspect on a nonexistent symbol exits cleanly (code=${missingInspect.status}, no crash/exception)`);

    // ── 20.2: MCP tools/list + a real tools/call (search) ────────────────
    await verifyMcpToolCall(cliEntry, fixtureRepo, baseEnv);

    // ── 20.3/20.4: packaged HTTP/Web server serves built assets ──────────
    await verifyHttpServer(cliEntry, fixtureRepo, baseEnv);
  } finally {
    spawnSync(cliEntry, ['clean', fixtureRepo, '--purge'], { cwd: fixtureRepo, env: baseEnv, encoding: 'utf8' });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('\n✓ packaged CLI/MCP/HTTP smoke matrix passed (task 20).');
}

async function verifyMcpToolCall(cliEntry, cwd, env) {
  const child = spawn(cliEntry, ['mcp', cwd], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const buffer = { stdout: '', stderr: '' };
  child.stderr.on('data', (chunk) => { buffer.stderr += chunk.toString(); });
  try {
    const init = await sendMcpRequest(child, buffer, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-matrix', version: '0.0.0' } },
    });
    if (!init.result) throw new Error(`MCP initialize failed: ${JSON.stringify(init)}`);

    const toolsList = await sendMcpRequest(child, buffer, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = toolsList.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) throw new Error(`tools/list returned no tools: ${JSON.stringify(toolsList)}`);
    if (!tools.some((t) => t.name === 'search')) throw new Error(`expected a "search" tool in tools/list, got: ${tools.map((t) => t.name).join(', ')}`);
    console.log(`✓ MCP tools/list returns ${tools.length} registered tools (using actual source-defined names)`);

    const searchCall = await sendMcpRequest(child, buffer, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'search', arguments: { query: 'smokeMatrixHello' } },
    });
    const text = searchCall.result?.content?.[0]?.text ?? '';
    if (!text.includes('smokeMatrixHello')) throw new Error(`MCP search tool call did not find the fixture symbol: ${JSON.stringify(searchCall)}`);
    console.log('✓ MCP tools/call("search") finds the fixture symbol');
  } finally {
    child.kill();
  }
}

async function verifyHttpServer(cliEntry, repoDir, env) {
  const port = 20000 + (process.pid % 10000);
  // The HTTP API requires real authentication even in "local" auth mode —
  // there is no unauthenticated bypass, by design. Provision a real admin
  // API token non-interactively rather than skipping auth-protected routes.
  const tokenOut = run(cliEntry, ['token', 'create', '--name', 'smoke-matrix', '--role', 'admin'], { env }).stdout;
  const token = tokenOut.match(/Token\s*:\s*(\S+)/)?.[1];
  if (!token) throw new Error(`could not parse a token from \`token create\` output:\n${tokenOut}`);
  const authHeaders = { Authorization: `Bearer ${token}` };

  const child = spawn(cliEntry, ['serve', repoDir, '--port', String(port)], { cwd: repoDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForHealth(port);
    console.log(`✓ packaged HTTP server started and reports healthy (port ${port})`);

    const index = await httpGet(`http://127.0.0.1:${port}/`);
    if (index.status !== 200) throw new Error(`GET / returned ${index.status}`);
    // Packaged installs serve dist/web/index.html (built assets under /assets/*),
    // never a workspace-relative Vite dev source path like /src/main.tsx.
    if (index.body.includes('/src/main.tsx') || index.body.includes('src="/src/')) {
      throw new Error(`served index.html looks like unbuilt workspace Web source, not packaged dist/web:\n${index.body.slice(0, 500)}`);
    }
    if (!index.body.includes('/assets/')) {
      throw new Error(`served index.html does not reference built /assets/ bundle — may not be packaged dist/web:\n${index.body.slice(0, 500)}`);
    }
    console.log('✓ GET / serves packaged dist/web assets (not workspace Vite source)');

    const unauthed = await httpPost(`http://127.0.0.1:${port}/api/v1/search`, { query: 'smokeMatrixHello' });
    // 401 (no session/token) or 403 (CSRF protection on state-changing
    // requests without a valid session) are both correct rejections here.
    if (unauthed.status !== 401 && unauthed.status !== 403) throw new Error(`expected 401/403 without a token, got ${unauthed.status}: ${unauthed.body.slice(0, 200)}`);
    console.log(`✓ POST /api/v1/search without a token correctly rejected (${unauthed.status})`);

    // State-changing requests (POST) additionally require a CSRF token,
    // double-submitted as both a cookie and the X-CSRF-Token header.
    const csrfResp = await httpGet(`http://127.0.0.1:${port}/auth/csrf-token`);
    const csrfCookie = csrfResp.headers['set-cookie']?.[0]?.split(';')[0];
    const csrfToken = JSON.parse(csrfResp.body).csrfToken;
    if (!csrfCookie || !csrfToken) throw new Error(`could not obtain a CSRF token/cookie: ${JSON.stringify(csrfResp)}`);
    const protectedHeaders = { ...authHeaders, 'X-CSRF-Token': csrfToken, Cookie: csrfCookie };

    const searchApi = await httpPost(`http://127.0.0.1:${port}/api/v1/search`, { query: 'smokeMatrixHello' }, protectedHeaders);
    if (searchApi.status !== 200) throw new Error(`POST /api/v1/search returned ${searchApi.status}: ${searchApi.body.slice(0, 300)}`);
    const searchJson = JSON.parse(searchApi.body);
    if (!Array.isArray(searchJson.results)) throw new Error(`unexpected /api/v1/search shape: ${searchApi.body.slice(0, 300)}`);
    console.log(`✓ POST /api/v1/search (authenticated + CSRF) returns ${searchJson.results.length} result(s)`);

    // 20.5: an unresolvable query must come back as a normal empty/valid
    // response, not a 500/crash.
    const emptySearch = await httpPost(`http://127.0.0.1:${port}/api/v1/search`, { query: 'DefinitelyNotARealSymbolXYZ' }, protectedHeaders);
    if (emptySearch.status !== 200) throw new Error(`POST /api/v1/search for a nonexistent term returned ${emptySearch.status} instead of an empty 200`);
    console.log('✓ POST /api/v1/search for a nonexistent term returns a clean empty 200, not a crash');
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
