import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  computeIndexVersion,
  getDbPath,
  getVectorDbPath,
  loadMetadata,
  saveMetadata,
  type IndexMetadata,
} from './metadata.js';
import { getBm25DbPath } from '../search/bm25-index.js';

export type IndexTrustState = 'trusted' | 'stale' | 'corrupt' | 'legacy' | 'missing';

export interface IndexArtifactState {
  path: string;
  required: boolean;
  exists: boolean;
  size: number;
}

export interface IndexTrustResult {
  state: IndexTrustState;
  trusted: boolean;
  fresh: boolean;
  reasons: string[];
  metadata: IndexMetadata | null;
  currentCommit?: string;
  artifacts: {
    graph: IndexArtifactState;
    bm25: IndexArtifactState;
    vector: IndexArtifactState;
  };
}

function artifactState(filePath: string, required: boolean): IndexArtifactState {
  try {
    const stat = fs.statSync(filePath);
    return { path: filePath, required, exists: stat.isFile(), size: stat.size };
  } catch {
    return { path: filePath, required, exists: false, size: 0 };
  }
}

function readCurrentCommit(repoDir: string): string | undefined {
  try {
    return execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function verifyIndexTrust(repoDir: string): IndexTrustResult {
  const metadata = loadMetadata(repoDir);
  const vectorRequired = Boolean(metadata?.embeddings?.enabled && metadata.embeddings.status === 'ready');
  const artifacts = {
    graph: artifactState(getDbPath(repoDir), true),
    bm25: artifactState(getBm25DbPath(repoDir), true),
    vector: artifactState(getVectorDbPath(repoDir), vectorRequired),
  };
  const reasons: string[] = [];
  const anyArtifact = Object.values(artifacts).some((artifact) => artifact.exists);

  if (!metadata && !anyArtifact) {
    return { state: 'missing', trusted: false, fresh: false, reasons: ['INDEX_NOT_FOUND'], metadata: null, artifacts };
  }
  if (!metadata) {
    return { state: 'legacy', trusted: false, fresh: false, reasons: ['METADATA_MISSING'], metadata: null, artifacts };
  }

  for (const [name, artifact] of Object.entries(artifacts)) {
    if (artifact.required && !artifact.exists) reasons.push(`${name.toUpperCase()}_ARTIFACT_MISSING`);
    if (artifact.exists && artifact.size === 0) reasons.push(`${name.toUpperCase()}_ARTIFACT_EMPTY`);
  }

  const legacy = metadata.schemaVersion === undefined || metadata.indexVersion === undefined;
  if (legacy) reasons.push('LEGACY_METADATA');

  if (!legacy && metadata.schemaVersion !== undefined && metadata.indexVersion) {
    const expected = computeIndexVersion(repoDir, metadata.schemaVersion, metadata.indexedAt);
    if (expected !== metadata.indexVersion) reasons.push('INDEX_FINGERPRINT_MISMATCH');
  }

  if (metadata.embeddings?.enabled && metadata.embeddings.status === 'stale') {
    reasons.push('EMBEDDINGS_STALE');
  }

  const currentCommit = readCurrentCommit(repoDir);
  const fresh = !metadata.commitHash || !currentCommit || metadata.commitHash === currentCommit;
  if (!fresh) reasons.push('SOURCE_COMMIT_CHANGED');

  const corrupt = reasons.some((reason) =>
    reason.endsWith('_MISSING') || reason.endsWith('_EMPTY') || reason === 'INDEX_FINGERPRINT_MISMATCH',
  );
  const state: IndexTrustState = corrupt
    ? 'corrupt'
    : legacy
      ? 'legacy'
      : reasons.length > 0
        ? 'stale'
        : 'trusted';

  return {
    state,
    trusted: state === 'trusted',
    fresh,
    reasons,
    metadata,
    currentCommit,
    artifacts,
  };
}

export function upgradeLegacyIndexMetadata(
  repoDir: string,
  schemaVersion: number,
): IndexMetadata {
  const current = loadMetadata(repoDir);
  if (!current) throw new Error(`Cannot upgrade index metadata: ${path.join(repoDir, '.code-intel', 'meta.json')} is missing`);
  const indexedAt = current.indexedAt || new Date().toISOString();
  const upgraded: IndexMetadata = {
    ...current,
    indexedAt,
    schemaVersion,
    indexVersion: computeIndexVersion(repoDir, schemaVersion, indexedAt),
  };
  saveMetadata(repoDir, upgraded);
  return upgraded;
}
