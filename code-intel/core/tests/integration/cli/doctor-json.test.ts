import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist', 'cli', 'main.js');

describe('doctor --json', () => {
  it('returns stable machine-readable checks', () => {
    const child = spawnSync(process.execPath, [CLI_MAIN, 'doctor', '--json'], {
      cwd: CORE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(child.status, 1);
    const payload = JSON.parse(child.stdout) as {
      version: number;
      ok: boolean;
      checks: Array<{ id: string; status: string; message: string; details?: Record<string, unknown> }>;
    };
    assert.equal(payload.version, 1);
    assert.ok(Array.isArray(payload.checks));
    assert.deepEqual(payload.checks.map((check) => check.id), [
      'node-version',
      'git',
      'config',
      'runtime-launcher',
      'global-dir',
      'logs-dir',
      'setup-selection',
      'tree-sitter-wasm',
      'repo-index-trust',
      'vector-runtime',
      'path-conflicts',
    ]);
    assert.ok(payload.checks.every((check) => ['pass', 'warn', 'fail'].includes(check.status)));
  });
});
