import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function writeVersion(root: string, version: string, schemaVersion = 3) {
  const versionRoot = path.join(root, 'install', 'versions', version);
  fs.mkdirSync(path.join(versionRoot, 'app', 'code-intel', 'core', 'dist', 'cli'), { recursive: true });
  fs.mkdirSync(path.join(versionRoot, 'runtime', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(versionRoot, 'runtime-manifest.json'), JSON.stringify({
    product: { version, commitSha: `${version}-sha` },
    schemaCompatibility: { currentSchemaVersion: schemaVersion },
    bundleBuild: { target: 'linux-x64' },
  }));
  fs.writeFileSync(path.join(versionRoot, 'runtime', 'bin', 'node'), '#!/usr/bin/env sh\nexec node "$@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(versionRoot, 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js'), `console.log('${version}')\n`);
  return versionRoot;
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  const cli = path.resolve(import.meta.dirname, '../../../../dist/cli/main.js');
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
}

describe('runtime command bootstrap', () => {
  it('handles version list, pin, rollback, uninstall before bundled launcher', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-command-'));
    const dataRoot = path.join(root, 'data-root');
    try {
      writeVersion(root, '1.0.10');
      writeVersion(root, '1.0.11');
      fs.mkdirSync(path.join(root, 'install', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(root, 'install', 'bin', 'code-intel'), '#!/usr/bin/env sh\nexit 0\n', { mode: 0o755 });
      fs.writeFileSync(path.join(root, 'install', 'install-owner.json'), JSON.stringify({
        version: 1,
        installRoot: path.join(root, 'install'),
        versionsRoot: path.join(root, 'install', 'versions'),
        currentPath: path.join(root, 'install', 'current'),
        pinFile: path.join(root, 'install', 'pinned-version.json'),
        launcherPath: path.join(root, 'install', 'bin', 'code-intel'),
        dataRoot,
        dataMarkerPath: path.join(dataRoot, 'runtime-owner.json'),
        managedPaths: [
          path.join(root, 'install', 'current'),
          path.join(root, 'install', 'versions'),
          path.join(root, 'install', 'pinned-version.json'),
          path.join(root, 'install', 'bin', 'code-intel'),
          path.join(root, 'install', 'install-owner.json'),
        ],
      }));
      fs.mkdirSync(dataRoot, { recursive: true });
      fs.writeFileSync(path.join(dataRoot, 'runtime-owner.json'), JSON.stringify({ version: 1, installRoot: path.join(root, 'install'), dataRoot }));
      fs.writeFileSync(path.join(dataRoot, 'config.json'), '{}');
      fs.symlinkSync(path.join('versions', '1.0.11'), path.join(root, 'install', 'current'), 'dir');
      const env = {
        ...process.env,
        CODE_INTEL_BUNDLED_CURRENT_ROOT: path.join(root, 'install', 'current'),
        CODE_INTEL_GLOBAL_DIR: dataRoot,
      };

      const listed = runCli(['version', 'list', '--json'], env);
      assert.equal(listed.status, 0);
      assert.equal(JSON.parse(listed.stdout).versions.length, 2);

      const pinned = runCli(['version', 'pin', '1.0.10'], env);
      assert.equal(pinned.status, 0);
      assert.equal(JSON.parse(pinned.stdout).pinned, '1.0.10');

      const rolled = runCli(['rollback', '1.0.10'], env);
      assert.equal(rolled.status, 0);
      assert.equal(JSON.parse(rolled.stdout).current, '1.0.10');

      const uninstallPreview = runCli(['uninstall', '--dry-run'], env);
      assert.equal(uninstallPreview.status, 0);
      const parsedPreview = JSON.parse(uninstallPreview.stdout);
      assert.equal(parsedPreview.preview.dataRoot, dataRoot);

      const uninstalled = runCli(['uninstall'], env);
      assert.equal(uninstalled.status, 0);
      assert.ok(fs.existsSync(dataRoot));
      assert.ok(!fs.existsSync(path.join(root, 'install', 'versions')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires --yes for purge-data and verifies ownership markers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-command-'));
    const dataRoot = path.join(root, 'data-root');
    try {
      writeVersion(root, '1.0.11');
      fs.mkdirSync(path.join(root, 'install', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(root, 'install', 'bin', 'code-intel'), '#!/usr/bin/env sh\nexit 0\n', { mode: 0o755 });
      fs.writeFileSync(path.join(root, 'install', 'install-owner.json'), JSON.stringify({
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
      fs.mkdirSync(dataRoot, { recursive: true });
      fs.writeFileSync(path.join(dataRoot, 'runtime-owner.json'), JSON.stringify({ version: 1, installRoot: path.join(root, 'install'), dataRoot }));
      fs.symlinkSync(path.join('versions', '1.0.11'), path.join(root, 'install', 'current'), 'dir');
      const env = {
        ...process.env,
        CODE_INTEL_BUNDLED_CURRENT_ROOT: path.join(root, 'install', 'current'),
        CODE_INTEL_GLOBAL_DIR: dataRoot,
      };

      const denied = runCli(['uninstall', '--purge-data'], env);
      assert.notEqual(denied.status, 0);
      assert.match(denied.stderr, /--yes/);

      const ok = runCli(['uninstall', '--purge-data', '--yes'], env);
      assert.equal(ok.status, 0);
      assert.ok(!fs.existsSync(dataRoot));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
