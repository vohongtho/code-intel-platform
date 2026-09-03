import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * All Git invocations in this module pass arguments as an argv array to
 * `execFileSync` — never as an interpolated shell string. A ref like
 * `main; rm -rf /` or `$(id)` is therefore always a single, inert argv token:
 * there is no shell to expand it. Refs are additionally rejected up front if
 * they start with `-`, so a ref cannot be misread as an option flag by git
 * itself (argument injection, independent of shell injection).
 */
export class GitMaterializationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'GitMaterializationError';
  }
}

export interface ResolvedGitRef {
  ref: string;
  commit: string;
  tree: string;
}

function execGit(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string } | undefined)?.stderr;
    let detail: string;
    if (typeof stderr === 'string') detail = stderr;
    else if (stderr) detail = stderr.toString('utf8');
    else detail = error instanceof Error ? error.message : String(error);
    throw new GitMaterializationError(`git ${args.join(' ')} failed: ${detail.trim()}`, error);
  }
}

/** Rejects refs that could be misread as command-line options rather than revisions. */
export function assertSafeRef(ref: string): void {
  if (!ref || ref.startsWith('-')) {
    throw new GitMaterializationError(`Refusing to resolve unsafe ref: ${JSON.stringify(ref)}`);
  }
}

export function isInsideGitRepo(dir: string): boolean {
  try {
    return execGit(['rev-parse', '--is-inside-work-tree'], dir) === 'true';
  } catch {
    return false;
  }
}

export function getRepositoryToplevel(repoDir: string): string {
  return execGit(['rev-parse', '--show-toplevel'], repoDir);
}

/**
 * A stable identity for the repository being diffed, independent of where it
 * happens to be checked out on this machine — the remote URL when one is
 * configured, otherwise the canonical (symlink-resolved) working tree path.
 */
export function resolveRepositoryIdentity(repoDir: string): string {
  try {
    const remote = execGit(['remote', 'get-url', 'origin'], repoDir);
    if (remote) return remote;
  } catch {
    // No 'origin' remote configured; fall back to the repository's canonical path.
  }
  try {
    return fs.realpathSync(getRepositoryToplevel(repoDir));
  } catch {
    return fs.realpathSync(path.resolve(repoDir));
  }
}

/**
 * Resolves an arbitrary ref (branch, tag, or SHA) to its immutable commit and
 * tree object IDs. Throws GitMaterializationError for unknown/unresolvable refs
 * rather than silently falling back to HEAD or the ambient repository state.
 */
export function resolveGitRef(repoDir: string, ref: string): ResolvedGitRef {
  assertSafeRef(ref);
  let commit: string;
  try {
    commit = execGit(['rev-parse', '--verify', `${ref}^{commit}`], repoDir);
  } catch (error) {
    throw new GitMaterializationError(`Unknown or unresolvable ref: ${ref}`, error);
  }
  const tree = execGit(['rev-parse', `${commit}^{tree}`], repoDir);
  return { ref, commit, tree };
}

/**
 * Materializes a resolved commit's tree into `targetDir` as a real, isolated
 * filesystem checkout via `git worktree add --detach`, without touching the
 * caller's working tree, index, or HEAD. `targetDir` must not already exist.
 */
export function materializeGitRefToWorktree(repoDir: string, commit: string, targetDir: string): void {
  if (fs.existsSync(targetDir)) {
    throw new GitMaterializationError(`Refusing to materialize into an existing directory: ${targetDir}`);
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  execGit(['worktree', 'add', '--detach', '--quiet', targetDir, commit], repoDir);
}

/**
 * File-level rename/move hints between two commits, from Git's own similarity
 * detection (`git diff -M`). Used only as corroborating evidence for symbol
 * continuity (continuity.ts) — never as sole proof, since Git's heuristic can
 * both miss real renames and flag coincidentally-similar unrelated files.
 */
export function detectRenamedFiles(repoDir: string, baseCommit: string, headCommit: string): Map<string, string> {
  assertSafeRef(baseCommit);
  assertSafeRef(headCommit);
  const renamed = new Map<string, string>();
  let output: string;
  try {
    output = execGit(['diff', '--name-status', '-M', '--diff-filter=R', baseCommit, headCommit, '--'], repoDir);
  } catch {
    return renamed;
  }
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3 || !parts[0]?.startsWith('R')) continue;
    const [, oldPath, newPath] = parts;
    if (oldPath && newPath) renamed.set(oldPath, newPath);
  }
  return renamed;
}

/**
 * Removes a worktree created by materializeGitRefToWorktree. Safe to call on a
 * partially-created or already-removed directory: git worktree bookkeeping is
 * best-effort, but the filesystem removal always runs. Never removes anything
 * outside `targetDir` itself, so an interrupted build cannot delete a
 * directory the caller (or the user) created.
 */
export function removeGitWorktree(repoDir: string, targetDir: string): void {
  try {
    execGit(['worktree', 'remove', '--force', targetDir], repoDir);
  } catch {
    // The worktree admin entry may already be gone (e.g. targetDir was removed
    // out from under it, or repoDir itself no longer exists); fall through to
    // the unconditional filesystem cleanup below.
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  try {
    execGit(['worktree', 'prune', '--quiet'], repoDir);
  } catch {
    // Best-effort; a stale admin entry self-heals on the next prune.
  }
}
