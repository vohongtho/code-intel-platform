import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist', 'cli', 'main.js');
const CLI_APP = path.join(CORE_ROOT, 'dist', 'cli', 'app.js');
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

function measureMs(file: string, flag: '--version' | '-V') {
  const t0 = process.hrtime.bigint();
  const child = spawnSync(process.execPath, [file, flag], {
    cwd: CORE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (child.status !== 0) {
    throw new Error(`timed command failed: stdout=${child.stdout} stderr=${child.stderr}`);
  }
  return { ms, stdout: child.stdout, stderr: child.stderr };
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

  it('keeps the bootstrap path meaningfully faster than loading the heavy app directly', () => {
    const bootstrap = measureMs(CLI_MAIN, '--version');
    const app = measureMs(CLI_APP, '--version');
    assert.equal(bootstrap.stdout, `${PKG.version}\n`);
    assert.equal(bootstrap.stderr, '');
    assert.ok(app.stdout.includes(PKG.version), `expected app stdout to include version, got ${JSON.stringify(app.stdout)}`);
    assert.ok(bootstrap.ms * 3 < app.ms, `expected bootstrap ${bootstrap.ms.toFixed(1)}ms to be >3x faster than app ${app.ms.toFixed(1)}ms`);
  });
});
