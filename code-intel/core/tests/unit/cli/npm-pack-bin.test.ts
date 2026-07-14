import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function newestPackFile(dir: string): string {
  const tgz = fs.readdirSync(dir)
    .filter((name) => /^vohongtho\.infotech-code-intel-.*\.tgz$/.test(name))
    .sort()
    .at(-1);
  assert.ok(tgz, 'packed tarball should exist');
  return path.join(dir, tgz);
}

describe('npm pack artifact', () => {
  it('uses main CLI entry as published bin target', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../..');
    const coreDir = path.join(repoRoot, 'code-intel', 'core');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-pack-'));

    try {
      execFileSync('npm', ['pack', '--silent'], { cwd: coreDir, stdio: 'pipe' });
      const tgzPath = newestPackFile(coreDir);
      execFileSync('tar', ['-xzf', tgzPath, '-C', tmpDir], { stdio: 'pipe' });
      const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package', 'package.json'), 'utf8')) as {
        bin?: Record<string, string>;
      };
      assert.equal(pkg.bin?.['code-intel'], 'dist/cli/main.js');
      assert.equal(pkg.bin?.['code-intel-hook'], 'dist/cli/hook.js');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      const tgzPath = newestPackFile(coreDir);
      fs.rmSync(tgzPath, { force: true });
    }
  });
});
