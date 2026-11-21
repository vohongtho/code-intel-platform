/**
 * repo-runtime.ts
 *
 * The narrow set of repository facts a change-workflow session needs —
 * index trust/freshness, the published graph, and read-only Git state —
 * behind one injectable interface so planning/verification stay testable.
 *
 * Git access here is strictly read-only (`rev-parse`, `merge-base
 * --is-ancestor`, `status --porcelain`); no command that stages, commits,
 * checks out, resets or pushes exists in the workflow service.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import { loadGraphSnapshotFromDbPath } from '../../multi-repo/graph-from-db.js';
import type { SourceChangeState } from '../../pipeline/analysis-plan.js';
import { getChangedFilesSince } from '../../pipeline/incremental.js';
import { detectLanguage } from '../../shared/detection.js';
import type { IndexMetadata } from '../../storage/metadata.js';
import { resolveIndexSnapshot } from '../../storage/index-snapshot.js';
import { verifyIndexTrust, type IndexTrustResult } from '../../storage/index-trust.js';

export interface WorkflowRepoRuntime {
  verifyTrust(repoDir: string): IndexTrustResult;
  sourceChanges(repoDir: string, trust: IndexTrustResult): SourceChangeState;
  loadGraph(repoDir: string): Promise<{ graph: KnowledgeGraph; generationId?: string }>;
  gitHead(repoDir: string): string | undefined;
  gitBranch(repoDir: string): string | undefined;
  gitIsAncestor(repoDir: string, ancestor: string, descendant: string): boolean | undefined;
  gitDirty(repoDir: string): boolean;
}

function git(repoDir: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Is the published index current for the working tree?
 *
 * Unlike `detectSourceChangeState` (analyze planning, which conservatively
 * treats every file differing from the indexed commit as changed), a file
 * that differs from the indexed commit but whose mtime still equals the
 * mtime recorded when it was indexed *is* reflected in the index — that is
 * exactly the "edit, analyze, verify" state of an uncommitted change. Stale
 * means: an indexed file was modified/deleted after indexing, or a new
 * source file exists that the index never saw.
 */
export function detectIndexStaleness(repoDir: string, metadata: IndexMetadata | null): SourceChangeState {
  if (!metadata) return { kind: 'unknown', changedPaths: [], reason: 'index metadata unavailable' };
  const stored = Object.fromEntries(Object.entries(metadata.lastAnalyzedMtimes ?? {}).map(([file, mtime]) => [normalizeRelative(file), mtime]));
  const changed = new Set<string>();
  for (const [file, mtime] of Object.entries(stored)) {
    try {
      if (fs.statSync(path.join(repoDir, file)).mtimeMs !== mtime) changed.add(file);
    } catch {
      changed.add(file);
    }
  }
  const gitChanged = metadata.commitHash ? getChangedFilesSince(repoDir, metadata.commitHash) : null;
  if (gitChanged) {
    for (const file of gitChanged.map(normalizeRelative)) {
      // Code Intel's own data dir (index, workflow sessions) is never source.
      if (Object.prototype.hasOwnProperty.call(stored, file) || file.startsWith('.code-intel/')) continue;
      if (detectLanguage(file) !== null && fs.existsSync(path.join(repoDir, file))) changed.add(file);
    }
  }
  const changedPaths = [...changed].sort();
  if (changedPaths.length > 0) return { kind: 'changed', changedPaths, reason: `${changedPaths.length} source path(s) changed since indexing` };
  return gitChanged
    ? { kind: 'unchanged', changedPaths, reason: 'indexed files match their recorded mtimes and no unindexed source files exist' }
    : { kind: 'unknown', changedPaths, reason: 'no Git commit to detect unindexed new files' };
}

export const defaultRepoRuntime: WorkflowRepoRuntime = {
  verifyTrust: (repoDir) => verifyIndexTrust(repoDir),
  sourceChanges: (repoDir, trust) => detectIndexStaleness(repoDir, trust.metadata),
  async loadGraph(repoDir) {
    const snapshot = resolveIndexSnapshot(repoDir);
    if (!snapshot) throw new Error(`No published index found for ${repoDir}`);
    return { graph: await loadGraphSnapshotFromDbPath(snapshot.graphDbPath), generationId: snapshot.generationId };
  },
  gitHead: (repoDir) => git(repoDir, ['rev-parse', 'HEAD']) || undefined,
  gitBranch(repoDir) {
    const branch = git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return branch && branch !== 'HEAD' ? branch : undefined;
  },
  gitIsAncestor(repoDir, ancestor, descendant) {
    try {
      execFileSync('git', ['-C', repoDir, 'merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' });
      return true;
    } catch (err) {
      // Exit status 1 means "not an ancestor"; anything else (unknown object, no repo) is unknown.
      return (err as { status?: number }).status === 1 ? false : undefined;
    }
  },
  gitDirty(repoDir) {
    const status = git(repoDir, ['status', '--porcelain', '--untracked-files=no']);
    return Boolean(status);
  },
};

export interface IndexReadiness {
  ready: boolean;
  /** Ready but freshness could not be proven (e.g. no Git commit to compare against). */
  freshnessUnknown: boolean;
  reasons: string[];
  trust: IndexTrustResult;
  changes: SourceChangeState;
}

/** True only for a trusted index whose source has not changed since it was published. */
export function assessIndexReadiness(repoDir: string, runtime: WorkflowRepoRuntime): IndexReadiness {
  const trust = runtime.verifyTrust(repoDir);
  const changes = runtime.sourceChanges(repoDir, trust);
  const reasons = [...trust.reasons];
  if (changes.kind === 'changed') reasons.push(`SOURCE_CHANGED: ${changes.changedPaths.slice(0, 10).join(', ')}${changes.changedPaths.length > 10 ? ', …' : ''}`);
  const ready = trust.trusted && trust.fresh && changes.kind !== 'changed';
  return { ready, freshnessUnknown: ready && changes.kind === 'unknown', reasons, trust, changes };
}
