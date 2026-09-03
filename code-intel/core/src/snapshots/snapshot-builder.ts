import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { createKnowledgeGraph } from '../graph/knowledge-graph.js';
import { DbManager } from '../storage/db-manager.js';
import { loadGraphFromDB } from '../multi-repo/graph-from-db.js';
import { Bm25Index } from '../search/bm25-index.js';
import { VectorIndex } from '../search/vector-index.js';
import { SqliteResolutionEvidenceStore } from '../evidence/store.js';
import type { IndexMetadata } from '../storage/metadata.js';
import {
  GitMaterializationError,
  materializeGitRefToWorktree,
  removeGitWorktree,
  resolveGitRef,
  resolveRepositoryIdentity,
} from './git-materializer.js';
import { buildSnapshotDescriptor } from './fingerprint.js';
import { createWorktreeDir } from './paths.js';
import { computeContentFingerprints, writeContentFingerprints } from './content-fingerprints.js';
import type { SnapshotBoundary, SnapshotBuildRequest, SnapshotBuildResult } from './types.js';

/**
 * Locates the code-intel package's own bundled `analyze` CLI entry point,
 * walking up from this module's own (compiled) location rather than trusting
 * `process.argv` — this module may run inside a long-lived MCP/HTTP server
 * process whose entry point is not the CLI at all. Works whether this file was
 * built by tsup into a single-file `dist/index.js` bundle or mirrored 1:1 by
 * `tsc` for tests, since it re-anchors from `package.json` rather than assuming
 * a fixed number of `..` segments.
 *
 * A name match alone isn't sufficient: some test setups copy `package.json`
 * into a build-artifact directory (e.g. `dist-tests/`) that sits *between*
 * this module and the real package root, purely so other tooling can resolve
 * paths relative to it. That copy would satisfy a name check while having no
 * `dist/cli/main.js` next to it, so each candidate is required to actually
 * have the CLI entry point before it's accepted — otherwise the search keeps
 * walking up past it to the real root.
 */
function findAnalyzeCliEntry(): string {
  const tried: string[] = [];
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const packageJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string };
        if (pkg.name === '@vohongtho.infotech/code-intel') {
          const entry = path.join(dir, 'dist', 'cli', 'main.js');
          tried.push(entry);
          if (fs.existsSync(entry)) return entry;
        }
      } catch {
        // Malformed package.json above us; keep searching upward.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`code-intel CLI entry point not found (tried: ${tried.join(', ') || '(no package.json matched)'}); run \`npm run build\` before building semantic snapshots`);
}

/**
 * Runs `analyze` against `worktreeDir` (the source root) with artifacts
 * redirected to `stagingDir` via CODE_INTEL_INDEX_STAGING_DIR — the same
 * env-var redirection mechanism `runAtomicAnalyze` uses for real generations
 * (see storage/metadata.ts `writableArtifactPath`). Spawning a child process,
 * rather than calling the analyze pipeline in-process, is required here for
 * the same reason it's required there: that redirection is a process-global
 * env var, and mutating `process.env` on a long-lived server process would
 * race across concurrent snapshot builds. CODE_INTEL_SNAPSHOT_BUILD tells the
 * child's analyze action to skip repo-registry registration, since
 * `worktreeDir` is a throwaway checkout that no longer exists moments later.
 */
function runAnalyzeChild(worktreeDir: string, stagingDir: string): { status: number; stderr: string } {
  const cliEntry = findAnalyzeCliEntry();
  const result = spawnSync(process.execPath, [
    cliEntry,
    'analyze',
    worktreeDir,
    '--skip-embeddings',
    '--skip-agents-md',
    '--no-group-sync',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CODE_INTEL_ATOMIC_CHILD: '1',
      CODE_INTEL_SNAPSHOT_BUILD: '1',
      CODE_INTEL_INDEX_STAGING_DIR: stagingDir,
    },
  });
  return { status: result.status ?? 1, stderr: result.stderr ?? '' };
}

/**
 * Reopens and validates a just-built snapshot's artifacts before it is trusted
 * as cache-worthy input to a diff. Mirrors the read-back checks
 * `verifyStagingReadBack` (cli/atomic-analyze.ts) performs for a real
 * generation, but works from explicit artifact paths rather than an
 * `IndexGeneration` + ambient `CODE_INTEL_INDEX_STAGING_DIR`, so it is safe to
 * call from a shared server process without touching `process.env`.
 */
