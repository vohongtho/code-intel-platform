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
  getSnapshotLocalPinPath,
  getSnapshotLockPath,
  getSnapshotMetadataPath,
  getSnapshotReadPinsDir,
  getSnapshotStagingDir,
  getSnapshotsRoot,
  isSafeSnapshotId,
  SNAPSHOT_CAPABILITIES_FILE,
  SNAPSHOT_STAGING_PREFIX,
} from './paths.js';
import { PROTOCOL_SNAPSHOT_FILE } from '../multi-repo/protocol-contracts.js';
import {
  FULL_SNAPSHOT_CAPABILITIES,
  SNAPSHOT_SCHEMA_VERSION,
  type CacheEntryMetadata,
  type SemanticSnapshotDescriptor,
  type SnapshotBoundary,
  type SnapshotBuildRequest,
  type SnapshotBuildResult,
  type SnapshotCapabilities,
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
const PRIVACY_PROFILES = new Set(['full', 'metadata-only']);
const BM25_CONTENT = new Set(['full', 'names-only', 'none']);

function parseCapabilities(raw: unknown): SnapshotCapabilities | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const bools = ['sourceContent', 'bm25', 'vector', 'evidence', 'protocolContracts'] as const;
  if (!bools.every((key) => typeof c[key] === 'boolean')) return null;
  if (!PRIVACY_PROFILES.has(c.privacyProfile as string) || !BM25_CONTENT.has(c.bm25Content as string)) return null;
  return {
    privacyProfile: c.privacyProfile as SnapshotCapabilities['privacyProfile'],
    sourceContent: c.sourceContent as boolean,
    bm25: c.bm25 as boolean,
    bm25Content: c.bm25Content as SnapshotCapabilities['bm25Content'],
    vector: c.vector as boolean,
    evidence: c.evidence as boolean,
    protocolContracts: c.protocolContracts as boolean,
  };
}

/**
 * What an entry can answer. An imported entry's declared capabilities are
 * authoritative (an unreadable/invalid declaration fails closed: `null`, which
 * callers treat as an invalid entry). A locally-built entry derives them from the
 * artifacts actually present.
 */
export function readSnapshotCapabilities(entryDir: string, metadata?: IndexMetadata | null): SnapshotCapabilities | null {
  const declaredPath = path.join(entryDir, SNAPSHOT_CAPABILITIES_FILE);
  if (fs.existsSync(declaredPath)) {
    try {
      return parseCapabilities(JSON.parse(fs.readFileSync(declaredPath, 'utf8')));
    } catch {
      return null;
    }
  }
  const has = (name: string) => fs.existsSync(path.join(entryDir, name));
  return {
    ...FULL_SNAPSHOT_CAPABILITIES,
    bm25: has('bm25.db'),
    bm25Content: has('bm25.db') ? 'full' : 'none',
    vector: has('vector.db') && metadata?.embeddings?.enabled === true && metadata.embeddings.status === 'ready',
    evidence: has('evidence.db'),
    protocolContracts: has(PROTOCOL_SNAPSHOT_FILE),
  };
}

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
  const capabilities = readSnapshotCapabilities(entryDir, metadata);
  if (!capabilities) return null;
  try {
    const verification = await verifySnapshotReadBack(entryDir, metadata, capabilities);
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

// ─── Read pins ────────────────────────────────────────────────────────────────
//
// A read pin is one file per in-flight reader under `.read-pins/<snapshotId>/`.
// Eviction and explicit removal skip any entry with a live pin. Pins left by a
// crashed process on this host are reclaimed by PID liveness; pins from another
// host (shared filesystem) are honoured until they are LOCK_STALE_AFTER_MS old.

interface ReadPinOwner extends LockOwner {
  pinId: string;
}

function isLivePin(pinPath: string): boolean {
  let owner: ReadPinOwner | null = null;
  try { owner = JSON.parse(fs.readFileSync(pinPath, 'utf8')) as ReadPinOwner; } catch { /* malformed */ }
  const ageMs = (() => { try { return Date.now() - fs.statSync(pinPath).mtimeMs; } catch { return Number.POSITIVE_INFINITY; } })();
  if (!owner) return ageMs < LOCK_STALE_AFTER_MS;
  if (owner.hostname === os.hostname()) return isProcessAlive(owner.pid);
  return ageMs < LOCK_STALE_AFTER_MS;
}

/** True when any live reader holds `snapshotId`. Reclaims dead pins as a side effect. */
export function hasLiveReadPin(repoDir: string, snapshotId: string): boolean {
  const dir = getSnapshotReadPinsDir(repoDir, snapshotId);
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return false; }
  let live = false;
  for (const name of names) {
    const pinPath = path.join(dir, name);
    if (isLivePin(pinPath)) live = true;
    else fs.rmSync(pinPath, { force: true });
  }
  if (!live) {
    try { fs.rmdirSync(dir); } catch { /* not empty (a pin raced in) or already gone */ }
  }
  return live;
}

