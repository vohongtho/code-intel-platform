import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
  indexVersion?: string;   // UUID, bumped on every successful analysis
  commitHash?: string;
  /** Parser used during analysis: 'tree-sitter' | 'regex' */
  parser?: 'tree-sitter' | 'regex';
  /** mtime (ms since epoch) for each indexed file path (relative to workspace root) */
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

function getMetaDir(repoDir: string): string {
  return path.join(repoDir, META_DIRNAME);
}

export function saveMetadata(repoDir: string, metadata: IndexMetadata): void {
  const metaDir = getMetaDir(repoDir);
  fs.mkdirSync(metaDir, { recursive: true });
  const target = path.join(metaDir, META_FILE);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(metadata, null, 2));
  fs.renameSync(tmp, target);
}

export function loadMetadata(repoDir: string): IndexMetadata | null {
  try {
    const data = fs.readFileSync(path.join(getMetaDir(repoDir), META_FILE), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function getDbPath(repoDir: string): string {
  return path.join(getMetaDir(repoDir), 'graph.db');
}

export function getVectorDbPath(repoDir: string): string {
  return path.join(getMetaDir(repoDir), 'vector.db');
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
    return `${filePath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${filePath}:missing`;
  }
}

export function computeIndexVersion(repoDir: string, schemaVersion: number, indexedAt: string): string {
  const root = getMetaDir(repoDir);
  const files = ['graph.db', 'bm25.db', 'vector.db'].map((name) => statToken(path.join(root, name)));
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
