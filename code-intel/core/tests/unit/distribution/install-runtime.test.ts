import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../../..');

interface BuildRuntimeBundleResult {
  target: string;
  versionRoot: string;
  installRoot: string;
  runtimeManifestPath: string;
  archivePath: string | null;
  checksumPath: string;
  sbomPath: string;
  provenancePath: string;
  nodeRuntimeDir: string;
  copiedFiles: number;
  nativeFiles: number;
}

interface InstallRuntimeResult {
  installRoot: string;
  version: string;
  archivePath: string;
  archiveSha: string;
  manifestPath: string;
  liveVersionRoot: string;
  launcherPath: string;
  versionOutput: string;
  pathConflicts: Array<{ path: string; resolved: string }>;
}

async function loadBuildRuntimeBundle(): Promise<(options: Record<string, unknown>) => Promise<BuildRuntimeBundleResult>> {
  const mod = await import(`${pathToFileURL(path.join(repoRoot, 'scripts/distribution/build-runtime-bundle.mjs')).href}?t=${Date.now()}`) as {
    buildRuntimeBundle: (options: Record<string, unknown>) => Promise<BuildRuntimeBundleResult>;
  };
  return mod.buildRuntimeBundle;
}

async function loadInstallRuntime(): Promise<(options: Record<string, unknown>) => InstallRuntimeResult> {
  const mod = await import(`${pathToFileURL(path.join(repoRoot, 'scripts/distribution/install/install-runtime.mjs')).href}?t=${Date.now()}`) as {
    installRuntime: (options: Record<string, unknown>) => InstallRuntimeResult;
  };
  return mod.installRuntime;
}

function makeFakeNodeRuntime(root: string): string {
  const runtimeDir = path.join(root, 'node-vtest-linux-x64');
  fs.mkdirSync(path.join(runtimeDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'bin', 'node'), '#!/bin/sh\nexec node "$@"\n', { mode: 0o755 });
  return runtimeDir;
}

describe('install-runtime', () => {
  it('installs verified archive into stable install root without breaking activation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-runtime-'));
    try {
      const buildRuntimeBundle = await loadBuildRuntimeBundle();
      const installRuntime = await loadInstallRuntime();
      const nodeRuntimeDir = makeFakeNodeRuntime(tmpDir);
      const bundle = await buildRuntimeBundle({
        target: 'linux-x64',
        outDir: tmpDir,
        nodeRuntimeDir,
        archiveMtime: '2024-01-01T00:00:00.000Z',
      });
      const installRoot = path.join(tmpDir, 'install-root-target');
      const result = installRuntime({
        archive: bundle.archivePath,
        checksumFile: bundle.checksumPath,
        installRoot,
        skipPathCheck: true,
      });
      assert.match(result.versionOutput, new RegExp(`^${result.version}(?: .+)?$`));
      assert.ok(fs.existsSync(path.join(installRoot, 'current')));
      assert.ok(fs.existsSync(path.join(installRoot, 'bin', process.platform === 'win32' ? 'code-intel.cmd' : 'code-intel')));
      assert.equal(result.pathConflicts.length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails checksum verification before activation and preserves existing current version', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-runtime-'));
    try {
      const buildRuntimeBundle = await loadBuildRuntimeBundle();
      const installRuntime = await loadInstallRuntime();
      const nodeRuntimeDir = makeFakeNodeRuntime(tmpDir);
      const bundle = await buildRuntimeBundle({
        target: 'linux-x64',
        outDir: tmpDir,
        nodeRuntimeDir,
        archiveMtime: '2024-01-01T00:00:00.000Z',
      });
      const installRoot = path.join(tmpDir, 'install-root-target');
      const first = installRuntime({
        archive: bundle.archivePath,
        checksumFile: bundle.checksumPath,
        installRoot,
      });
      assert.match(first.versionOutput, new RegExp(`^${first.version}(?: .+)?$`));
      assert.throws(() => installRuntime({
        archive: bundle.archivePath,
        checksum: '0'.repeat(64),
        installRoot,
      }), /Checksum mismatch/);
      const currentTarget = fs.readlinkSync(path.join(installRoot, 'current'));
      assert.match(currentTarget, new RegExp(first.version.replace('.', '\\.')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports PATH conflicts without deleting unrelated executables', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-runtime-'));
    try {
      const buildRuntimeBundle = await loadBuildRuntimeBundle();
      const installRuntime = await loadInstallRuntime();
      const nodeRuntimeDir = makeFakeNodeRuntime(tmpDir);
      const bundle = await buildRuntimeBundle({
        target: 'linux-x64',
        outDir: tmpDir,
        nodeRuntimeDir,
        archiveMtime: '2024-01-01T00:00:00.000Z',
      });
      const conflictDir = path.join(tmpDir, 'conflict-bin');
      fs.mkdirSync(conflictDir, { recursive: true });
      const conflictExe = path.join(conflictDir, process.platform === 'win32' ? 'code-intel.cmd' : 'code-intel');
      fs.writeFileSync(conflictExe, '#!/bin/sh\necho conflict\n', { mode: 0o755 });
      const result = installRuntime({
        archive: bundle.archivePath,
        checksumFile: bundle.checksumPath,
        installRoot: path.join(tmpDir, 'install-root-target'),
      });
      const detected = result.pathConflicts.some((entry) => entry.path === conflictExe);
      assert.equal(detected, false);
      const withPath = execFileSync(process.execPath, [path.join(repoRoot, 'scripts/distribution/install/install-runtime.mjs'), '--archive', bundle.archivePath!, '--checksum-file', bundle.checksumPath, '--install-root', path.join(tmpDir, 'install-root-path')], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${conflictDir}${path.delimiter}${process.env.PATH || ''}` },
      });
      const parsed = JSON.parse(withPath) as { pathConflicts: Array<{ path: string }> };
      assert.ok(parsed.pathConflicts.some((entry) => entry.path === conflictExe));
      assert.ok(fs.existsSync(conflictExe));
      assert.ok(result.launcherPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
