import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listInstalledRuntimeVersions,
  pinRuntimeVersion,
  rollbackRuntimeVersion,
  cleanupRuntimeVersions,
} from '../../../src/cli/runtime-lifecycle.js';

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

describe('runtime lifecycle', () => {
  it('lists installed versions and pinned/current state', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lifecycle-'));
    try {
      writeVersion(root, '1.0.10');
      writeVersion(root, '1.0.11');
      fs.symlinkSync(path.join('versions', '1.0.11'), path.join(root, 'install', 'current'), 'dir');
      fs.writeFileSync(path.join(root, 'install', 'pinned-version.json'), JSON.stringify({ version: '1.0.10' }));
      const scriptPath = path.join(root, 'install', 'current', 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
      const versions = listInstalledRuntimeVersions(scriptPath);
      assert.equal(versions.length, 2);
      assert.ok(versions.find((entry) => entry.version === '1.0.11')?.current);
      assert.ok(versions.find((entry) => entry.version === '1.0.10')?.pinned);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('pins, rolls back, then preserves kept versions on cleanup', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lifecycle-'));
    try {
      writeVersion(root, '1.0.10');
      writeVersion(root, '1.0.11');
      writeVersion(root, '1.0.12');
      fs.symlinkSync(path.join('versions', '1.0.12'), path.join(root, 'install', 'current'), 'dir');
      const scriptPath = path.join(root, 'install', 'current', 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
      const pinned = pinRuntimeVersion('1.0.10', scriptPath);
      assert.equal(pinned.version, '1.0.10');
      const rolled = rollbackRuntimeVersion('1.0.11', scriptPath);
      assert.equal(rolled.version, '1.0.11');
      const removed = cleanupRuntimeVersions(scriptPath);
      assert.ok(!removed.includes('1.0.10'));
      assert.ok(!removed.includes('1.0.11'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes pin file with atomic private staging names', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lifecycle-'));
    try {
      writeVersion(root, '1.0.10');
      fs.symlinkSync(path.join('versions', '1.0.10'), path.join(root, 'install', 'current'), 'dir');
      const scriptPath = path.join(root, 'install', 'current', 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
      pinRuntimeVersion('1.0.10', scriptPath);
      const entries = fs.readdirSync(path.join(root, 'install'));
      assert.equal(entries.some((name) => name.includes('.tmp-')), false);
      const pin = JSON.parse(fs.readFileSync(path.join(root, 'install', 'pinned-version.json'), 'utf8')) as { version: string };
      assert.equal(pin.version, '1.0.10');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks rollback to incompatible schema version', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lifecycle-'));
    try {
      writeVersion(root, '1.0.10', 1);
      writeVersion(root, '1.0.12', 3);
      fs.symlinkSync(path.join('versions', '1.0.12'), path.join(root, 'install', 'current'), 'dir');
      const scriptPath = path.join(root, 'install', 'current', 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
      assert.throws(() => rollbackRuntimeVersion('1.0.10', scriptPath), /schema/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
