import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getChangedFilesSince } from './incremental.js';
import { detectLanguage } from '../shared/detection.js';
import type { IndexMetadata } from '../storage/metadata.js';
import type { EvolutionAction, IndexArtifactName } from '../storage/index-generation.js';
import type { IndexSnapshot } from '../storage/index-snapshot.js';
import { shouldRebuildEmbeddings as shouldRebuildEmbeddingsFromMetadata } from '../storage/metadata.js';
import { FACT_SCHEMA_VERSION } from '../semantic/fact-bundle.js';
import { RESOLVER_VERSION } from '../resolution/contracts.js';
import { EVIDENCE_SCHEMA_VERSION } from '../evidence/store.js';
import type { SemanticDelta } from '../incremental/semantic-delta.js';
import { isDependencyAwareIncrementalEnabled, isEligibleForIncrementalPublication } from '../incremental/rollout-gate.js';

export type SourceChangeKind = 'unchanged' | 'changed' | 'unknown';

export interface SourceChangeState {
  kind: SourceChangeKind;
  changedPaths: string[];
  reason: string;
}

export type AtomicAnalysisPlan =
  | { mode: 'passthrough'; reason: 'dry-run' }
  | { mode: 'noop'; reason: string; source: SourceChangeState; evolution: 'reuse' }
  | {
      mode: 'publish';
      reason: string;
      source: SourceChangeState;
      evolution: EvolutionAction;
      graph: 'full' | 'incremental' | 'preserve';
      bm25: 'full' | 'incremental' | 'preserve';
      vector: 'full' | 'incremental' | 'preserve' | 'disabled';
      seedArtifacts: IndexArtifactName[];
      /** Present only when a proven-complete dependency-aware candidate was published incrementally (graph/bm25 === 'incremental'). */
      dependencyAwareCandidate?: SemanticDelta;
    };

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isIndexRelevantPath(
  relativePath: string,
  storedMtimes: Record<string, number>,
): boolean {
  const normalized = normalize(relativePath);
  return Object.prototype.hasOwnProperty.call(storedMtimes, normalized)
    || detectLanguage(normalized) !== null;
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

  const storedMtimes = Object.fromEntries(
    Object.entries(metadata.lastAnalyzedMtimes ?? {})
      .map(([relativePath, mtime]) => [normalize(relativePath), mtime]),
  );
  const changed = new Set(
    gitChanged
      .map(normalize)
      .filter((relativePath) => isIndexRelevantPath(relativePath, storedMtimes)),
  );

  for (const [relativePath, previousMtime] of Object.entries(storedMtimes)) {
    try {
      if (fs.statSync(path.join(repoDir, relativePath)).mtimeMs !== previousMtime) changed.add(relativePath);
    } catch {
      changed.add(relativePath);
    }
  }
  const changedPaths = [...changed].sort();
  return changedPaths.length === 0
    ? { kind: 'unchanged', changedPaths, reason: 'git and stored mtimes report no source changes' }
    : { kind: 'changed', changedPaths, reason: `${changedPaths.length} changed or deleted source path(s)` };
}

function exists(filePath: string | undefined): boolean {
  if (!filePath) return false;
  try {
    const stat = fs.statSync(filePath);
    return (stat.isFile() && stat.size > 0) || stat.isDirectory();
  } catch {
    return false;
  }
}

