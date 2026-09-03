import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  resolvePublishedArtifactPath,
  type AnalyzerCompatibilityReceipt,
  type ArtifactVerification,
  type EvolutionAction,
} from './index-generation.js';
import type { IndexSnapshot } from './index-snapshot.js';

const META_DIRNAME = '.code-intel';
const META_FILE = 'meta.json';
const AGENT_TARGETS_FILE = 'agent-targets.json';

export type EmbeddingStatus = 'ready' | 'stale';
export type EmbeddingPreferenceSource = 'explicit' | 'metadata' | 'legacy' | 'disabled';

export interface EmbeddingMetadata {
  enabled: boolean;
  status: EmbeddingStatus;
  provider: string;
  model: string;
  dimension: number;
}

export interface ResolvedEmbeddingMode {
  enabled: boolean;
  remembered: boolean;
  source: EmbeddingPreferenceSource;
}

export interface ResolvedAnalyzeMode {
  attemptIncremental: boolean;
  source: 'explicit' | 'auto' | 'full';
}

export interface IndexMetadata {
  indexedAt: string;
  schemaVersion?: number;
  indexVersion?: string;
  generationId?: string;
  repoId?: string;
  commitHash?: string;
  parser?: 'tree-sitter' | 'regex';
  compatibilityReceipt?: AnalyzerCompatibilityReceipt;
  graphVerification?: ArtifactVerification;
  bm25Verification?: ArtifactVerification;
  vectorVerification?: ArtifactVerification;
  evidenceVerification?: ArtifactVerification;
  evolutionAction?: EvolutionAction;
  factSchemaVersion?: string;
  factSchemaFingerprint?: string;
  identityFingerprint?: string;
  resolverVersion?: string;
  resolverFingerprint?: string;
  evidenceSchemaVersion?: number;
  evidenceSchemaFingerprint?: string;
  apiContractSchemaVersion?: string;
  apiContractFingerprint?: string;
  frameworkFingerprint?: string;
  frameworkDetections?: string[];
  factDiagnostics?: Array<{
    code: string;
    severity: 'info' | 'warning' | 'error';
    language: string;
    affectedCapability: string;
    impact: 'local' | 'cross-file' | 'repository-wide';
    filePath?: string;
    message?: string;
    count?: number;
  }>;
  lastAnalyzedMtimes?: Record<string, number>;
  embeddings?: EmbeddingMetadata;
  stats: {
    nodes: number;
    edges: number;
    files: number;
    duration: number;
  };
}

export type AgentTargetFormat = 'markdown' | 'text' | 'json';

export interface AgentTargetConfig {
  agentId: string;
  label: string;
  path: string;
  format: AgentTargetFormat;
  builtin?: boolean;
}

export interface AgentTargetSelection {
  selectedAgents: string[];
  targets: Record<string, AgentTargetConfig>;
}

type IndexLocation = string | IndexSnapshot;

function isSnapshot(value: IndexLocation): value is IndexSnapshot {
  return typeof value !== 'string';
}

function getMetaDir(repoDir: string): string {
  return path.join(repoDir, META_DIRNAME);
}

function stagingDir(): string | null {
  const value = process.env['CODE_INTEL_INDEX_STAGING_DIR']?.trim();
  return value ? path.resolve(value) : null;
}

function writableArtifactPath(repoDir: string, artifact: 'graph.db' | 'vector.db' | 'meta.json'): string {
  const staging = stagingDir();
  return staging ? path.join(staging, artifact) : resolvePublishedArtifactPath(repoDir, artifact);
}

export function saveMetadata(repoDir: string, metadata: IndexMetadata): void {
  const target = writableArtifactPath(repoDir, META_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(metadata, null, 2));
  fs.renameSync(tmp, target);
}

export function loadMetadataFromSnapshot(snapshot: IndexSnapshot): IndexMetadata | null {
  try {
    return JSON.parse(fs.readFileSync(snapshot.metadataPath, 'utf-8')) as IndexMetadata;
  } catch {
    return null;
  }
}

export function loadMetadata(location: IndexLocation): IndexMetadata | null {
  if (isSnapshot(location)) return loadMetadataFromSnapshot(location);
  const staging = stagingDir();
  const candidates = staging
    ? [path.join(staging, META_FILE), resolvePublishedArtifactPath(location, META_FILE)]
    : [resolvePublishedArtifactPath(location, META_FILE)];
  for (const candidate of candidates) {
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf-8')) as IndexMetadata;
    } catch {
      // Continue to the next compatible location.
    }
  }
  return null;
}

export function getDbPath(location: IndexLocation): string {
  return isSnapshot(location) ? location.graphDbPath : writableArtifactPath(location, 'graph.db');
}

export function getVectorDbPath(location: IndexLocation): string {
  return isSnapshot(location) ? location.vectorDbPath : writableArtifactPath(location, 'vector.db');
}

