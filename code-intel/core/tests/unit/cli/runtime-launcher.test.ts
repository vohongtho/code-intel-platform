import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadBundledRuntimeMetadata } from '../../../src/cli/runtime-metadata.js';

function write(pathname: string, value: string, mode?: number) {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(pathname, value, mode ? { mode } : undefined);
}

describe('runtime launcher metadata', () => {
  it('detects bundled runtime manifest from launcher layout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-launcher-'));
    try {
      const scriptPath = path.join(root, 'install', 'current', 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
      const manifestPath = path.join(root, 'install', 'current', 'runtime-manifest.json');
      write(scriptPath, 'console.log("noop")\n');
      write(path.join(root, 'install', 'current', 'runtime', 'bin', 'node'), '#!/bin/sh\n', 0o755);
      write(manifestPath, JSON.stringify({ product: { version: '1.0.10' }, bundledNode: { pinnedVersion: 'v24.12.0' }, bundleBuild: { target: 'linux-x64' } }));
      const meta = loadBundledRuntimeMetadata(scriptPath);
      assert.equal(meta.bundled, true);
      assert.equal(meta.manifestPath, manifestPath);
      assert.equal(meta.manifest?.bundleBuild?.target, 'linux-x64');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('stable launcher preserves argv boundaries with spaces and metacharacters', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-launcher-'));
    try {
      const launcher = path.resolve(import.meta.dirname, '../../../../../../scripts/distribution/launcher/code-intel');
      const binDir = path.join(root, 'bin');
      const currentRoot = path.join(root, 'current');
      const fakeNode = path.join(currentRoot, 'runtime', 'bin', 'node');
      const appMain = path.join(currentRoot, 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
      write(fakeNode, '#!/usr/bin/env sh\nprintf "%s\n" "$@"\n', 0o755);
      write(appMain, 'placeholder\n');
      fs.mkdirSync(binDir, { recursive: true });
      fs.copyFileSync(launcher, path.join(binDir, 'code-intel'));
      fs.chmodSync(path.join(binDir, 'code-intel'), 0o755);

      const child = spawnSync(path.join(binDir, 'code-intel'), ['alpha beta', 'x;y', 'z$w'], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(child.status, 0);
      const lines = child.stdout.trim().split('\n');
      assert.ok(lines.includes(appMain));
      assert.ok(lines.includes('alpha beta'));
      assert.ok(lines.includes('x;y'));
      assert.ok(lines.includes('z$w'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
