#!/usr/bin/env node
/**
 * npm tarball isolated-install smoke test (tasks 4.4 / 4.5 / 4.6).
 *
 * `validate-dist.mjs` proves the tarball *contains* the right files.
 * This proves the tarball actually *works* once installed like a real user
 * would install it: no workspace symlink, a real `npm install <tarball>`
 * into an unrelated temp project, then exercised through the installed
 * `bin/code-intel` entrypoint only (never a `code-intel/core/dist/...` path
 * from this repo checkout).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-npm-install-verify-'));
  const packDir = path.join(tmpRoot, 'pack');
  const installProject = path.join(tmpRoot, 'isolated-project');
  // Repository name is registered globally (~/.code-intel registry), keyed
  // by directory basename — so this MUST be unique per run, not just per
  // tmpdir, or a second run on the same machine collides with a stale
  // registry entry from a prior run's (already-deleted) fixture.
  const fixtureRepo = path.join(tmpRoot, `fixture-repo-${process.pid}-${Date.now()}`);
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(installProject, { recursive: true });
  fs.mkdirSync(path.join(fixtureRepo, 'src'), { recursive: true });

  console.log(`Working dir: ${tmpRoot}`);

  // 1. Pack the tarball (no workspace symlink involved from this point on).
  const packOutput = execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: coreRoot,
    encoding: 'utf8',
  });
  const tarballName = JSON.parse(packOutput)[0].filename;
  const tarballPath = path.join(packDir, tarballName);
  console.log(`✓ packed ${tarballName}`);

  // 2. Install into an isolated project with no relation to this repo checkout.
  fs.writeFileSync(path.join(installProject, 'package.json'), JSON.stringify({ name: 'isolated-install-verify', private: true }, null, 2));
  // Native deps (@ladybugdb/core, onnxruntime-node, sharp) need their install
  // scripts to fetch/build platform binaries — do NOT pass --ignore-scripts.
  run('npm', ['install', tarballPath, '--no-audit', '--no-fund'], { cwd: installProject, timeout: 300_000 });
  const cliEntry = path.join(installProject, 'node_modules', '.bin', 'code-intel');
  if (!fs.existsSync(cliEntry)) throw new Error(`expected installed bin at ${cliEntry}, not found`);
  console.log(`✓ installed into isolated project, no workspace symlink (${cliEntry})`);

  // 3. --version
  const expectedVersion = JSON.parse(fs.readFileSync(path.join(coreRoot, 'package.json'), 'utf8')).version;
  const versionOut = run(cliEntry, ['--version'], { cwd: installProject }).stdout.trim();
  if (versionOut !== expectedVersion) throw new Error(`--version reported "${versionOut}", expected "${expectedVersion}"`);
  console.log(`✓ code-intel --version reports ${versionOut}`);

  // 4. doctor — exits non-zero on warn/fail checks by design (e.g. this host
  // has other code-intel installs on PATH), so don't treat that as failure;
  // just confirm it produced valid, well-formed diagnostics.
  const doctorResult = spawnSync(cliEntry, ['doctor', '--json'], { cwd: installProject, encoding: 'utf8' });
  const doctor = JSON.parse(doctorResult.stdout);
  if (typeof doctor.ok !== 'boolean' || !Array.isArray(doctor.checks)) {
    throw new Error(`doctor --json produced an unexpected shape: ${doctorResult.stdout}`);
  }
  console.log(`✓ code-intel doctor ran (ok=${doctor.ok}, ${doctor.checks.length} checks)`);

  // Steps 5-8 register `fixtureRepo` in the GLOBAL ~/.code-intel registry
  // (shared with any real repos on this machine) — always deregister it via
  // the CLI's own `clean --purge`, even on failure, so this script never
  // leaves stray global state behind.
  try {
    // 5. analyze a small fixture, from the isolated install, cwd unrelated to this repo.
    fs.writeFileSync(path.join(fixtureRepo, 'src', 'hello.ts'), 'export function isolatedInstallHello(name: string) { return `hi ${name}`; }\n');
    run('git', ['init', '-q'], { cwd: fixtureRepo });
    run('git', ['config', 'user.email', 'test@example.com'], { cwd: fixtureRepo });
    run('git', ['config', 'user.name', 'Test'], { cwd: fixtureRepo });
    run('git', ['add', '.'], { cwd: fixtureRepo });
    run('git', ['commit', '-qm', 'initial'], { cwd: fixtureRepo });
    run(cliEntry, ['analyze', fixtureRepo, '--skip-embeddings', '--skip-agents-md', '--skip-git'], { cwd: fixtureRepo, timeout: 120_000 });
    if (!fs.existsSync(path.join(fixtureRepo, '.code-intel', 'current.json'))) {
      throw new Error('expected .code-intel/current.json after analyze');
    }
    console.log('✓ analyze produced a published index');

    // 6. Trusted/fresh generation, reopened by a second packaged CLI process.
    const status1 = JSON.parse(run(cliEntry, ['index-status', fixtureRepo], { cwd: fixtureRepo }).stdout);
    if (!(status1.state === 'trusted' && status1.trusted === true && status1.fresh === true)) {
      throw new Error(`expected trusted/fresh index-status, got ${JSON.stringify(status1)}`);
    }
    const status2 = JSON.parse(run(cliEntry, ['index-status', fixtureRepo], { cwd: fixtureRepo }).stdout);
    if (status2.generationId !== status1.generationId) {
      throw new Error(`second process saw a different generationId (${status2.generationId} != ${status1.generationId})`);
    }
    console.log(`✓ a second packaged CLI process reopens the same trusted generation (${status1.generationId})`);

    // 7. search works against the isolated install (proves it doesn't depend on workspace paths).
    const searchOut = run(cliEntry, ['search', 'isolatedInstallHello'], { cwd: fixtureRepo, timeout: 30_000 }).stdout;
    if (!searchOut.includes('isolatedInstallHello')) throw new Error(`search did not find the fixture symbol: ${searchOut}`);
    console.log('✓ search finds the fixture symbol from the isolated install');

    // 8. MCP stdio server starts from the isolated install and responds to a
    // real JSON-RPC initialize handshake, proving it doesn't depend on
    // repository workspace paths (task 4.6).
    await verifyMcpStartup(cliEntry, fixtureRepo);
  } finally {
    spawnSync(cliEntry, ['clean', fixtureRepo, '--purge'], { cwd: fixtureRepo, encoding: 'utf8' });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('\n✓ npm tarball installs and runs correctly outside the workspace (tasks 4.4/4.5/4.6).');
}

function verifyMcpStartup(cliEntry, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliEntry, ['mcp', cwd], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP server did not respond within 15s. stderr=${stderr}`));
    }, 15_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split('\n').filter((l) => l.trim().startsWith('{'));
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            clearTimeout(timeout);
            child.kill();
            console.log(`✓ MCP stdio server responds to initialize (protocolVersion=${msg.result.protocolVersion ?? 'unknown'})`);
            resolve();
            return;
          }
        } catch {
          // partial line, keep buffering
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => { clearTimeout(timeout); reject(err); });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`MCP server exited early with code ${code}. stderr=${stderr}`));
      }
    });

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-npm-install', version: '0.0.0' } },
    })}\n`);
  });
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
