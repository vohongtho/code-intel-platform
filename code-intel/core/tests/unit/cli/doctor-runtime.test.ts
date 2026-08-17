import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDoctorChecks } from '../../../src/cli/doctor.js';

function write(pathname: string, value: string, mode?: number) {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(pathname, value, mode ? { mode } : undefined);
}

describe('doctor runtime lifecycle checks', () => {
  it('reports installed runtime versions and uninstall inventory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-runtime-'));
    const dataRoot = path.join(root, 'data-root');
    try {
      const scriptPath = path.join(root, 'install', 'current', 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
      const manifestPath = path.join(root, 'install', 'current', 'runtime-manifest.json');
      write(scriptPath, 'console.log("noop")\n');
      write(path.join(root, 'install', 'current', 'runtime', 'bin', 'node'), '#!/bin/sh\n', 0o755);
      write(manifestPath, JSON.stringify({ product: { version: '1.0.11' }, bundledNode: { pinnedVersion: 'v24.12.0' }, bundleBuild: { target: 'linux-x64' } }));
      write(path.join(root, 'install', 'versions', '1.0.11', 'runtime-manifest.json'), JSON.stringify({ product: { version: '1.0.11' }, schemaCompatibility: { currentSchemaVersion: 3 }, bundleBuild: { target: 'linux-x64' } }));
      fs.mkdirSync(path.join(root, 'install', 'versions'), { recursive: true });
      write(path.join(root, 'install', 'install-owner.json'), JSON.stringify({
        version: 1,
        installRoot: path.join(root, 'install'),
        versionsRoot: path.join(root, 'install', 'versions'),
        currentPath: path.join(root, 'install', 'current'),
        pinFile: path.join(root, 'install', 'pinned-version.json'),
        launcherPath: path.join(root, 'install', 'bin', 'code-intel'),
        dataRoot,
        dataMarkerPath: path.join(dataRoot, 'runtime-owner.json'),
        managedPaths: [path.join(root, 'install', 'versions')],
      }));
      write(path.join(dataRoot, 'runtime-owner.json'), JSON.stringify({ version: 1, installRoot: path.join(root, 'install'), dataRoot }));
      write(path.join(dataRoot, 'config.json'), '{}');
      const previousGlobal = process.env.CODE_INTEL_GLOBAL_DIR;
      const previousBundled = process.env.CODE_INTEL_BUNDLED_CURRENT_ROOT;
      process.env.CODE_INTEL_GLOBAL_DIR = dataRoot;
      process.env.CODE_INTEL_BUNDLED_CURRENT_ROOT = path.join(root, 'install', 'current');
      try {
        const checks = await collectDoctorChecks({ scriptPath, repoDir: root });
        const versions = checks.find((check) => check.id === 'runtime-versions');
        const uninstall = checks.find((check) => check.id === 'runtime-uninstall');
        assert.equal(versions?.status, 'pass');
        assert.equal(uninstall?.status, 'pass');
        assert.ok(Array.isArray((versions?.details as any).versions));
        assert.ok((versions?.details as any).versions.some((entry: any) => entry.version === '1.0.11'));
        assert.equal((uninstall?.details as any).dataRoot, dataRoot);
      } finally {
        if (previousGlobal === undefined) delete process.env.CODE_INTEL_GLOBAL_DIR;
        else process.env.CODE_INTEL_GLOBAL_DIR = previousGlobal;
        if (previousBundled === undefined) delete process.env.CODE_INTEL_BUNDLED_CURRENT_ROOT;
        else process.env.CODE_INTEL_BUNDLED_CURRENT_ROOT = previousBundled;
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
