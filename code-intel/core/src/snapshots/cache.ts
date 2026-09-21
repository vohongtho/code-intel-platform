import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { isProcessAlive } from '../storage/analyze-lock.js';
import type { IndexMetadata } from '../storage/metadata.js';
import { buildIsolatedSnapshot, verifySnapshotReadBack } from './snapshot-builder.js';
import { buildSnapshotDescriptor } from './fingerprint.js';
import { GitMaterializationError, resolveGitRef, resolveRepositoryIdentity } from './git-materializer.js';
import {
  getSnapshotEntryDir,
  getSnapshotLockPath,
  getSnapshotMetadataPath,
  getSnapshotStagingDir,
  getSnapshotsRoot,
  SNAPSHOT_STAGING_PREFIX,
} from './paths.js';
import {
  SNAPSHOT_SCHEMA_VERSION,
  type CacheEntryMetadata,
  type SemanticSnapshotDescriptor,
  type SnapshotBoundary,
  type SnapshotBuildRequest,
  type SnapshotBuildResult,
} from './types.js';

export interface SnapshotCachePolicy {
  maxAgeMs: number;
  maxCount: number;
  maxBytes: number;
}

export const DEFAULT_SNAPSHOT_CACHE_POLICY: SnapshotCachePolicy = {
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxCount: 20,
  maxBytes: 2 * 1024 * 1024 * 1024,
};

const LOCK_STALE_AFTER_MS = 30 * 60 * 1000;

interface LockOwner {
  pid: number;
  hostname: string;
  startedAt: string;
}

function tryAcquireBuildLock(lockPath: string): boolean {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const owner: LockOwner = { pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString() };
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(owner));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // Reclaim a lock left behind by a dead process (crash, kill -9) or one old
    // enough to be presumed abandoned. A live lock we can't verify (different
    // host) is left alone — fails closed, same as the repo analyze lock.
    let existing: LockOwner | null = null;
    try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LockOwner; } catch { /* malformed */ }
    const ageMs = (() => { try { return Date.now() - fs.statSync(lockPath).mtimeMs; } catch { return Number.POSITIVE_INFINITY; } })();
    const reclaimable = !existing
      ? ageMs >= LOCK_STALE_AFTER_MS
      : existing.hostname === os.hostname() && !isProcessAlive(existing.pid);
    if (!reclaimable) return false;
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      return false;
    }
    return tryAcquireBuildLockOnce(lockPath, owner);
  }
}

function tryAcquireBuildLockOnce(lockPath: string, owner: LockOwner): boolean {
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(owner));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

function releaseBuildLock(lockPath: string): void {
  fs.rmSync(lockPath, { force: true });
}

function toBoundary(kind: SnapshotBoundary['kind'], message: string): SnapshotBoundary {
  return { kind, message };
}

function failedResult(descriptor: SemanticSnapshotDescriptor | null, boundary: SnapshotBoundary, startedAt: number): SnapshotBuildResult {
  return {
    status: 'failed',
    descriptor,
    artifactsDir: null,
    fromCache: false,
    boundaries: [boundary],
    durationMs: Date.now() - startedAt,
    error: boundary.message,
  };
}

/**
 * Reopens and validates an existing cache entry before treating it as a hit.
 * A directory being present and a metadata file parsing is not sufficient —
 * this re-runs the same artifact read-back checks a fresh build goes through,
 * so a partially-deleted, corrupted, or interrupted-eviction entry is detected
 * and discarded rather than silently served as valid data.
 */
async function loadValidCacheEntry(entryDir: string, snapshotId: string): Promise<SemanticSnapshotDescriptor | null> {
  const metaPath = getSnapshotMetadataPath(entryDir);
  let cacheMeta: CacheEntryMetadata;
  try {
    cacheMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as CacheEntryMetadata;
  } catch {
    return null;
  }
  if (cacheMeta.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;
  if (cacheMeta.descriptor?.snapshotId !== snapshotId) return null;

  const metadataArtifactPath = path.join(entryDir, 'meta.json');
  let metadata: IndexMetadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataArtifactPath, 'utf8')) as IndexMetadata;
  } catch {
    return null;
  }
  try {
    const verification = await verifySnapshotReadBack(entryDir, metadata);
    if (!verification.ok) return null;
  } catch {
    // A missing/corrupt artifact (e.g. graph.db deleted out from under a
    // cache entry) can make reopening throw rather than fail cleanly — that
    // is still a validation failure, not a crash: never serve this entry.
    return null;
  }
  return cacheMeta.descriptor;
}

