import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../../..');

describe('runtime distribution verification script', () => {
  it('verifies install analyze doctor failed-upgrade preserve uninstall flow', () => {
    const stdout = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/verify-runtime-distribution.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, UPDATE_CHECK_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 480000,
    });
    const parsed = JSON.parse(stdout) as {
      version: string;
      doctorOk: boolean;
      analyzeOk: boolean;
      searchOutput: string;
      failedUpgradePreservedVersion: boolean;
    };
    assert.ok(parsed.version);
    assert.equal(parsed.doctorOk, true);
    assert.equal(parsed.analyzeOk, true);
    assert.match(parsed.searchOutput, /runtimeValue/);
    assert.equal(parsed.failedUpgradePreservedVersion, true);
  });
});
