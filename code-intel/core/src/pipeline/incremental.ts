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

function normalizeRelativePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function getCurrentCommitHash(workspaceRoot: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/** Returns committed, staged, unstaged and untracked changes relative to baseHash. */
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
      .map(normalizeRelativePath)
      .filter(Boolean))]
      .sort();
  } catch {
    return null;
  }
}

export function filterChangedByMtime(
  allFilePaths: string[],
  workspaceRoot: string,
  storedMtimes: Record<string, number>,
): string[] {
  const normalizedStored = new Map(
    Object.entries(storedMtimes).map(([key, value]) => [normalizeRelativePath(key), value]),
  );
  const changed: string[] = [];
  for (const absPath of allFilePaths) {
    const rel = normalizeRelativePath(path.relative(workspaceRoot, absPath));
    const stored = normalizedStored.get(rel);
    if (stored === undefined) {
      changed.push(absPath);
      continue;
    }
    try {
      const { mtimeMs } = fs.statSync(absPath);
      if (mtimeMs !== stored) changed.push(absPath);
    } catch {
      changed.push(absPath);
    }
  }
  return changed;
}

export function buildMtimeSnapshot(
  filePaths: string[],
  workspaceRoot: string,
): Record<string, number> {
  const snap: Record<string, number> = {};
  for (const absPath of filePaths) {
    try {
      const { mtimeMs } = fs.statSync(absPath);
      snap[normalizeRelativePath(path.relative(workspaceRoot, absPath))] = mtimeMs;
    } catch {
      // Unreadable file — skip
    }
  }
  return snap;
}

export interface IncrementalDecision {
  incremental: boolean;
  changedExistingFiles?: string[];
  deletedFiles?: string[];
  totalFiles?: number;
  changedFiles?: string[];
  fallbackReason?: string;
}

export function decideIncremental(
  workspaceRoot: string,
  allFilePaths: string[],
  prevCommitHash: string | undefined,
  storedMtimes: Record<string, number> | undefined,
): IncrementalDecision {
  const total = allFilePaths.length;
  const currentRelPaths = allFilePaths.map((p) => normalizeRelativePath(path.relative(workspaceRoot, p)));
  const currentRelSet = new Set(currentRelPaths);
  const deletedFiles = Object.keys(storedMtimes ?? {})
    .map(normalizeRelativePath)
    .filter((rel) => !currentRelSet.has(rel));

  const finalizeIncremental = (
    changedExistingFiles: string[],
    source: 'git' | 'mtime' | 'git+mtime',
  ): IncrementalDecision => {
    const deduplicated = [...new Set(changedExistingFiles.map((file) => path.resolve(file)))].sort();
    const changedWork = deduplicated.length + deletedFiles.length;

    // v1.0.8 correctness gate: removing changed/deleted nodes cascades incoming
    // cross-file relationships. Until dependency-closure re-resolution is available,
    // any non-empty change set must use a clean full rebuild. This preserves calls,
    // imports, heritage edges, clusters and flows. The zero-change fast path remains.
    if (changedWork > 0) {
      return {
        incremental: false,
        fallbackReason: `${source}: correctness-first full rebuild required for ${deduplicated.length} changed and ${deletedFiles.length} deleted file(s)`,
        totalFiles: total,
      };
    }

    Logger.info(`[incremental] ${source}: no source changes detected out of ${total}`);
    return {
      incremental: true,
      changedExistingFiles: [],
      deletedFiles: [],
      changedFiles: [],
      totalFiles: total,
    };
  };

  if (prevCommitHash) {
    const changed = getChangedFilesSince(workspaceRoot, prevCommitHash);
    if (changed !== null) {
      const changedRelPaths = new Set(changed.map(normalizeRelativePath));
      if (storedMtimes && Object.keys(storedMtimes).length > 0) {
        for (const absPath of filterChangedByMtime(allFilePaths, workspaceRoot, storedMtimes)) {
          changedRelPaths.add(normalizeRelativePath(path.relative(workspaceRoot, absPath)));
        }
      }
      const changedExistingFiles = [...changedRelPaths]
        .filter((rel) => currentRelSet.has(rel))
        .map((rel) => path.join(workspaceRoot, rel));
      return finalizeIncremental(changedExistingFiles, storedMtimes ? 'git+mtime' : 'git');
    }
    Logger.warn('[incremental] git diff failed, trying mtime fallback');
  }

  if (storedMtimes && Object.keys(storedMtimes).length > 0) {
    return finalizeIncremental(
      filterChangedByMtime(allFilePaths, workspaceRoot, storedMtimes),
      'mtime',
    );
  }

  return {
    incremental: false,
    fallbackReason: 'no previous commit hash and no stored mtimes',
    totalFiles: total,
  };
}
