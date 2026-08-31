import fs from 'node:fs';
import path from 'node:path';
import {
  getCurrentManifestPath,
  getGenerationsDir,
  normalizeIndexGenerationManifest,
  type IndexArtifactName,
  type IndexGenerationManifest,
} from './index-generation.js';

export interface IndexSnapshot {
  repositoryRoot: string;
  generationId: string;
  generationDir: string;
  legacy: boolean;
  manifestVersion: 1 | 2 | null;
  manifest: IndexGenerationManifest | null;
  graphDbPath: string;
  bm25DbPath: string;
  vectorDbPath: string;
  evidenceDbPath?: string;
  metadataPath: string;
  semanticIndexPath: string;
}

export class IndexSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexSnapshotError';
  }
}

function isSafeGenerationId(value: string): boolean {
  return value.length > 0
    && !value.includes('\0')
    && value !== '.'
    && value !== '..'
    && !path.isAbsolute(value)
    && !value.includes('/')
    && !value.includes('\\')
    && path.basename(value) === value;
}

function isContainedPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeRealPath(candidate: string): string | null {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

function buildSnapshot(
  repositoryRoot: string,
  generationId: string,
  generationDir: string,
  legacy: boolean,
  manifest: IndexGenerationManifest | null,
): IndexSnapshot {
  return Object.freeze({
    repositoryRoot,
    generationId,
    generationDir,
    legacy,
    manifestVersion: manifest?.version ?? (manifest ? 1 : null),
    manifest,
    graphDbPath: path.join(generationDir, 'graph.db'),
    bm25DbPath: path.join(generationDir, 'bm25.db'),
    vectorDbPath: path.join(generationDir, 'vector.db'),
    evidenceDbPath: path.join(generationDir, 'evidence.db'),
    metadataPath: path.join(generationDir, 'meta.json'),
    semanticIndexPath: path.join(generationDir, 'semantic-index.json'),
  });
}

function resolveStagingSnapshot(repositoryRoot: string, stagingValue: string): IndexSnapshot | null {
  const generationRoot = getGenerationsDir(repositoryRoot);
  const generationRootReal = safeRealPath(generationRoot);
  const generationDir = path.resolve(stagingValue);
  const generationDirReal = safeRealPath(generationDir);
  if (!generationRootReal || !generationDirReal || !isContainedPath(generationRootReal, generationDirReal)) return null;
  const name = path.basename(generationDirReal).replace(/^\.staging-/, '');
  if (!isSafeGenerationId(name)) return null;
  return buildSnapshot(repositoryRoot, name, generationDirReal, false, null);
}

function readManifestOnce(repositoryRoot: string): IndexGenerationManifest | null {
  try {
    const raw = fs.readFileSync(getCurrentManifestPath(repositoryRoot), 'utf8');
    return normalizeIndexGenerationManifest(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function resolvePublishedSnapshot(repositoryRoot: string): IndexSnapshot | null {
  const manifest = readManifestOnce(repositoryRoot);
  if (!manifest || !isSafeGenerationId(manifest.generationId)) return null;

  const generationRoot = getGenerationsDir(repositoryRoot);
  const generationRootReal = safeRealPath(generationRoot);
  const generationDir = path.join(generationRoot, manifest.generationId);
  const generationDirReal = safeRealPath(generationDir);
  if (!generationRootReal || !generationDirReal || !isContainedPath(generationRootReal, generationDirReal)) return null;
  if (!fs.statSync(generationDirReal).isDirectory()) return null;
  return buildSnapshot(repositoryRoot, manifest.generationId, generationDirReal, false, manifest);
}

function resolveLegacySnapshot(repositoryRoot: string): IndexSnapshot | null {
  const legacyDir = path.join(repositoryRoot, '.code-intel');
  const repositoryReal = safeRealPath(repositoryRoot);
  const legacyReal = safeRealPath(legacyDir);
  if (!repositoryReal || !legacyReal || !isContainedPath(repositoryReal, legacyReal)) return null;
  const legacyArtifacts: IndexArtifactName[] = ['graph.db', 'bm25.db', 'vector.db', 'evidence.db', 'meta.json'];
  if (!legacyArtifacts.some((artifact) => fs.existsSync(path.join(legacyReal, artifact)))) return null;
  return buildSnapshot(repositoryRoot, 'legacy', legacyReal, true, null);
}

export function resolveIndexSnapshot(repoDir: string): IndexSnapshot | null {
  const repositoryRoot = path.resolve(repoDir);
  if (!fs.existsSync(repositoryRoot) || !fs.statSync(repositoryRoot).isDirectory()) return null;

  const staging = process.env['CODE_INTEL_INDEX_STAGING_DIR']?.trim();
  if (staging) return resolveStagingSnapshot(repositoryRoot, staging);

  return resolvePublishedSnapshot(repositoryRoot) ?? resolveLegacySnapshot(repositoryRoot);
}

export function requireIndexSnapshot(repoDir: string): IndexSnapshot {
  const snapshot = resolveIndexSnapshot(repoDir);
  if (!snapshot) throw new IndexSnapshotError(`No safe index snapshot is available for ${path.resolve(repoDir)}`);
  return snapshot;
}

export function getSnapshotArtifactPath(
  snapshot: IndexSnapshot,
  artifact: IndexArtifactName,
): string {
  switch (artifact) {
    case 'graph.db': return snapshot.graphDbPath;
    case 'bm25.db': return snapshot.bm25DbPath;
    case 'vector.db': return snapshot.vectorDbPath;
    case 'evidence.db': return snapshot.evidenceDbPath ?? path.join(snapshot.generationDir, 'evidence.db');
    case 'meta.json': return snapshot.metadataPath;
    case 'semantic-index.json': return snapshot.semanticIndexPath;
  }
}

export function snapshotStillCurrent(snapshot: IndexSnapshot): boolean {
  if (snapshot.legacy) return !fs.existsSync(getCurrentManifestPath(snapshot.repositoryRoot));
  const current = readManifestOnce(snapshot.repositoryRoot);
  return current?.generationId === snapshot.generationId;
}
