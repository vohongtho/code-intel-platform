import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  detectRenamedFiles,
  GitMaterializationError,
  materializeGitRefToWorktree,
  removeGitWorktree,
  resolveGitRef,
  resolveRepositoryIdentity,
} from '../../../src/snapshots/git-materializer.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function mkRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-materializer-'));
  git(['init', '--quiet'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\n');
  git(['add', '.'], repoDir);
  git(['commit', '--quiet', '-m', 'first'], repoDir);
  return repoDir;
}

// Fixtures for refs containing spaces, `--`, quotes, and shell metacharacters
// (task 3.3). None of these are valid Git revisions, so every one of them
// must fail resolution cleanly — the point of this suite is that failure
// happens via a normal "unknown revision" error, never via shell expansion.
const UNSAFE_REF_FIXTURES = [
  'ref with spaces',
  '--upload-pack=touch /tmp/git-materializer-pwned',
  '-x',
  '$(touch /tmp/git-materializer-pwned)',
  '`touch /tmp/git-materializer-pwned`',
  '; touch /tmp/git-materializer-pwned',
  '| touch /tmp/git-materializer-pwned',
  '"quoted"',
  "it's-quoted",
  'ref&&touch /tmp/git-materializer-pwned',
];

describe('git-materializer: unsafe ref fixtures', () => {
  for (const ref of UNSAFE_REF_FIXTURES) {
    it(`fails resolution without shell side effects for ref: ${JSON.stringify(ref)}`, () => {
      const repoDir = mkRepo();
      try {
        assert.throws(() => resolveGitRef(repoDir, ref), GitMaterializationError);
        assert.equal(fs.existsSync('/tmp/git-materializer-pwned'), false);
      } finally {
        fs.rmSync(repoDir, { recursive: true, force: true });
        fs.rmSync('/tmp/git-materializer-pwned', { force: true });
      }
    });
  }

  it('rejects a leading-dash ref before ever invoking git, via assertSafeRef', () => {
    const repoDir = mkRepo();
    try {
      assert.throws(() => resolveGitRef(repoDir, '--version'), GitMaterializationError);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe('git-materializer: valid refs and worktree isolation', () => {
  it('resolves a branch name containing a slash to a stable commit/tree pair', () => {
    const repoDir = mkRepo();
    try {
      git(['checkout', '--quiet', '-b', 'feature/my-branch'], repoDir);
      fs.writeFileSync(path.join(repoDir, 'a.txt'), 'two\n');
      git(['commit', '--quiet', '-am', 'second'], repoDir);

      const resolved = resolveGitRef(repoDir, 'feature/my-branch');
      assert.equal(resolved.commit, git(['rev-parse', 'HEAD'], repoDir));
      assert.equal(resolved.tree, git(['rev-parse', 'HEAD^{tree}'], repoDir));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('materializes a ref into an isolated worktree and leaves the source repo untouched', () => {
    const repoDir = mkRepo();
    const beforeHead = git(['rev-parse', 'HEAD'], repoDir);
    const worktreeDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'git-materializer-wt-')), 'checkout');
    try {
      const resolved = resolveGitRef(repoDir, 'HEAD');
      materializeGitRefToWorktree(repoDir, resolved.commit, worktreeDir);

      assert.equal(fs.readFileSync(path.join(worktreeDir, 'a.txt'), 'utf8'), 'one\n');
      assert.equal(git(['rev-parse', 'HEAD'], repoDir), beforeHead, 'source repo HEAD must be unaffected by materializing into a worktree');
      assert.equal(git(['status', '--porcelain'], repoDir), '', 'source repo working tree must stay clean');
    } finally {
      removeGitWorktree(repoDir, worktreeDir);
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('removeGitWorktree deletes the worktree directory and does not throw if already gone', () => {
    const repoDir = mkRepo();
    const worktreeDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'git-materializer-wt-')), 'checkout');
    try {
      const resolved = resolveGitRef(repoDir, 'HEAD');
      materializeGitRefToWorktree(repoDir, resolved.commit, worktreeDir);
      removeGitWorktree(repoDir, worktreeDir);
      assert.equal(fs.existsSync(worktreeDir), false);
      // Calling it again on an already-removed worktree must not throw.
      assert.doesNotThrow(() => removeGitWorktree(repoDir, worktreeDir));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('resolveRepositoryIdentity falls back to the canonical repo path when there is no origin remote', () => {
    const repoDir = mkRepo();
    try {
      const identity = resolveRepositoryIdentity(repoDir);
      assert.equal(identity, fs.realpathSync(repoDir));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('detectRenamedFiles reports a Git-detected rename between two commits', () => {
    const repoDir = mkRepo();
    try {
      const baseCommit = git(['rev-parse', 'HEAD'], repoDir);
      git(['mv', 'a.txt', 'b.txt'], repoDir);
      git(['commit', '--quiet', '-m', 'rename'], repoDir);
      const headCommit = git(['rev-parse', 'HEAD'], repoDir);

      const renamed = detectRenamedFiles(repoDir, baseCommit, headCommit);
      assert.equal(renamed.get('a.txt'), 'b.txt');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('detectRenamedFiles never throws for unresolvable commits — returns an empty map', () => {
    const repoDir = mkRepo();
    try {
      const renamed = detectRenamedFiles(repoDir, 'not-a-real-commit', 'also-not-real');
      assert.equal(renamed.size, 0);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
