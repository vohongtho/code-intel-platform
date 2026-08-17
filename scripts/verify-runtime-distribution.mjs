#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  const rollbackFail = spawnSync('/bin/sh', [launcher, 'upgrade', '--archive', bundle.archivePath, '--checksum', '0'.repeat(64)], { encoding: 'utf8', env, cwd: repoDir });
  if (rollbackFail.status === 0) throw new Error('expected failed upgrade to preserve existing runtime');
  const preserved = run('/bin/sh', [launcher, '--version'], { env });
  const uninstall = run('/bin/sh', [launcher, 'uninstall'], { env, cwd: repoDir });

  const result = {
    version: version.stdout.trim(),
    doctorOk: JSON.parse(doctor.stdout).ok,
    analyzeOk: /Analysis complete|Indexed|graph/i.test(analyze.stdout + analyze.stderr),
    searchOutput: search.stdout.trim(),
    failedUpgradePreservedVersion: preserved.stdout.trim() === version.stdout.trim(),
    uninstallOutput: uninstall.stdout.trim(),
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
