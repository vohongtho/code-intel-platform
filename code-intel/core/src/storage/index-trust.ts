import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  computeIndexVersionForPaths,
  loadMetadata,
  saveMetadata,
  type IndexMetadata,
} from './metadata.js';
import { resolveIndexSnapshot } from './index-snapshot.js';

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
  generationId?: string;
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

function readMetadata(filePath: string): IndexMetadata | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) as IndexMetadata; } catch { return null; }
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
  const snapshot = resolveIndexSnapshot(repoDir);
  const fallbackDir = path.join(path.resolve(repoDir), '.code-intel');
  const paths = snapshot ?? {
    generationId: undefined,
    graphDbPath: path.join(fallbackDir, 'graph.db'),
    bm25DbPath: path.join(fallbackDir, 'bm25.db'),
    vectorDbPath: path.join(fallbackDir, 'vector.db'),
    metadataPath: path.join(fallbackDir, 'meta.json'),
    legacy: true,
  };
  const metadata = readMetadata(paths.metadataPath);
  const vectorRequired = Boolean(metadata?.embeddings?.enabled && metadata.embeddings.status === 'ready');
  const artifacts = {
    graph: artifactState(paths.graphDbPath, true),
    bm25: artifactState(paths.bm25DbPath, true),
    vector: artifactState(paths.vectorDbPath, vectorRequired),
  };
  const reasons: string[] = [];
  const anyArtifact = Object.values(artifacts).some((artifact) => artifact.exists);

  if (!metadata && !anyArtifact) {
    return { state: 'missing', trusted: false, fresh: false, reasons: ['INDEX_NOT_FOUND'], metadata: null, generationId: snapshot?.generationId, artifacts };
  }
  if (!metadata) {
    return { state: 'legacy', trusted: false, fresh: false, reasons: ['METADATA_MISSING'], metadata: null, generationId: snapshot?.generationId, artifacts };
  }

  for (const [name, artifact] of Object.entries(artifacts)) {
    if (artifact.required && !artifact.exists) reasons.push(`${name.toUpperCase()}_ARTIFACT_MISSING`);
    if (artifact.exists && artifact.size === 0) reasons.push(`${name.toUpperCase()}_ARTIFACT_EMPTY`);
  }

  const legacy = paths.legacy || metadata.schemaVersion === undefined || metadata.indexVersion === undefined;
  if (legacy) reasons.push('LEGACY_METADATA');

  if (!legacy && metadata.schemaVersion !== undefined && metadata.indexVersion) {
    const expected = computeIndexVersionForPaths(metadata.schemaVersion, metadata.indexedAt, {
      graphDbPath: paths.graphDbPath,
      bm25DbPath: paths.bm25DbPath,
      vectorDbPath: paths.vectorDbPath,
    });
    if (expected !== metadata.indexVersion) reasons.push('INDEX_FINGERPRINT_MISMATCH');
  }

  if (metadata.generationId && snapshot && !snapshot.legacy && metadata.generationId !== snapshot.generationId) {
    reasons.push('GENERATION_ID_MISMATCH');
  }
  if (metadata.embeddings?.enabled && metadata.embeddings.status === 'stale') reasons.push('EMBEDDINGS_STALE');

  const currentCommit = readCurrentCommit(repoDir);
  const fresh = !metadata.commitHash || !currentCommit || metadata.commitHash === currentCommit;
  if (!fresh) reasons.push('SOURCE_COMMIT_CHANGED');

  const corrupt = reasons.some((reason) =>
    reason.endsWith('_MISSING') || reason.endsWith('_EMPTY')
    || reason === 'INDEX_FINGERPRINT_MISMATCH' || reason === 'GENERATION_ID_MISMATCH',
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
    generationId: snapshot?.generationId,
    artifacts,
  };
}

export function upgradeLegacyIndexMetadata(repoDir: string, schemaVersion: number): IndexMetadata {
  const current = loadMetadata(repoDir);
  if (!current) throw new Error(`Cannot upgrade index metadata: ${path.join(repoDir, '.code-intel', 'meta.json')} is missing`);
  const indexedAt = current.indexedAt || new Date().toISOString();
  const snapshot = resolveIndexSnapshot(repoDir);
  const upgraded: IndexMetadata = {
    ...current,
    indexedAt,
    schemaVersion,
    indexVersion: snapshot
      ? computeIndexVersionForPaths(schemaVersion, indexedAt, snapshot)
      : current.indexVersion,
  };
  saveMetadata(repoDir, upgraded);
  return upgraded;
}
