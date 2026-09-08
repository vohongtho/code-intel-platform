#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { buildRuntimeBundle } from './distribution/build-runtime-bundle.mjs';
import { installRuntime } from './distribution/install/install-runtime.mjs';

function makeFakeNodeRuntime(root) {
  const runtimeDir = path.join(root, 'node-vtest-linux-x64');
  fs.mkdirSync(path.join(runtimeDir, 'bin'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(runtimeDir, 'bin', 'node'));
  fs.chmodSync(path.join(runtimeDir, 'bin', 'node'), 0o755);
  return runtimeDir;
}

function run(cmd, args, opts = {}) {
  const child = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: opts.env,
    cwd: opts.cwd,
    timeout: opts.timeout ?? 20000,
    shell: false,
  });
  if (child.status !== 0) {
    throw new Error(`command failed: ${cmd} ${args.join(' ')}\nstdout=${child.stdout}\nstderr=${child.stderr}`);
  }
  return child;
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-runtime-verify-'));
  const repoDir = path.join(tmpDir, 'repo');
  const installRoot = path.join(tmpDir, 'install-root');
  const globalDir = path.join(tmpDir, 'global-dir');
  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'runtime-verify', private: true }, null, 2));
  fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const runtimeValue = 1;\n');

  const bundle = await buildRuntimeBundle({
    target: 'linux-x64',
    outDir: tmpDir,
    nodeRuntimeDir: makeFakeNodeRuntime(tmpDir),
    archiveMtime: '2024-01-01T00:00:00.000Z',
  });

  const installed = installRuntime({
    archive: bundle.archivePath,
    checksumFile: bundle.checksumPath,
    installRoot,
    skipPathCheck: true,
  });

  const launcher = installed.launcherPath;
  const env = {
    ...process.env,
    PATH: '/usr/bin:/bin',
    HOME: globalDir,
    CODE_INTEL_GLOBAL_DIR: globalDir,
    CODE_INTEL_BUNDLED_CURRENT_ROOT: path.join(installRoot, 'current'),
    UPDATE_CHECK_DISABLED: '1',
  };

  const version = run('/bin/sh', [launcher, '--version'], { env });
  const analyze = run('/bin/sh', [launcher, 'analyze', repoDir, '--skip-embeddings', '--skip-agents-md', '--skip-git'], { env, cwd: repoDir, timeout: 120000 });
  const doctor = run('/bin/sh', [launcher, 'doctor', '--json'], { env, cwd: repoDir });
  const search = run('/bin/sh', [launcher, 'search', 'runtimeValue'], { env, cwd: repoDir, timeout: 30000 });

  // Task 5.6: server/MCP startup from the bundled runtime, not just CLI commands.
  const mcpProtocolVersion = await verifyBundledMcpStartup(launcher, repoDir, env);
  const serveHealthy = await verifyBundledServeStartup(launcher, repoDir, env);
  if (!serveHealthy) throw new Error('bundled runtime `serve` did not become healthy within 30s');

  const rollbackFail = spawnSync('/bin/sh', [launcher, 'upgrade', '--archive', bundle.archivePath, '--checksum', '0'.repeat(64)], { encoding: 'utf8', env, cwd: repoDir });
  if (rollbackFail.status === 0) throw new Error('expected failed upgrade to preserve existing runtime');
  const preserved = run('/bin/sh', [launcher, '--version'], { env });
  const uninstall = run('/bin/sh', [launcher, 'uninstall'], { env, cwd: repoDir });

  const result = {
    version: version.stdout.trim(),
    doctorOk: JSON.parse(doctor.stdout).ok,
    analyzeOk: /Analysis complete|Indexed|graph/i.test(analyze.stdout + analyze.stderr),
    searchOutput: search.stdout.trim(),
    mcpProtocolVersion,
    serveHealthy,
    failedUpgradePreservedVersion: preserved.stdout.trim() === version.stdout.trim(),
    uninstallOutput: uninstall.stdout.trim(),
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function verifyBundledMcpStartup(launcher, repoDir, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', [launcher, 'mcp', repoDir], { cwd: repoDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`bundled MCP server did not respond within 15s. stderr=${stderr}`));
    }, 15_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      for (const line of stdout.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            clearTimeout(timeout);
            child.kill();
            resolve(msg.result.protocolVersion ?? 'unknown');
            return;
          }
        } catch { /* partial line */ }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => { clearTimeout(timeout); reject(err); });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) { clearTimeout(timeout); reject(new Error(`bundled MCP server exited early with code ${code}. stderr=${stderr}`)); }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-runtime-distribution', version: '0.0.0' } },
    })}\n`);
  });
}

async function verifyBundledServeStartup(launcher, repoDir, env) {
  const port = 24000 + (process.pid % 5000);
  const child = spawn('/bin/sh', [launcher, 'serve', repoDir, '--port', String(port)], { cwd: repoDir, env, stdio: 'ignore' });
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const healthy = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${port}/health/live`, (res) => resolve(res.statusCode === 200)).on('error', () => resolve(false));
      });
      if (healthy) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