function writeCacheEntryMetadata(entryDir: string, descriptor: SemanticSnapshotDescriptor): void {
  let sizeBytes = 0;
  for (const name of fs.readdirSync(entryDir)) {
    try { sizeBytes += fs.statSync(path.join(entryDir, name)).size; } catch { /* ignore races with concurrent eviction */ }
  }
  const now = new Date().toISOString();
  const meta: CacheEntryMetadata = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    descriptor,
    createdAt: now,
    lastAccessedAt: now,
    sizeBytes,
  };
  const target = getSnapshotMetadataPath(entryDir);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
  fs.renameSync(tmp, target);
}

function touchCacheEntry(entryDir: string): void {
  try {
    const target = getSnapshotMetadataPath(entryDir);
    const meta = JSON.parse(fs.readFileSync(target, 'utf8')) as CacheEntryMetadata;
    meta.lastAccessedAt = new Date().toISOString();
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
    fs.renameSync(tmp, target);
  } catch {
    // Best-effort; failing to bump the access timestamp only affects LRU ordering.
  }
}

/** Removes staging directories abandoned by a crashed or interrupted build. */
function cleanupStaleStaging(repoDir: string, staleAfterMs: number): void {
  const root = getSnapshotsRoot(repoDir);
  if (!fs.existsSync(root)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(SNAPSHOT_STAGING_PREFIX)) continue;
    const entryPath = path.join(root, entry.name);
    let ageMs = Number.POSITIVE_INFINITY;
    try { ageMs = now - fs.statSync(entryPath).mtimeMs; } catch { /* already gone */ }
    if (ageMs >= staleAfterMs) fs.rmSync(entryPath, { recursive: true, force: true });
  }
}

/** Enforces max-age / max-count / max-bytes eviction across finished cache entries (LRU by last access). */
function enforceCachePolicy(repoDir: string, policy: SnapshotCachePolicy): void {
  const root = getSnapshotsRoot(repoDir);
  if (!fs.existsSync(root)) return;
  const now = Date.now();
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(SNAPSHOT_STAGING_PREFIX) && entry.name !== '.locks')
    .map((entry) => {
      const entryPath = path.join(root, entry.name);
      let meta: CacheEntryMetadata | null = null;
      try { meta = JSON.parse(fs.readFileSync(getSnapshotMetadataPath(entryPath), 'utf8')) as CacheEntryMetadata; } catch { /* corrupt; evict below */ }
      const lastAccessedMs = meta ? Date.parse(meta.lastAccessedAt) : 0;
      return { entryPath, meta, lastAccessedMs: Number.isFinite(lastAccessedMs) ? lastAccessedMs : 0 };
    })
    .sort((a, b) => b.lastAccessedMs - a.lastAccessedMs);

  let totalBytes = entries.reduce((sum, e) => sum + (e.meta?.sizeBytes ?? 0), 0);
  const keep: typeof entries = [];
  for (const entry of entries) {
    const tooOld = !entry.meta || now - entry.lastAccessedMs >= policy.maxAgeMs;
    const overCount = keep.length >= policy.maxCount;
    const overBytes = totalBytes > policy.maxBytes && keep.length > 0;
    if (tooOld || overCount || overBytes) {
      fs.rmSync(entry.entryPath, { recursive: true, force: true });
      totalBytes -= entry.meta?.sizeBytes ?? 0;
      continue;
    }
    keep.push(entry);
  }
}

/**
 * Resolves the cache-key descriptor for a ref without building anything —
 * cheap, local Git calls only. Used both to check for a cache hit and to
 * report a proper `unknown-ref` boundary before any expensive analysis runs.
 */
export function resolveSnapshotDescriptor(
  repoDir: string,
  ref: string,
  contractFingerprint?: string,
): { descriptor: SemanticSnapshotDescriptor } | { error: SnapshotBoundary } {
  try {
    const resolved = resolveGitRef(repoDir, ref);
    const repositoryIdentity = resolveRepositoryIdentity(repoDir);
    const descriptor = buildSnapshotDescriptor({
      repositoryIdentity,
      gitTree: resolved.tree,
      commit: resolved.commit,
      contractFingerprint,
    });
    return { descriptor };
  } catch (error) {
    const message = error instanceof GitMaterializationError ? error.message : String(error);
    return { error: toBoundary('unknown-ref', message) };
  }
}

