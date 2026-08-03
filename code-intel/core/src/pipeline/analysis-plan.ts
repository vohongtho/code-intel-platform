import fs from 'node:fs';
import path from 'node:path';
import { getChangedFilesSince } from './incremental.js';
import type { IndexMetadata } from '../storage/metadata.js';
import type { IndexArtifactName } from '../storage/index-generation.js';
import type { IndexSnapshot } from '../storage/index-snapshot.js';

export type SourceChangeKind = 'unchanged' | 'changed' | 'unknown';

export interface SourceChangeState {
  kind: SourceChangeKind;
  changedPaths: string[];
  reason: string;
}

export type AtomicAnalysisPlan =
  | { mode: 'passthrough'; reason: 'dry-run' }
  | { mode: 'noop'; reason: string; source: SourceChangeState }
  | {
      mode: 'publish';
      reason: string;
      source: SourceChangeState;
      graph: 'full' | 'preserve';
      bm25: 'full' | 'preserve';
      vector: 'full' | 'incremental' | 'preserve' | 'disabled';
      seedArtifacts: IndexArtifactName[];
    };

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function detectSourceChangeState(
  repoDir: string,
  metadata: IndexMetadata | null,
): SourceChangeState {
  if (!metadata?.commitHash) {
    return { kind: 'unknown', changedPaths: [], reason: 'previous commit hash unavailable' };
  }
  const gitChanged = getChangedFilesSince(repoDir, metadata.commitHash);
  if (gitChanged === null) {
    return { kind: 'unknown', changedPaths: [], reason: 'git change detection failed' };
  }
  const changed = new Set(gitChanged.map(normalize));
  for (const [relativePath, previousMtime] of Object.entries(metadata.lastAnalyzedMtimes ?? {})) {
    const normalized = normalize(relativePath);
    try {
      if (fs.statSync(path.join(repoDir, normalized)).mtimeMs !== previousMtime) changed.add(normalized);
    } catch {
      changed.add(normalized);
    }
  }
  const changedPaths = [...changed].sort();
  return changedPaths.length === 0
    ? { kind: 'unchanged', changedPaths, reason: 'git and stored mtimes report no changes' }
    : { kind: 'changed', changedPaths, reason: `${changedPaths.length} changed or deleted path(s)` };
}

function exists(filePath: string | undefined): boolean {
  if (!filePath) return false;
  try { return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0; } catch { return false; }
}

function hasArg(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function resolveAnalysisPlan(input: {
  args: string[];
  metadata: IndexMetadata | null;
  snapshot: IndexSnapshot | null;
  source: SourceChangeState;
}): AtomicAnalysisPlan {
  const { args, metadata, snapshot, source } = input;
  if (hasArg(args, '--dry-run')) return { mode: 'passthrough', reason: 'dry-run' };

  const force = hasArg(args, '--force');
  const graphExists = exists(snapshot?.graphDbPath);
  const bm25Exists = exists(snapshot?.bm25DbPath);
  const vectorExists = exists(snapshot?.vectorDbPath);
  const metadataExists = exists(snapshot?.metadataPath);
  const vectorEnabled = Boolean(metadata?.embeddings?.enabled);
  const vectorHealthy = Boolean(vectorEnabled && metadata?.embeddings?.status === 'ready' && vectorExists);
  const requiredArtifactsPresent = graphExists && bm25Exists && metadataExists && (!vectorEnabled || vectorExists);
  const nonSourceWork = [
    '--summarize', '--profile', '--skip-folders', '--skip-files',
    '--llm-provider', '--llm-model', '--llm-base-url', '--llm-api-key',
    '--llm-batch-size', '--llm-max-nodes',
  ].some((flag) => hasArg(args, flag));
  const embeddingWork = hasArg(args, '--embeddings') && !vectorHealthy;

  if (!metadata || !snapshot) {
    return {
      mode: 'publish', reason: 'initial analysis', source,
      graph: 'full', bm25: 'full', vector: hasArg(args, '--embeddings') ? 'full' : 'disabled', seedArtifacts: [],
    };
  }
  if (force) {
    return {
      mode: 'publish', reason: 'forced analysis', source,
      graph: 'full', bm25: 'full', vector: vectorEnabled || hasArg(args, '--embeddings') ? 'full' : 'disabled', seedArtifacts: [],
    };
  }
  if (snapshot.legacy || metadata.schemaVersion === undefined || metadata.parser === 'regex') {
    const seedArtifacts: IndexArtifactName[] = [];
    if (graphExists) seedArtifacts.push('graph.db');
    if (bm25Exists) seedArtifacts.push('bm25.db');
    if (vectorExists) seedArtifacts.push('vector.db');
    if (metadataExists) seedArtifacts.push('meta.json');
    return {
      mode: 'publish', reason: 'legacy index migration', source,
      graph: 'preserve', bm25: 'preserve', vector: vectorExists ? 'preserve' : 'disabled', seedArtifacts,
    };
  }
  if (source.kind === 'unchanged' && requiredArtifactsPresent && !nonSourceWork && !embeddingWork) {
    return { mode: 'noop', reason: 'no source or index changes detected', source };
  }

  if (source.kind === 'changed') {
    const seedArtifacts: IndexArtifactName[] = ['meta.json'];
    if (vectorHealthy) seedArtifacts.unshift('vector.db');
    return {
      mode: 'publish', reason: source.reason, source,
      graph: 'full', bm25: 'full',
      vector: vectorEnabled ? (vectorHealthy ? 'incremental' : 'full') : (hasArg(args, '--embeddings') ? 'full' : 'disabled'),
      seedArtifacts,
    };
  }

  const seedArtifacts: IndexArtifactName[] = [];
  if (graphExists) seedArtifacts.push('graph.db');
  if (bm25Exists) seedArtifacts.push('bm25.db');
  if (vectorExists) seedArtifacts.push('vector.db');
  if (metadataExists) seedArtifacts.push('meta.json');
  return {
    mode: 'publish',
    reason: !requiredArtifactsPresent ? 'required index artifact missing' : nonSourceWork || embeddingWork ? 'explicit analysis work requested' : source.reason,
    source,
    graph: graphExists ? 'preserve' : 'full',
    bm25: bm25Exists ? 'preserve' : 'full',
    vector: vectorEnabled || hasArg(args, '--embeddings')
      ? (vectorExists && !embeddingWork ? 'preserve' : 'full')
      : 'disabled',
    seedArtifacts: unique(seedArtifacts),
  };
}

export function planAtomicAnalysis(
  repoDir: string,
  args: string[],
  metadata: IndexMetadata | null,
  snapshot: IndexSnapshot | null,
): AtomicAnalysisPlan {
  return resolveAnalysisPlan({
    args,
    metadata,
    snapshot,
    source: detectSourceChangeState(repoDir, metadata),
  });
}