function hasArg(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hasSemanticFingerprintMismatch(metadata: IndexMetadata): boolean {
  const currentIdentityFingerprint = 'symbol-identity-v2';
  const parser = metadata.parser ?? 'regex';
  const currentFactSchemaFingerprint = sha256({ version: FACT_SCHEMA_VERSION, parser });
  const currentResolverFingerprint = sha256({
    resolverVersion: RESOLVER_VERSION,
    factSchemaVersion: FACT_SCHEMA_VERSION,
    identityFingerprint: currentIdentityFingerprint,
  });
  const currentEvidenceFingerprint = sha256({
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    resolverVersion: RESOLVER_VERSION,
  });
  return Boolean(
    (metadata.factSchemaVersion && metadata.factSchemaVersion !== FACT_SCHEMA_VERSION)
    || (metadata.factSchemaFingerprint && metadata.factSchemaFingerprint !== currentFactSchemaFingerprint)
    || (metadata.identityFingerprint && metadata.identityFingerprint !== currentIdentityFingerprint)
    || (metadata.resolverVersion && metadata.resolverVersion !== RESOLVER_VERSION)
    || (metadata.resolverFingerprint && metadata.resolverFingerprint !== currentResolverFingerprint)
    || (metadata.evidenceSchemaVersion !== undefined && metadata.evidenceSchemaVersion !== EVIDENCE_SCHEMA_VERSION)
    || (metadata.evidenceSchemaFingerprint && metadata.evidenceSchemaFingerprint !== currentEvidenceFingerprint)
  );
}

function determineEvolution(metadata: IndexMetadata | null): EvolutionAction {
  if (!metadata) return 'full-reanalysis';
  if (metadata.graphVerification?.status === 'corrupt' || metadata.graphVerification?.status === 'collapsed') return 'reject-corrupt';
  if (metadata.evidenceVerification?.status === 'corrupt' || metadata.evidenceVerification?.status === 'collapsed') return 'reject-corrupt';
  if (hasSemanticFingerprintMismatch(metadata)) return 'full-reanalysis';
  if (metadata.compatibilityReceipt && metadata.evolutionAction) return metadata.evolutionAction;
  if (metadata.schemaVersion === undefined || metadata.parser === 'regex') return 'metadata-migrate';
  return 'reuse';
}

export function resolveAnalysisPlan(input: {
  args: string[];
  metadata: IndexMetadata | null;
  snapshot: IndexSnapshot | null;
  source: SourceChangeState;
  /**
   * A dependency-aware invalidation-closure result for `source.changedPaths`,
   * pre-computed by the caller from the previous generation's persisted
   * semantic snapshot + reverse dependency index. Only ever changes `graph`/
   * `bm25` to `'incremental'` when it proves a complete closure AND
   * rollout-gate.ts's `isDependencyAwareIncrementalEnabled()` is true —
   * absent or ignored, this function's output is identical to today's.
   */
  dependencyAwareDelta?: SemanticDelta;
}): AtomicAnalysisPlan {
  const { args, metadata, snapshot, source, dependencyAwareDelta } = input;
  if (hasArg(args, '--dry-run')) return { mode: 'passthrough', reason: 'dry-run' };

  const force = hasArg(args, '--force');
  const graphExists = exists(snapshot?.graphDbPath);
  const bm25Exists = exists(snapshot?.bm25DbPath);
  const vectorExists = exists(snapshot?.vectorDbPath);
  const metadataExists = exists(snapshot?.metadataPath);
  const vectorEnabled = Boolean(metadata?.embeddings?.enabled);
  const vectorHealthy = Boolean(
    vectorEnabled
    && metadata?.embeddings?.status === 'ready'
    && vectorExists
    && !shouldRebuildEmbeddingsFromMetadata({ metadata, runtime: metadata.embeddings, hasVectorDb: vectorExists }),
  );
  const requiredArtifactsPresent = graphExists && bm25Exists && metadataExists && (!vectorEnabled || vectorExists);
  const nonSourceWork = [
    '--summarize', '--profile', '--skip-folders', '--skip-files',
    '--llm-provider', '--llm-model', '--llm-base-url', '--llm-api-key',
    '--llm-batch-size', '--llm-max-nodes',
  ].some((flag) => hasArg(args, flag));
  const embeddingWork = hasArg(args, '--embeddings') && !vectorHealthy;

  if (!metadata || !snapshot) {
    return {
      mode: 'publish', reason: 'initial analysis', source, evolution: 'full-reanalysis',
      graph: 'full', bm25: 'full', vector: hasArg(args, '--embeddings') ? 'full' : 'disabled', seedArtifacts: [],
    };
  }
  if (force) {
    return {
      mode: 'publish', reason: 'forced analysis', source, evolution: 'full-reanalysis',
      graph: 'full', bm25: 'full', vector: vectorEnabled || hasArg(args, '--embeddings') ? 'full' : 'disabled', seedArtifacts: [],
    };
  }
  const evolution = determineEvolution(metadata);
  if (evolution === 'reject-corrupt') {
    return {
      mode: 'publish', reason: 'published generation is corrupt or collapsed', source, evolution,
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
      mode: 'publish', reason: 'legacy index migration', source, evolution: 'metadata-migrate',
      graph: 'preserve', bm25: 'preserve', vector: vectorExists ? 'preserve' : 'disabled', seedArtifacts,
    };
  }
  if (source.kind === 'unchanged' && requiredArtifactsPresent && !nonSourceWork && !embeddingWork && evolution === 'reuse') {
    return { mode: 'noop', reason: 'no source or index changes detected', source, evolution: 'reuse' };
  }

  if (source.kind === 'changed') {
    const seedArtifacts: IndexArtifactName[] = ['meta.json'];
    if (vectorHealthy) seedArtifacts.unshift('vector.db');
    const dependencyAwareReady = evolution !== 'artifact-rebuild'
      && isDependencyAwareIncrementalEnabled()
      && Boolean(dependencyAwareDelta)
      && dependencyAwareDelta?.requiresFullResolution === false
      && isEligibleForIncrementalPublication([
        ...(dependencyAwareDelta?.changedFiles ?? []),
        ...(dependencyAwareDelta?.deletedFiles ?? []),
      ]);
    if (dependencyAwareReady) {
      seedArtifacts.push('graph.db', 'bm25.db', 'semantic-index.json');
    }
    return {
      mode: 'publish', reason: source.reason, source, evolution: evolution === 'reuse' ? 'full-reanalysis' : evolution,
      graph: dependencyAwareReady ? 'incremental' : (evolution === 'artifact-rebuild' ? 'preserve' : 'full'),
      bm25: dependencyAwareReady ? 'incremental' : (evolution === 'artifact-rebuild' ? 'preserve' : 'full'),
      vector: vectorEnabled ? (vectorHealthy ? 'incremental' : 'full') : (hasArg(args, '--embeddings') ? 'full' : 'disabled'),
      seedArtifacts: unique(seedArtifacts),
      dependencyAwareCandidate: dependencyAwareReady ? dependencyAwareDelta : undefined,
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
    evolution,
    graph: evolution === 'full-reanalysis' ? 'full' : (graphExists ? 'preserve' : 'full'),
    bm25: evolution === 'full-reanalysis' ? 'full' : (bm25Exists ? 'preserve' : 'full'),
    vector: vectorEnabled || hasArg(args, '--embeddings')
      ? (vectorExists && !embeddingWork && evolution !== 'artifact-rebuild' ? 'preserve' : 'full')
      : 'disabled',
    seedArtifacts: unique(seedArtifacts),
  };
}

export function planAtomicAnalysis(
  repoDir: string,
  args: string[],
  metadata: IndexMetadata | null,
  snapshot: IndexSnapshot | null,
  dependencyAwareDelta?: SemanticDelta,
): AtomicAnalysisPlan {
  return resolveAnalysisPlan({
    args,
    metadata,
    snapshot,
    source: detectSourceChangeState(repoDir, metadata),
    dependencyAwareDelta,
  });
}
