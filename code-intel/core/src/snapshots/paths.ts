import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getIndexDir, safeGenerationId } from '../storage/index-generation.js';

/**
 * On-disk layout for the semantic snapshot cache.
 *
 *   <repoDir>/.code-intel/snapshots/<snapshotId>/          finished, validated cache entries
 *   <repoDir>/.code-intel/snapshots/.staging-<buildId>/    in-flight builds (never a valid cache hit)
 *   <repoDir>/.code-intel/snapshots/.locks/<snapshotId>.lock  per-fingerprint build coordination
 *
 * This tree lives under the real repository's `.code-intel/` directory (so it is
 * repository-managed data, cleaned up by the same conventions as the rest of the
 * index) but is a sibling of `generations/`, entirely outside the path that
 * `current.json` and `generations/<id>` occupy. Nothing under `snapshots/` is ever
 * referenced by, or capable of becoming, the published Generation V2 pointer.
 */
export const SNAPSHOTS_DIR = 'snapshots';
export const SNAPSHOT_STAGING_PREFIX = '.staging-';
export const SNAPSHOT_LOCKS_DIR = '.locks';
export const SNAPSHOT_METADATA_FILE = 'snapshot.json';

export function getSnapshotsRoot(repoDir: string): string {
  return path.join(getIndexDir(repoDir), SNAPSHOTS_DIR);
}

/** Reuses the same safety validation as generation IDs: no traversal, no separators. */
export function isSafeSnapshotId(value: string): boolean {
  return safeGenerationId(value);
}

export function getSnapshotEntryDir(repoDir: string, snapshotId: string): string {
  if (!isSafeSnapshotId(snapshotId)) throw new Error(`Invalid snapshot ID: ${snapshotId}`);
  return path.join(getSnapshotsRoot(repoDir), snapshotId);
}

export function getSnapshotStagingDir(repoDir: string, buildId: string): string {
  if (!isSafeSnapshotId(buildId)) throw new Error(`Invalid snapshot build ID: ${buildId}`);
  return path.join(getSnapshotsRoot(repoDir), `${SNAPSHOT_STAGING_PREFIX}${buildId}`);
}

export function getSnapshotLockPath(repoDir: string, snapshotId: string): string {
  if (!isSafeSnapshotId(snapshotId)) throw new Error(`Invalid snapshot ID: ${snapshotId}`);
  return path.join(getSnapshotsRoot(repoDir), SNAPSHOT_LOCKS_DIR, `${snapshotId}.lock`);
}

export function getSnapshotArtifactPath(
  entryDir: string,
  artifact: 'graph.db' | 'bm25.db' | 'vector.db' | 'evidence.db' | 'meta.json' | 'semantic-index.json',
): string {
  return path.join(entryDir, artifact);
}

export function getSnapshotMetadataPath(entryDir: string): string {
  return path.join(entryDir, SNAPSHOT_METADATA_FILE);
}

/**
 * A throwaway directory outside the repository entirely (system temp) used to
 * materialize one Git ref's tree as a real checkout via `git worktree add`. This
 * directory — not the cache — is what the analysis pipeline treats as its source
 * root and its own private `.code-intel/`; it is always removed after the build,
 * successful or not, and is never itself part of the snapshot cache.
 */
export function createWorktreeDir(): string {
  const root = path.join(os.tmpdir(), 'code-intel-snapshot-worktrees');
  fs.mkdirSync(root, { recursive: true });
  const dir = path.join(root, `${Date.now()}-${crypto.randomUUID()}`);
  return dir;
}
