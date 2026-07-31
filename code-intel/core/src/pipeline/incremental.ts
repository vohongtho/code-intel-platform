/**
 * incremental.ts
 *
 * Helpers for git-based and mtime-based incremental indexing.
 *
 * Epic 2 — plan v0.3.0
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Logger from '../shared/logger.js';

// ─── Git helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the current HEAD commit hash, or null if not a git repo / git unavailable.
 */
export function getCurrentCommitHash(workspaceRoot: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Returns relative file paths (from workspaceRoot) that changed between
 * `baseHash` and HEAD. Returns null if git is unavailable or the diff fails.
 */
export function getChangedFilesSince(workspaceRoot: string, baseHash: string): string[] | null {
  try {
    const tracked = execFileSync('git', ['diff', '--name-only', baseHash, '--'], {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return [...new Set(`${tracked}\n${untracked}`
      .split('\n')
      .map((file) => file.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
      .filter(Boolean))]
      .sort();
  } catch {
    return null;
  }
}

// ─── mtime helpers ────────────────────────────────────────────────────────────

/**
 * Given a list of absolute file paths and a stored mtime map, returns those
 * whose current mtime is NEWER than what was stored (or not stored at all).
 *
 * @param allFilePaths  Absolute paths from the scan phase
 * @param workspaceRoot Used to convert absolute → relative paths for the key
 * @param storedMtimes  The `lastAnalyzedMtimes` from the previous meta.json
 */
export function filterChangedByMtime(
  allFilePaths: string[],
  workspaceRoot: string,
  storedMtimes: Record<string, number>,
): string[] {
  const changed: string[] = [];
  for (const absPath of allFilePaths) {
    const rel = path.relative(workspaceRoot, absPath);
    const stored = storedMtimes[rel];
    if (stored === undefined) {
      changed.push(absPath); // new file
      continue;
    }
    try {
      const { mtimeMs } = fs.statSync(absPath);
      if (mtimeMs > stored) changed.push(absPath);
    } catch {
      changed.push(absPath); // stat failed → re-parse to be safe
    }
  }
  return changed;
}

/**
 * Builds a fresh mtime snapshot for a set of absolute file paths.
 * Returns a Record keyed by path relative to workspaceRoot.
 */
export function buildMtimeSnapshot(
  filePaths: string[],
  workspaceRoot: string,
): Record<string, number> {
  const snap: Record<string, number> = {};
  for (const absPath of filePaths) {
    try {
      const { mtimeMs } = fs.statSync(absPath);
      snap[path.relative(workspaceRoot, absPath)] = mtimeMs;
    } catch {
      // Unreadable file — skip
    }
  }
  return snap;
}

// ─── Incremental mode decision ────────────────────────────────────────────────

export interface IncrementalDecision {
  /** Whether to run incrementally (true) or do a full re-analysis (false) */
  incremental: boolean;
  /** Files to re-parse (absolute paths) */
  changedExistingFiles?: string[];
  /** Files removed since the previous successful analyze (relative paths) */
  deletedFiles?: string[];
  /** Total currently scanned files */
  totalFiles?: number;
  /** Back-compat alias for callers not yet migrated */
  changedFiles?: string[];
  /** Reason for falling back to full analysis (when incremental === false) */
  fallbackReason?: string;
}

/**
 * Decide whether we can run incrementally, and which files need re-parsing.
 *
 * Falls back to full analysis when:
 *  - no previous commit hash and no stored mtimes
 *  - git is unavailable AND no stored mtimes
 *  - changed files > 20 % of total
 *
 * @param workspaceRoot   Absolute path to workspace
 * @param allFilePaths    All scanned source file paths (absolute)
 * @param prevCommitHash  commitHash from previous meta.json (may be undefined)
 * @param storedMtimes    lastAnalyzedMtimes from previous meta.json (may be undefined)
 */
export function decideIncremental(
  workspaceRoot: string,
  allFilePaths: string[],
  prevCommitHash: string | undefined,
  storedMtimes: Record<string, number> | undefined,
): IncrementalDecision {
  const total = allFilePaths.length;
  const currentRelPaths = allFilePaths.map((p) => path.relative(workspaceRoot, p));
  const currentRelSet = new Set(currentRelPaths);
  const deletedFiles = Object.keys(storedMtimes ?? {}).filter((rel) => !currentRelSet.has(rel));

  const finalizeIncremental = (changedExistingFiles: string[], source: 'git' | 'mtime' | 'git+mtime'): IncrementalDecision => {
    const changedWork = changedExistingFiles.length + deletedFiles.length;
    if (total > 0 && changedWork / total > 0.2) {
      return {
        incremental: false,
        fallbackReason: `${source}: changed files (${changedExistingFiles.length}) + deleted files (${deletedFiles.length}) > 20% of total (${total})`,
        totalFiles: total,
      };
    }
    Logger.info(`[incremental] ${source}: ${changedExistingFiles.length} changed files, ${deletedFiles.length} deleted files out of ${total}`);
    return {
      incremental: true,
      changedExistingFiles,
      deletedFiles,
      changedFiles: changedExistingFiles,
      totalFiles: total,
    };
  };

  // ── Try git first ──────────────────────────────────────────────────────────
  if (prevCommitHash) {
    const changed = getChangedFilesSince(workspaceRoot, prevCommitHash);
    if (changed !== null) {
      const changedRelPaths = new Set(changed);
      if (storedMtimes && Object.keys(storedMtimes).length > 0) {
        for (const absPath of filterChangedByMtime(allFilePaths, workspaceRoot, storedMtimes)) {
          changedRelPaths.add(path.relative(workspaceRoot, absPath).replace(/\\/g, '/'));
        }
      }
      const changedExistingFiles = [...changedRelPaths]
        .filter((rel) => currentRelSet.has(rel))
        .map((rel) => path.join(workspaceRoot, rel));
      return finalizeIncremental(changedExistingFiles, storedMtimes ? 'git+mtime' : 'git');
    }
    Logger.warn('[incremental] git diff failed, trying mtime fallback');
  }

  // ── mtime fallback ─────────────────────────────────────────────────────────
  if (storedMtimes && Object.keys(storedMtimes).length > 0) {
    const changedExistingFiles = filterChangedByMtime(allFilePaths, workspaceRoot, storedMtimes);
    return finalizeIncremental(changedExistingFiles, 'mtime');
  }

  return { incremental: false, fallbackReason: 'no previous commit hash and no stored mtimes', totalFiles: total };
}
