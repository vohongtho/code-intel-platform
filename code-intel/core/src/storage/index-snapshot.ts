import fs from 'node:fs';
import path from 'node:path';
import {
  getCurrentManifestPath,
  loadCurrentGenerationManifest,
  type IndexArtifactName,
  type IndexGenerationManifest,
} from './index-generation.js';

export interface IndexSnapshot {
  repositoryRoot: string;
  generationId: string;
  generationDir: string;
  legacy: boolean;
  manifest: IndexGenerationManifest | null;
  graphDbPath: string;
  bm25DbPath: string;
  vectorDbPath: string;
  metadataPath: string;
}

function isSafeGenerationId(value: string): boolean {
  return value.length > 0
    && value !== '.'
    && value !== '..'
    && path.basename(value) === value;
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
    manifest,
    graphDbPath: path.join(generationDir, 'graph.db'),
    bm25DbPath: path.join(generationDir, 'bm25.db'),
    vectorDbPath: path.join(generationDir, 'vector.db'),
    metadataPath: path.join(generationDir, 'meta.json'),
  });
}

export function resolveIndexSnapshot(repoDir: string): IndexSnapshot | null {
  const repositoryRoot = path.resolve(repoDir);
  const staging = process.env['CODE_INTEL_INDEX_STAGING_DIR']?.trim();
  if (staging) {
    const generationDir = path.resolve(staging);
    if (fs.existsSync(generationDir)) {
      const name = path.basename(generationDir).replace(/^\.staging-/, '');
      return buildSnapshot(repositoryRoot, name || 'staging', generationDir, false, null);
    }
  }

  const manifest = loadCurrentGenerationManifest(repositoryRoot);
  if (manifest && isSafeGenerationId(manifest.generationId)) {
    const generationDir = path.join(repositoryRoot, '.code-intel', 'generations', manifest.generationId);
    if (fs.existsSync(generationDir) && fs.statSync(generationDir).isDirectory()) {
      return buildSnapshot(repositoryRoot, manifest.generationId, generationDir, false, manifest);
    }
  }

  const legacyDir = path.join(repositoryRoot, '.code-intel');
  const legacyArtifacts: IndexArtifactName[] = ['graph.db', 'bm25.db', 'vector.db', 'meta.json'];
  if (legacyArtifacts.some((artifact) => fs.existsSync(path.join(legacyDir, artifact)))) {
    return buildSnapshot(repositoryRoot, 'legacy', legacyDir, true, null);
  }
  return null;
}

export function getSnapshotArtifactPath(
  snapshot: IndexSnapshot,
  artifact: IndexArtifactName,
): string {
  switch (artifact) {
    case 'graph.db': return snapshot.graphDbPath;
    case 'bm25.db': return snapshot.bm25DbPath;
    case 'vector.db': return snapshot.vectorDbPath;
    case 'meta.json': return snapshot.metadataPath;
  }
}

export function snapshotStillCurrent(snapshot: IndexSnapshot): boolean {
  if (snapshot.legacy) return !fs.existsSync(getCurrentManifestPath(snapshot.repositoryRoot));
  return loadCurrentGenerationManifest(snapshot.repositoryRoot)?.generationId === snapshot.generationId;
}
