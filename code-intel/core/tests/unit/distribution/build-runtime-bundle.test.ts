import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../../..');

function makeFakeNodeRuntime(root: string): string {
  const runtimeDir = path.join(root, 'node-vtest-linux-x64');
  fs.mkdirSync(path.join(runtimeDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'bin', 'node'), '#!/bin/sh\nexec node "$@"\n', { mode: 0o755 });
  return runtimeDir;
}

function runBundle(args: string[]): {
  target: string;
  versionRoot: string;
  installRoot: string;
  runtimeManifestPath: string;
  archivePath: string | null;
  checksumPath: string;
  nodeRuntimeDir: string;
  copiedFiles: number;
  nativeFiles: number;
} {
  return JSON.parse(execFileSync(process.execPath, [path.join(repoRoot, 'scripts/distribution/build-runtime-bundle.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  }));
}

describe('build-runtime-bundle', () => {
  it('writes versioned bundle output with runtime manifest and archive', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-build-'));
    try {
      const fakeNodeRuntime = makeFakeNodeRuntime(tmpDir);
      const result = runBundle([
        '--target', 'linux-x64',
        '--out-dir', tmpDir,
        '--node-runtime-dir', fakeNodeRuntime,
        '--archive-mtime', '2024-01-01T00:00:00.000Z',
      ]);

      assert.ok(fs.existsSync(result.runtimeManifestPath));
      assert.ok(result.archivePath && fs.existsSync(result.archivePath));
      assert.ok(result.checksumPath && fs.existsSync(result.checksumPath));
      assert.ok(fs.existsSync(path.join(result.versionRoot, 'runtime', 'bin', 'node')));
      assert.ok(fs.existsSync(path.join(result.versionRoot, 'app', 'code-intel/core/dist/cli/main.js')));
      assert.ok(fs.existsSync(path.join(result.versionRoot, 'app', 'node_modules/@ladybugdb/core/package.json')));
      assert.ok(fs.existsSync(path.join(result.installRoot, 'current')));

      const manifest = JSON.parse(fs.readFileSync(result.runtimeManifestPath, 'utf8')) as {
        bundleBuild: { target: string; nativeRelPaths: string[] };
      };
      assert.equal(manifest.bundleBuild.target, 'linux-x64');
      assert.ok(manifest.bundleBuild.nativeRelPaths.some((value) => value.includes('@ladybugdb/core-linux-x64')));
      const checksums = fs.readFileSync(result.checksumPath, 'utf8');
      assert.match(checksums, /runtime-manifest\.json/);
      assert.match(checksums, /code-intel-runtime-v/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('manifest-only mode skips archive generation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-build-'));
    try {
      const fakeNodeRuntime = makeFakeNodeRuntime(tmpDir);
      const result = runBundle([
        '--target', 'linux-x64',
        '--out-dir', tmpDir,
        '--node-runtime-dir', fakeNodeRuntime,
        '--write-manifest-only',
        '--skip-archive',
      ]);
      assert.equal(result.archivePath, null);
      assert.ok(fs.existsSync(result.runtimeManifestPath));
      assert.ok(fs.existsSync(result.checksumPath));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
