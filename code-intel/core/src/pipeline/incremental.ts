/**
 * incremental.ts
 *
 * Helpers for git-based and mtime-based incremental indexing.
 *
 * Epic 2 — plan v0.3.0
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import Logger from '../shared/logger.js';

// ─── Git helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the current HEAD commit hash, or null if not a git repo / git unavailable.
 */
export function getCurrentCommitHash(workspaceRoot: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: workspaceRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
    const output = execSync(
      `git diff --name-only ${baseHash} HEAD`,
      { cwd: workspaceRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    if (!output) return [];
    return output.split('\n').map((f) => f.trim()).filter(Boolean);
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
  /** Files to re-parse (only set when incremental === true) */
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

  // ── Try git first ──────────────────────────────────────────────────────────
  if (prevCommitHash) {
    const changed = getChangedFilesSince(workspaceRoot, prevCommitHash);
    if (changed !== null) {
      // Map relative paths back to absolute (keep only paths that exist in our scan set)
      const scanSet = new Set(allFilePaths.map((p) => path.relative(workspaceRoot, p)));
      const changedInScan = changed.filter((rel) => scanSet.has(rel)).map((rel) => path.join(workspaceRoot, rel));

      if (total > 0 && changedInScan.length / total > 0.2) {
        return { incremental: false, fallbackReason: `changed files (${changedInScan.length}) > 20% of total (${total})` };
      }
      Logger.info(`[incremental] git: ${changedInScan.length} changed files out of ${total}`);
      return { incremental: true, changedFiles: changedInScan };
    }
    Logger.warn('[incremental] git diff failed, trying mtime fallback');
  }

  // ── mtime fallback ─────────────────────────────────────────────────────────
  if (storedMtimes && Object.keys(storedMtimes).length > 0) {
    const changed = filterChangedByMtime(allFilePaths, workspaceRoot, storedMtimes);
    if (total > 0 && changed.length / total > 0.2) {
      return { incremental: false, fallbackReason: `mtime: changed files (${changed.length}) > 20% of total (${total})` };
    }
    Logger.info(`[incremental] mtime: ${changed.length} changed files out of ${total}`);
    return { incremental: true, changedFiles: changed };
  }

  return { incremental: false, fallbackReason: 'no previous commit hash and no stored mtimes' };
}