export async function verifySnapshotReadBack(stagingDir: string, metadata: IndexMetadata): Promise<{ ok: true } | { ok: false; reason: string }> {
  const graphDbPath = path.join(stagingDir, 'graph.db');
  const bm25DbPath = path.join(stagingDir, 'bm25.db');
  const vectorDbPath = path.join(stagingDir, 'vector.db');
  const evidenceDbPath = path.join(stagingDir, 'evidence.db');

  const graph = createKnowledgeGraph();
  const db = new DbManager(graphDbPath, true);
  await db.init();
  try {
    await loadGraphFromDB(graph, db);
  } finally {
    db.close();
  }
  const graphPersisted = graph.size.nodes + graph.size.edges;
  if (graphPersisted === 0) return { ok: false, reason: 'graph read-back is empty' };
  const graphProduced = metadata.graphVerification?.producedCount ?? graphPersisted;
  if (graphPersisted < graphProduced) {
    return { ok: false, reason: `graph read-back (${graphPersisted}) smaller than produced (${graphProduced})` };
  }

  const bm25 = new Bm25Index(bm25DbPath);
  const bm25Receipt = bm25.getReadBackReceipt();
  // Not compared against metadata.bm25Verification.producedCount: that count
  // is derived from total graph node count, but nodes without text content
  // (e.g. `cluster`/`flow` synthetic nodes) are never BM25-indexed, so a
  // graph containing any of those legitimately has fewer BM25 documents than
  // graph nodes — comparing the two produces false "collapsed" positives
  // (confirmed independently: plain `code-intel analyze` hits the same
  // mismatch on a fixture small enough to produce exactly one cluster). What
  // actually indicates real data loss is an index that read back empty while
  // the graph clearly has indexable content.
  if (bm25Receipt.docCount === 0 && graphPersisted > 0) {
    return { ok: false, reason: 'bm25 read-back is empty but the graph has content' };
  }

  if (metadata.embeddings?.enabled && metadata.embeddings.status === 'ready' && fs.existsSync(vectorDbPath)) {
    const idx = new VectorIndex(vectorDbPath, metadata.embeddings.dimension, { readonly: true, fileMustExist: true });
    try {
      await idx.init();
      const built = await idx.isBuilt();
      if (!built) return { ok: false, reason: 'vector read-back failed' };
    } finally {
      idx.close();
    }
  }

  if (fs.existsSync(evidenceDbPath)) {
    const expected = metadata.evidenceVerification?.producedCount ?? 0;
    const receiptId = metadata.evidenceVerification?.contentFingerprint;
    if (expected > 0 && receiptId) {
      const evidenceStore = new SqliteResolutionEvidenceStore(evidenceDbPath);
      try {
        if (!evidenceStore.getReceipt(receiptId)) return { ok: false, reason: 'evidence read-back failed' };
      } finally {
        evidenceStore.close();
      }
    }
  }

  return { ok: true };
}

/**
 * Computes and persists per-node declaration content fingerprints (see
 * content-fingerprints.ts) while `worktreeDir`'s source is still on disk.
 * Returns an error message on failure, or null on success — never throws, so
 * a fingerprinting problem degrades the diff's accuracy rather than failing
 * the whole snapshot build.
 */