export function resolveEmbeddingMode(args: {
  explicitEnable?: boolean;
  explicitSkip?: boolean;
  metadata?: IndexMetadata | null;
  hasLegacyVectorDb?: boolean;
}): ResolvedEmbeddingMode {
  if (args.explicitSkip) {
    return { enabled: false, remembered: Boolean(args.metadata?.embeddings?.enabled), source: 'disabled' };
  }
  if (args.explicitEnable) {
    return { enabled: true, remembered: true, source: 'explicit' };
  }
  if (args.metadata?.embeddings?.enabled) {
    return { enabled: true, remembered: true, source: 'metadata' };
  }
  if (!args.metadata?.embeddings && args.hasLegacyVectorDb) {
    return { enabled: true, remembered: true, source: 'legacy' };
  }
  return { enabled: false, remembered: false, source: 'disabled' };
}

export function embeddingFingerprintMatches(
  stored: Pick<EmbeddingMetadata, 'provider' | 'model' | 'dimension'> | null | undefined,
  runtime: Pick<EmbeddingMetadata, 'provider' | 'model' | 'dimension'>,
): boolean {
  return Boolean(
    stored
    && stored.provider === runtime.provider
    && stored.model === runtime.model
    && stored.dimension === runtime.dimension,
  );
}

export function shouldRebuildEmbeddings(args: {
  metadata?: IndexMetadata | null;
  runtime: Pick<EmbeddingMetadata, 'provider' | 'model' | 'dimension'>;
  hasVectorDb: boolean;
}): boolean {
  return !args.hasVectorDb
    || args.metadata?.embeddings?.status === 'stale'
    || !embeddingFingerprintMatches(args.metadata?.embeddings, args.runtime);
}

export function resolveParserForMetadata(
  parserUsed: IndexMetadata['parser'] | undefined,
  previousMetadata?: IndexMetadata | null,
): NonNullable<IndexMetadata['parser']> {
  // A zero-change incremental run and some legacy-generation migration paths do
  // not execute the parse phase. Preserve the parser provenance already attached
  // to the published graph instead of incorrectly downgrading it to regex.
  if (parserUsed) return parserUsed;
  if (previousMetadata?.parser) return previousMetadata.parser;

  // Metadata created before parser provenance existed came from the old regex
  // pipeline. Keep it blocked by `serve` until a real parse phase rebuilds it.
  return 'regex';
}

export function resolveAnalyzeMode(args: {
  explicitIncremental?: boolean;
  force?: boolean;
  metadata?: IndexMetadata | null;
}): ResolvedAnalyzeMode {
  if (args.force) return { attemptIncremental: false, source: 'full' };
  if (args.explicitIncremental) return { attemptIncremental: true, source: 'explicit' };
  if (args.metadata) return { attemptIncremental: true, source: 'auto' };
  return { attemptIncremental: false, source: 'full' };
}

function statToken(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${path.basename(filePath)}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${path.basename(filePath)}:missing`;
  }
}

export function computeIndexVersion(location: IndexLocation, schemaVersion: number, indexedAt: string): string {
  const staging = isSnapshot(location) ? null : stagingDir();
  const files = isSnapshot(location)
    ? [location.graphDbPath, location.bm25DbPath, location.vectorDbPath].map(statToken)
    : staging
      ? ['graph.db', 'bm25.db', 'vector.db'].map((name) => path.join(staging, name)).map(statToken)
      : [
          resolvePublishedArtifactPath(location, 'graph.db'),
          resolvePublishedArtifactPath(location, 'bm25.db'),
          resolvePublishedArtifactPath(location, 'vector.db'),
        ].map(statToken);
  return crypto.createHash('sha256').update(JSON.stringify({ schemaVersion, indexedAt, files })).digest('hex');
}

export function computeIndexVersionForPaths(
  schemaVersion: number,
  indexedAt: string,
  paths: { graphDbPath: string; bm25DbPath: string; vectorDbPath: string },
): string {
  const files = [paths.graphDbPath, paths.bm25DbPath, paths.vectorDbPath].map(statToken);
  return crypto.createHash('sha256').update(JSON.stringify({ schemaVersion, indexedAt, files })).digest('hex');
}

export function getAgentTargetsPath(repoDir: string): string {
  return path.join(getMetaDir(repoDir), AGENT_TARGETS_FILE);
}

export function loadAgentTargets(repoDir: string): AgentTargetSelection | null {
  try {
    const data = fs.readFileSync(getAgentTargetsPath(repoDir), 'utf-8');
    return JSON.parse(data) as AgentTargetSelection;
  } catch {
    return null;
  }
}

export function saveAgentTargets(repoDir: string, selection: AgentTargetSelection): void {
  const metaDir = getMetaDir(repoDir);
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(getAgentTargetsPath(repoDir), JSON.stringify(selection, null, 2) + '\n', 'utf-8');
}