/**
 * Returns a validated semantic snapshot for `request.ref`, reusing a cached
 * entry when one exists and validates, otherwise building fresh and caching
 * the result. Concurrent requests for the *same* fingerprint coordinate via a
 * per-fingerprint lock file; a request that loses the race does not block —
 * it builds into its own isolated staging directory and, at promotion time,
 * prefers whatever the lock owner already published (their content is
 * necessarily equivalent, since equivalence is exactly what the fingerprint
 * guarantees) rather than overwriting it. This trades a possible extra
 * redundant build under rare concurrency for never blocking indefinitely.
 */
export async function getOrBuildSnapshot(
  request: SnapshotBuildRequest,
  policy: SnapshotCachePolicy = DEFAULT_SNAPSHOT_CACHE_POLICY,
): Promise<SnapshotBuildResult> {
  const startedAt = Date.now();

  if (request.includeDirtyWorkingTree) {
    return buildIsolatedSnapshot(request, getSnapshotStagingDir(request.repoDir, crypto.randomUUID()));
  }

  const resolution = resolveSnapshotDescriptor(request.repoDir, request.ref, request.contractFingerprint);
  if ('error' in resolution) return failedResult(null, resolution.error, startedAt);
  const { descriptor } = resolution;
  const snapshotId = descriptor.snapshotId;
  const entryDir = getSnapshotEntryDir(request.repoDir, snapshotId);

  cleanupStaleStaging(request.repoDir, policy.maxAgeMs);

  if (request.allowCache !== false) {
    const hit = await loadValidCacheEntry(entryDir, snapshotId);
    if (hit) {
      touchCacheEntry(entryDir);
      return { status: 'cached', descriptor: hit, artifactsDir: entryDir, fromCache: true, boundaries: [], durationMs: Date.now() - startedAt };
    }
    // A directory exists but failed validation (corruption, partial deletion,
    // an interrupted eviction) — never serve it, and don't leave it behind to
    // fail validation identically on every subsequent request.
    if (fs.existsSync(entryDir)) fs.rmSync(entryDir, { recursive: true, force: true });
  }

  const lockPath = getSnapshotLockPath(request.repoDir, snapshotId);
  const owned = tryAcquireBuildLock(lockPath);
  try {
    if (owned && request.allowCache !== false) {
      // Re-check: another build may have finished between our first check and
      // acquiring the lock.
      const hitAfterLock = await loadValidCacheEntry(entryDir, snapshotId);
      if (hitAfterLock) {
        touchCacheEntry(entryDir);
        return { status: 'cached', descriptor: hitAfterLock, artifactsDir: entryDir, fromCache: true, boundaries: [], durationMs: Date.now() - startedAt };
      }
    }

    const stagingDir = getSnapshotStagingDir(request.repoDir, crypto.randomUUID());
    const result = await buildIsolatedSnapshot(request, stagingDir);
    if (result.status !== 'built' || !result.artifactsDir) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return result;
    }

    if (fs.existsSync(entryDir)) {
      // Someone else already published this exact fingerprint while we were
      // building; their content is equivalent by definition, so prefer it and
      // discard our redundant build rather than racing a directory replace.
      fs.rmSync(result.artifactsDir, { recursive: true, force: true });
      const existing = await loadValidCacheEntry(entryDir, snapshotId);
      if (existing) {
        touchCacheEntry(entryDir);
        return { status: 'cached', descriptor: existing, artifactsDir: entryDir, fromCache: true, boundaries: [], durationMs: Date.now() - startedAt };
      }
    }

    fs.mkdirSync(path.dirname(entryDir), { recursive: true });
    fs.renameSync(result.artifactsDir, entryDir);
    writeCacheEntryMetadata(entryDir, result.descriptor ?? descriptor);
    enforceCachePolicy(request.repoDir, policy);
    return { ...result, artifactsDir: entryDir, fromCache: false };
  } finally {
    if (owned) releaseBuildLock(lockPath);
  }
}
