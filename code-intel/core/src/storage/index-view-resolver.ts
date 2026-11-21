import fs from 'node:fs';
import path from 'node:path';
import { resolveIndexSnapshot } from './index-snapshot.js';
import {
  acquireSnapshotReadPin,
  DEFAULT_SNAPSHOT_CACHE_POLICY,
  getOrBuildSnapshot,
  loadSnapshotEntry,
  readSnapshotCapabilities,
  resolveSnapshotDescriptor,
  type SnapshotCachePolicy,
} from '../snapshots/cache.js';
import { getSnapshotEntryDir } from '../snapshots/paths.js';
import type { IndexMetadata } from './metadata.js';
import type { SemanticSnapshotDescriptor, SnapshotBuildResult, SnapshotCapabilities } from '../snapshots/types.js';
import {
  generationIndexView,
  snapshotIndexView,
  type IndexViewBoundary,
  type ReadIndexView,
} from './index-view.js';

export interface ResolveReadIndexViewRequest {
  repoDir: string;
  /** Omitted → the active generation, exactly as before. Provided → that committed ref's semantic snapshot. */
  ref?: string;
  /** Build a missing snapshot (Git materialization + analysis). Default true. */
  allowBuild?: boolean;
  cachePolicy?: SnapshotCachePolicy;
}

export type ResolveReadIndexViewResult =
  | { ok: true; view: ReadIndexView }
  | { ok: false; boundary: IndexViewBoundary };

/**
 * Process-local memo of entries that already passed full artifact read-back, so
 * a cached-ref query pays validation once per process rather than per request.
 * Keyed by entry dir + graph.db size/mtime: a replaced or rebuilt entry has a new
 * graph.db and re-validates.
 */
const validatedEntries = new Map<string, { key: string; descriptor: SemanticSnapshotDescriptor; capabilities: SnapshotCapabilities | null }>();

export function resetIndexViewMemoForTests(): void {
  validatedEntries.clear();
}

function entryStatKey(entryDir: string): string | null {
  try {
    const stat = fs.statSync(path.join(entryDir, 'graph.db'));
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

async function loadValidatedEntry(repoDir: string, snapshotId: string): Promise<SemanticSnapshotDescriptor | null> {
  const entryDir = getSnapshotEntryDir(repoDir, snapshotId);
  const key = entryStatKey(entryDir);
  if (!key) return null;
  const memo = validatedEntries.get(entryDir);
  if (memo && memo.key === key) return memo.descriptor;
  const descriptor = await loadSnapshotEntry(repoDir, snapshotId);
  if (descriptor) validatedEntries.set(entryDir, { key, descriptor, capabilities: readSnapshotCapabilities(entryDir, readEntryMetadata(entryDir)) });
  else validatedEntries.delete(entryDir);
  return descriptor;
}

/** Capabilities of a validated entry; memoized with the entry so meta.json is not re-parsed per request. */
function entryCapabilities(entryDir: string): SnapshotCapabilities | null {
  const memo = validatedEntries.get(entryDir);
  if (memo && memo.key === entryStatKey(entryDir)) return memo.capabilities;
  return readSnapshotCapabilities(entryDir, readEntryMetadata(entryDir));
}

function readEntryMetadata(entryDir: string): IndexMetadata | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(entryDir, 'meta.json'), 'utf8')) as IndexMetadata;
  } catch {
    return null;
  }
}

function buildFailureBoundary(result: SnapshotBuildResult, ref: string): IndexViewBoundary {
  const first = result.boundaries[0];
  if (first?.kind === 'unknown-ref') return { kind: 'unknown-ref', message: first.message };
  if (result.status === 'unsupported') {
    return { kind: 'snapshot-unsupported', message: first?.message ?? `Snapshot for ref '${ref}' is unsupported` };
  }
  return { kind: 'snapshot-build-failed', message: result.error ?? first?.message ?? `Snapshot build for ref '${ref}' failed` };
}