async function tryWriteContentFingerprints(worktreeDir: string, stagingDir: string): Promise<string | null> {
  try {
    const graph = createKnowledgeGraph();
    const db = new DbManager(path.join(stagingDir, 'graph.db'), true);
    await db.init();
    try {
      await loadGraphFromDB(graph, db);
    } finally {
      db.close();
    }
    writeContentFingerprints(stagingDir, computeContentFingerprints(worktreeDir, graph));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Builds an isolated semantic snapshot for one Git ref into `stagingDir`.
 *
 * Safety invariants, enforced by construction rather than by convention:
 *  - Never calls `publishIndexGeneration`, `createIndexGeneration`, or any
 *    other Generation V2 publication code path — this function doesn't import
 *    them at all, so there is no code path here that could advance a
 *    repository's `current.json` pointer.
 *  - The materialized ref lives in a throwaway `git worktree`, entirely
 *    outside both the caller's working tree and `repoDir`'s `.code-intel/`;
 *    it is always removed (success or failure) before this function returns.
 *  - Analysis artifacts are written only to the caller-supplied `stagingDir`,
 *    never inside the worktree and never inside `repoDir`'s own
 *    `.code-intel/generations/`.
 */
export async function buildIsolatedSnapshot(
  request: SnapshotBuildRequest,
  stagingDir: string,
): Promise<SnapshotBuildResult> {
  const startedAt = Date.now();
  const boundaries: SnapshotBoundary[] = [];

  if (request.includeDirtyWorkingTree) {
    return {
      status: 'unsupported',
      descriptor: null,
      artifactsDir: null,
      fromCache: false,
      boundaries: [{
        kind: 'dirty-working-tree-unsupported',
        message: 'Semantic snapshots of an uncommitted working tree are not yet supported; compare committed refs instead.',
      }],
      durationMs: Date.now() - startedAt,
    };
  }

  let resolved: { ref: string; commit: string; tree: string };
  try {
    resolved = resolveGitRef(request.repoDir, request.ref);
  } catch (error) {
    const message = error instanceof GitMaterializationError ? error.message : String(error);
    return {
      status: 'failed',
      descriptor: null,
      artifactsDir: null,
      fromCache: false,
      boundaries: [{ kind: 'unknown-ref', message }],
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }

  const repositoryIdentity = resolveRepositoryIdentity(request.repoDir);
  const descriptor = buildSnapshotDescriptor({
    repositoryIdentity,
    gitTree: resolved.tree,
    commit: resolved.commit,
    contractFingerprint: request.contractFingerprint,
  });

  const worktreeDir = createWorktreeDir();
  try {
    try {
      materializeGitRefToWorktree(request.repoDir, resolved.commit, worktreeDir);
    } catch (error) {
      const message = error instanceof GitMaterializationError ? error.message : String(error);
      return {
        status: 'failed',
        descriptor,
        artifactsDir: null,
        fromCache: false,
        boundaries: [{ kind: 'materialization-failed', message }],
        durationMs: Date.now() - startedAt,
        error: message,
      };
    }

    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    const child = runAnalyzeChild(worktreeDir, stagingDir);
    if (child.status !== 0) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      const stderrSuffix = child.stderr ? `: ${child.stderr.trim().slice(-2000)}` : '';
      const message = `analyze exited with status ${child.status}${stderrSuffix}`;
      return {
        status: 'failed',
        descriptor,
        artifactsDir: null,
        fromCache: false,
        boundaries: [{ kind: 'analysis-failed', message }],
        durationMs: Date.now() - startedAt,
        error: message,
      };
    }

    const metadataPath = path.join(stagingDir, 'meta.json');
    let metadata: IndexMetadata;
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as IndexMetadata;
    } catch (error) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      const message = `staging metadata missing or unreadable after analyze: ${error instanceof Error ? error.message : String(error)}`;
      return {
        status: 'failed',
        descriptor,
        artifactsDir: null,
        fromCache: false,
        boundaries: [{ kind: 'readback-failed', message }],
        durationMs: Date.now() - startedAt,
        error: message,
      };
    }

    const verification = await verifySnapshotReadBack(stagingDir, metadata);
    if (!verification.ok) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return {
        status: 'failed',
        descriptor,
        artifactsDir: null,
        fromCache: false,
        boundaries: [{ kind: 'readback-failed', message: verification.reason }],
        durationMs: Date.now() - startedAt,
        error: verification.reason,
      };
    }

    const fingerprintingError = await tryWriteContentFingerprints(worktreeDir, stagingDir);
    if (fingerprintingError) {
      // Content fingerprints are an accuracy improvement for body-edit and
      // rename/move detection, not a correctness requirement for the diff to
      // run at all (graph-diff.ts/continuity.ts degrade gracefully to no
      // fingerprint for a node when the sidecar is missing or incomplete) —
      // so a failure here is a boundary, not a build failure.
      boundaries.push({ kind: 'readback-failed', message: `content fingerprinting failed (non-fatal): ${fingerprintingError}` });
    }

    return {
      status: 'built',
      descriptor,
      artifactsDir: stagingDir,
      fromCache: false,
      boundaries,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    removeGitWorktree(request.repoDir, worktreeDir);
  }
}