/**
 * Pins `snapshotId` against eviction/removal for the duration of one read.
 * Acquire the pin *before* validating/opening the entry: eviction re-checks pins
 * after moving an entry aside (see `evictEntry`), so a reader that pinned first is
 * never left holding a deleted directory. The returned release is idempotent.
 */
export function acquireSnapshotReadPin(repoDir: string, snapshotId: string): () => void {
  const dir = getSnapshotReadPinsDir(repoDir, snapshotId);
  fs.mkdirSync(dir, { recursive: true });
  const pinId = crypto.randomUUID();
  const pinPath = path.join(dir, `${pinId}.json`);
  const owner: ReadPinOwner = { pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), pinId };
  fs.writeFileSync(pinPath, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fs.rmSync(pinPath, { force: true });
    try { fs.rmdirSync(dir); } catch { /* other readers still hold pins */ }
  };
}

// ─── Local pins (persistent "keep" marker) ───────────────────────────────────

export interface SnapshotLocalPin {
  snapshotId: string;
  pinnedAt: string;
  reason?: string;
}

export function isSnapshotPinned(repoDir: string, snapshotId: string): boolean {
  return fs.existsSync(getSnapshotLocalPinPath(repoDir, snapshotId));
}

export function pinSnapshot(repoDir: string, snapshotId: string, reason?: string): SnapshotLocalPin {
  const target = getSnapshotLocalPinPath(repoDir, snapshotId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const pin: SnapshotLocalPin = { snapshotId, pinnedAt: new Date().toISOString(), ...(reason ? { reason } : {}) };
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(pin, null, 2));
  fs.renameSync(tmp, target);
  return pin;
}

export function unpinSnapshot(repoDir: string, snapshotId: string): boolean {
  const target = getSnapshotLocalPinPath(repoDir, snapshotId);
  const existed = fs.existsSync(target);
  fs.rmSync(target, { force: true });
  return existed;
}

/**
 * Moves an entry aside, re-checks for a reader that pinned in the meantime, and
 * either restores it or deletes it. Returns true when the entry was removed.
 * The rename is atomic, so a reader either sees the full entry or no entry.
 */
/** Test seam: runs between moving an entry aside and re-checking pins, to force the reader race. */
export const cacheTestHooks: { afterMoveAside?: (repoDir: string, snapshotId: string) => void } = {};

function evictEntry(repoDir: string, entryPath: string): boolean {
  const snapshotId = path.basename(entryPath);
  if (hasLiveReadPin(repoDir, snapshotId)) return false;
  const aside = getSnapshotStagingDir(repoDir, `evict-${crypto.randomUUID()}`);
  try {
    fs.renameSync(entryPath, aside);
  } catch {
    return false;
  }
  cacheTestHooks.afterMoveAside?.(repoDir, snapshotId);
  if (hasLiveReadPin(repoDir, snapshotId)) {
    try {
      if (!fs.existsSync(entryPath)) {
        fs.renameSync(aside, entryPath);
        return false;
      }
    } catch { /* fall through: an equivalent entry was republished meanwhile */ }
  }
  fs.rmSync(aside, { recursive: true, force: true });
  return true;
}

// ─── Entry listing / removal / publication ───────────────────────────────────

export interface SnapshotEntrySummary {
  snapshotId: string;
  descriptor: SemanticSnapshotDescriptor | null;
  createdAt?: string;
  lastAccessedAt?: string;
  sizeBytes: number;
  pinned: boolean;
  readers: boolean;
  capabilities: SnapshotCapabilities | null;
  /** False when snapshot.json is unreadable or from another schema version; such entries are evictable. */
  valid: boolean;
}

function listEntryDirs(repoDir: string): string[] {
  const root = getSnapshotsRoot(repoDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    // Every bookkeeping directory (.locks, .read-pins, .pinned, .staging-*) is dot-prefixed;
    // snapshot IDs are hex digests and never are.
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(root, entry.name));
}