/**
 * Resolves the one immutable view a read request should use.
 *
 * - No `ref`: the active generation (unchanged default behavior).
 * - `ref`: the existing semantic-snapshot service/cache. A read pin is acquired
 *   *before* the entry is validated, so eviction cannot delete the directory while
 *   this request uses it; the caller MUST call `view.release()` when done.
 *
 * Never falls back to current state: an unknown ref, a failed build, or (with
 * `allowBuild: false`) a cache miss is returned as a boundary.
 */
export async function resolveReadIndexView(request: ResolveReadIndexViewRequest): Promise<ResolveReadIndexViewResult> {
  const repositoryRoot = path.resolve(request.repoDir);
  if (request.ref === undefined) {
    const snapshot = resolveIndexSnapshot(repositoryRoot);
    if (!snapshot || !fs.existsSync(snapshot.graphDbPath)) {
      return { ok: false, boundary: { kind: 'missing-index', message: `No published index found for ${repositoryRoot}` } };
    }
    return { ok: true, view: generationIndexView(snapshot) };
  }

  const ref = request.ref;
  if (typeof ref !== 'string' || ref.trim() === '') {
    return { ok: false, boundary: { kind: 'unknown-ref', message: 'ref must be a non-empty string' } };
  }
  const resolution = resolveSnapshotDescriptor(repositoryRoot, ref);
  if ('error' in resolution) return { ok: false, boundary: { kind: 'unknown-ref', message: resolution.error.message } };
  const requested = resolution.descriptor;
  const snapshotId = requested.snapshotId;

  const release = acquireSnapshotReadPin(repositoryRoot, snapshotId);
  try {
    let descriptor = await loadValidatedEntry(repositoryRoot, snapshotId);
    let resolvedBy: 'cached' | 'built' = 'cached';
    if (!descriptor) {
      if (request.allowBuild === false) {
        release();
        return { ok: false, boundary: { kind: 'snapshot-not-built', message: `No cached snapshot for ref '${ref}'; build one (allowBuild) or import a portable index` } };
      }
      const built = await getOrBuildSnapshot({ repoDir: repositoryRoot, ref }, request.cachePolicy ?? DEFAULT_SNAPSHOT_CACHE_POLICY);
      if ((built.status !== 'built' && built.status !== 'cached') || !built.descriptor || !built.artifactsDir) {
        release();
        return { ok: false, boundary: buildFailureBoundary(built, ref) };
      }
      descriptor = built.descriptor;
      resolvedBy = built.fromCache ? 'cached' : 'built';
    }

    const artifactsDir = getSnapshotEntryDir(repositoryRoot, snapshotId);
    const capabilities = entryCapabilities(artifactsDir);
    if (!capabilities) {
      release();
      return { ok: false, boundary: { kind: 'snapshot-build-failed', message: `Snapshot ${snapshotId} has an unreadable capability declaration` } };
    }
    return {
      ok: true,
      view: snapshotIndexView({
        repositoryRoot,
        ref,
        artifactsDir,
        // Same tree ⇒ same snapshot; report the commit this ref resolved to right now.
        descriptor: { ...descriptor, commit: requested.commit ?? descriptor.commit },
        capabilities,
        resolution: resolvedBy,
        release,
      }),
    };
  } catch (error) {
    release();
    throw error;
  }
}

/** Runs `fn` against a resolved view and always releases its read pin. */
export async function withReadIndexView<T>(
  request: ResolveReadIndexViewRequest,
  fn: (view: ReadIndexView) => Promise<T>,
): Promise<{ ok: true; value: T; view: ReadIndexView } | { ok: false; boundary: IndexViewBoundary }> {
  const resolved = await resolveReadIndexView(request);
  if (!resolved.ok) return resolved;
  try {
    return { ok: true, value: await fn(resolved.view), view: resolved.view };
  } finally {
    resolved.view.release();
  }
}
