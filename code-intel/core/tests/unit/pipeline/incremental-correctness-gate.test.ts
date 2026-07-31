import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  buildMtimeSnapshot,
  decideIncremental,
  getCurrentCommitHash,
} from '../../../src/pipeline/incremental.js';

describe('v1.0.8 incremental correctness gate', () => {
  it('forces a full rebuild for a changed cross-file callee', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-cross-file-'));
    try {
      fs.writeFileSync(path.join(repo, 'service.ts'), [
        'export interface ServiceContract { execute(): number; }',
        'export class BaseService { execute() { return 1; } }',
        'export class Service extends BaseService implements ServiceContract {}',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(repo, 'caller.ts'), [
        "import { Service } from './service.js';",
        'export function run() { return new Service().execute(); }',
        '',
      ].join('\n'));

      execSync('git init -q', { cwd: repo });
      execSync('git config user.email test@example.com', { cwd: repo });
      execSync('git config user.name Test', { cwd: repo });
      execSync('git add . && git commit -qm initial', { cwd: repo });

      const files = [path.join(repo, 'service.ts'), path.join(repo, 'caller.ts')];
      const base = getCurrentCommitHash(repo)!;
      const mtimes = buildMtimeSnapshot(files, repo);

      fs.writeFileSync(path.join(repo, 'service.ts'), [
        'export interface ServiceContract { execute(): number; }',
        'export class BaseService { execute() { return 2; } }',
        'export class Service extends BaseService implements ServiceContract {}',
        '',
      ].join('\n'));

      const decision = decideIncremental(repo, files, base, mtimes);
      assert.equal(decision.incremental, false);
      assert.match(decision.fallbackReason ?? '', /correctness-first full rebuild/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('keeps the zero-change fast path', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-no-change-'));
    try {
      const file = path.join(repo, 'stable.ts');
      fs.writeFileSync(file, 'export const stable = true;\n');
      const mtimes = buildMtimeSnapshot([file], repo);
      const decision = decideIncremental(repo, [file], undefined, mtimes);
      assert.equal(decision.incremental, true);
      assert.deepEqual(decision.changedExistingFiles, []);
      assert.deepEqual(decision.deletedFiles, []);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
