/**
 * Unit tests for the ensureGitignore helper (called after every analyze).
 *
 * Because ensureGitignore is a module-private function inside main.ts we test
 * its behaviour by writing a small inline re-implementation here that mirrors
 * the exact logic, driven against a real tmp directory.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── inline mirror of the production logic ──────────────────────────────────
function ensureGitignore(workspaceRoot: string): { wrote: boolean } {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  const entry = '.code-intel/';

  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf-8');
  }

  const lines = existing.split('\n').map((l) => l.trim());
  if (lines.includes('.code-intel/') || lines.includes('.code-intel')) {
    return { wrote: false };
  }

  const suffix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(gitignorePath, `${suffix}${entry}\n`, 'utf-8');
  return { wrote: true };
}
// ────────────────────────────────────────────────────────────────────────────

describe('ensureGitignore', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gitignore-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    // Clean up .gitignore between tests
    const p = path.join(tmpDir, '.gitignore');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('creates .gitignore with .code-intel/ when file does not exist', () => {
    const { wrote } = ensureGitignore(tmpDir);
    assert.equal(wrote, true);
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    assert.ok(content.includes('.code-intel/'));
  });

  it('appends .code-intel/ to existing .gitignore that lacks it', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, 'node_modules/\ndist/\n', 'utf-8');

    const { wrote } = ensureGitignore(tmpDir);
    assert.equal(wrote, true);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    assert.ok(content.includes('node_modules/'));
    assert.ok(content.includes('dist/'));
    assert.ok(content.includes('.code-intel/'));
  });

  it('skips when .code-intel/ (with slash) already present', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, 'node_modules/\n.code-intel/\n', 'utf-8');

    const before = fs.readFileSync(gitignorePath, 'utf-8');
    const { wrote } = ensureGitignore(tmpDir);
    const after = fs.readFileSync(gitignorePath, 'utf-8');

    assert.equal(wrote, false);
    assert.equal(after, before);
  });

  it('skips when .code-intel (without slash) already present', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, '.code-intel\n', 'utf-8');

    const { wrote } = ensureGitignore(tmpDir);
    assert.equal(wrote, false);
  });

  it('adds a separating newline before entry when existing file has no trailing newline', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, 'dist/', 'utf-8'); // no trailing newline

    ensureGitignore(tmpDir);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    assert.ok(content.includes('\n.code-intel/'));
    assert.ok(!content.includes('dist/.code-intel/'));
  });

  it('is idempotent — calling twice produces only one .code-intel/ entry', () => {
    ensureGitignore(tmpDir);
    ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    const occurrences = (content.match(/\.code-intel/g) ?? []).length;
    assert.equal(occurrences, 1);
  });
});