/** Cheap listing (no artifact read-back) for `code-intel index refs`; sorted by snapshot ID. */
export function listSnapshotEntries(repoDir: string): SnapshotEntrySummary[] {
  return listEntryDirs(repoDir).map((entryPath) => {
    const snapshotId = path.basename(entryPath);
    let meta: CacheEntryMetadata | null = null;
    try { meta = JSON.parse(fs.readFileSync(getSnapshotMetadataPath(entryPath), 'utf8')) as CacheEntryMetadata; } catch { /* invalid */ }
    const valid = Boolean(meta && meta.schemaVersion === SNAPSHOT_SCHEMA_VERSION && meta.descriptor?.snapshotId === snapshotId);
    let metadata: IndexMetadata | null = null;
    try { metadata = JSON.parse(fs.readFileSync(path.join(entryPath, 'meta.json'), 'utf8')) as IndexMetadata; } catch { /* derived below */ }
    return {
      snapshotId,
      descriptor: valid ? meta!.descriptor : null,
      createdAt: meta?.createdAt,
      lastAccessedAt: meta?.lastAccessedAt,
      sizeBytes: meta?.sizeBytes ?? 0,
      pinned: isSafeSnapshotId(snapshotId) && isSnapshotPinned(repoDir, snapshotId),
      readers: isSafeSnapshotId(snapshotId) && hasLiveReadPin(repoDir, snapshotId),
      capabilities: readSnapshotCapabilities(entryPath, metadata),
      valid,
    };
  }).sort((a, b) => a.snapshotId.localeCompare(b.snapshotId));
}

export type RemoveSnapshotResult = 'removed' | 'not-found' | 'in-use';

/** Explicit removal (`code-intel index remove`). Never removes an entry a live reader holds; clears its local pin. */
export function removeSnapshotEntry(repoDir: string, snapshotId: string): RemoveSnapshotResult {
  const entryDir = getSnapshotEntryDir(repoDir, snapshotId);
  if (!fs.existsSync(entryDir)) {
    unpinSnapshot(repoDir, snapshotId);
    return 'not-found';
  }
  if (!evictEntry(repoDir, entryDir)) return 'in-use';
  unpinSnapshot(repoDir, snapshotId);
  return 'removed';
}

/**
 * Validates (full artifact read-back) and returns an existing entry's descriptor,
 * or null. Callers that will read the entry afterwards must hold a read pin first.
 */
export async function loadSnapshotEntry(repoDir: string, snapshotId: string): Promise<SemanticSnapshotDescriptor | null> {
  return loadValidCacheEntry(getSnapshotEntryDir(repoDir, snapshotId), snapshotId);
}

export type PublishSnapshotResult = 'published' | 'already-present';

/**
 * Atomically promotes a fully-validated staging directory into the cache (used by
 * portable import). An existing valid entry with the same content-derived ID is
 * kept — it is equivalent by construction — and the staging copy is discarded.
 */
export async function publishSnapshotEntry(
  repoDir: string,
  stagingDir: string,
  descriptor: SemanticSnapshotDescriptor,
  policy: SnapshotCachePolicy = DEFAULT_SNAPSHOT_CACHE_POLICY,
): Promise<PublishSnapshotResult> {
  const entryDir = getSnapshotEntryDir(repoDir, descriptor.snapshotId);
  if (fs.existsSync(entryDir)) {
    if (await loadValidCacheEntry(entryDir, descriptor.snapshotId)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      touchCacheEntry(entryDir);
      return 'already-present';
    }
    if (!evictEntry(repoDir, entryDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw new Error(`snapshot ${descriptor.snapshotId} exists, is invalid, and is held by a live reader; retry later`);
    }
  }
  writeCacheEntryMetadata(stagingDir, descriptor);
  fs.renameSync(stagingDir, entryDir);
  enforceCachePolicy(repoDir, policy);
  return 'published';
}

/** Enforces max-age / max-count / max-bytes eviction across finished cache entries (LRU by last access). */
function enforceCachePolicy(repoDir: string, policy: SnapshotCachePolicy): void {
  const root = getSnapshotsRoot(repoDir);
  if (!fs.existsSync(root)) return;
  const now = Date.now();
  const entries = listEntryDirs(repoDir)
    .map((entryPath) => {
      let meta: CacheEntryMetadata | null = null;
      try { meta = JSON.parse(fs.readFileSync(getSnapshotMetadataPath(entryPath), 'utf8')) as CacheEntryMetadata; } catch { /* corrupt; evict below */ }
      const lastAccessedMs = meta ? Date.parse(meta.lastAccessedAt) : 0;
      return { entryPath, meta, lastAccessedMs: Number.isFinite(lastAccessedMs) ? lastAccessedMs : 0 };
    })
    .sort((a, b) => b.lastAccessedMs - a.lastAccessedMs);

  let totalBytes = entries.reduce((sum, e) => sum + (e.meta?.sizeBytes ?? 0), 0);
  const keep: typeof entries = [];
  for (const entry of entries) {
    // A locally pinned entry is never evicted by policy (only by explicit removal);
    // it still counts toward the totals so unpinned entries make room around it.
    if (isSnapshotPinned(repoDir, path.basename(entry.entryPath))) {
      keep.push(entry);
      continue;
    }
    const tooOld = !entry.meta || now - entry.lastAccessedMs >= policy.maxAgeMs;
    const overCount = keep.length >= policy.maxCount;
    const overBytes = totalBytes > policy.maxBytes && keep.length > 0;
    if ((tooOld || overCount || overBytes) && evictEntry(repoDir, entry.entryPath)) {
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
