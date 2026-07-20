import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist', 'cli', 'main.js');
const PKG = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8')) as { version: string };

function runVersion(flag: '--version' | '-V') {
  try {
    const stdout = execFileSync(process.execPath, [CLI_MAIN, flag], {
      cwd: CORE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '' };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string | Buffer; stderr?: string | Buffer };
    throw new Error(`version command failed: stdout=${String(err.stdout ?? '')} stderr=${String(err.stderr ?? '')}`);
  }
}

describe('version command', () => {
  it('prints only the package version for --version', () => {
    const { stdout, stderr } = runVersion('--version');
    assert.equal(stdout, `${PKG.version}\n`);
    assert.equal(stderr, '');
  });

  it('prints only the package version for -V', () => {
    const { stdout, stderr } = runVersion('-V');
    assert.equal(stdout, `${PKG.version}\n`);
    assert.equal(stderr, '');
  });

  it('does not emit the Windows path-specified error text', () => {
    const { stdout, stderr } = runVersion('--version');
    assert.equal(`${stdout}${stderr}`.includes('The system cannot find the path specified.'), false);
  });

  it('does not emit first-run setup hints during version-only execution', () => {
    const { stdout, stderr } = runVersion('--version');
    assert.equal(`${stdout}${stderr}`.includes('No config found. Run `code-intel init` to set up your environment.'), false);
  });
});
