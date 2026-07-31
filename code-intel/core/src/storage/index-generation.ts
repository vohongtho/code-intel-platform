import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const INDEX_DIR = '.code-intel';
const GENERATIONS_DIR = 'generations';
const CURRENT_FILE = 'current.json';

export type IndexArtifactName = 'graph.db' | 'bm25.db' | 'vector.db' | 'meta.json';

export interface IndexGenerationManifest {
  generationId: string;
  publishedAt: string;
  artifacts: IndexArtifactName[];
}

export interface IndexGeneration {
  generationId: string;
  stagingDir: string;
  finalDir: string;
  graphDbPath: string;
  bm25DbPath: string;
  vectorDbPath: string;
  metadataPath: string;
}

function indexDir(repoDir: string): string {
  return path.join(repoDir, INDEX_DIR);
}

function generationsDir(repoDir: string): string {
  return path.join(indexDir(repoDir), GENERATIONS_DIR);
}

export function getCurrentManifestPath(repoDir: string): string {
  return path.join(indexDir(repoDir), CURRENT_FILE);
}

export function loadCurrentGenerationManifest(repoDir: string): IndexGenerationManifest | null {
  try {
    const value = JSON.parse(fs.readFileSync(getCurrentManifestPath(repoDir), 'utf8')) as IndexGenerationManifest;
    if (!value.generationId || !Array.isArray(value.artifacts)) return null;
    return value;
  } catch {
    return null;
  }
}

export function getPublishedGenerationDir(repoDir: string): string | null {
  const manifest = loadCurrentGenerationManifest(repoDir);
  if (!manifest) return null;
  const dir = path.join(generationsDir(repoDir), manifest.generationId);
  return fs.existsSync(dir) ? dir : null;
}

export function resolvePublishedArtifactPath(repoDir: string, artifact: IndexArtifactName): string {
  const staging = process.env['CODE_INTEL_INDEX_STAGING_DIR']?.trim();
  if (staging) return path.join(path.resolve(staging), artifact);
  const generationDir = getPublishedGenerationDir(repoDir);
  if (generationDir) return path.join(generationDir, artifact);
  return path.join(indexDir(repoDir), artifact);
}

export function createIndexGeneration(
  repoDir: string,
  generationId = `${Date.now()}-${crypto.randomUUID()}`,
): IndexGeneration {
  const root = generationsDir(repoDir);
  fs.mkdirSync(root, { recursive: true });
  const stagingDir = path.join(root, `.staging-${generationId}`);
  const finalDir = path.join(root, generationId);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  return {
    generationId,
    stagingDir,
    finalDir,
    graphDbPath: path.join(stagingDir, 'graph.db'),
    bm25DbPath: path.join(stagingDir, 'bm25.db'),
    vectorDbPath: path.join(stagingDir, 'vector.db'),
    metadataPath: path.join(stagingDir, 'meta.json'),
  };
}

function assertArtifact(filePath: string, name: string): void {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size <= 0) {
    throw new Error(`Index generation validation failed: ${name} is missing or empty`);
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function publishIndexGeneration(
  repoDir: string,
  generation: IndexGeneration,
  metadata: unknown,
  options: { vectorRequired?: boolean; keepGenerations?: number } = {},
): IndexGenerationManifest {
  assertArtifact(generation.graphDbPath, 'graph.db');
  assertArtifact(generation.bm25DbPath, 'bm25.db');
  if (options.vectorRequired) assertArtifact(generation.vectorDbPath, 'vector.db');

  atomicWriteJson(generation.metadataPath, metadata);
  assertArtifact(generation.metadataPath, 'meta.json');

  fs.rmSync(generation.finalDir, { recursive: true, force: true });
  fs.renameSync(generation.stagingDir, generation.finalDir);

  const artifacts: IndexArtifactName[] = ['graph.db', 'bm25.db', 'meta.json'];
  if (fs.existsSync(path.join(generation.finalDir, 'vector.db'))) artifacts.push('vector.db');
  const manifest: IndexGenerationManifest = {
    generationId: generation.generationId,
    publishedAt: new Date().toISOString(),
    artifacts,
  };
  atomicWriteJson(getCurrentManifestPath(repoDir), manifest);
  cleanupOldGenerations(repoDir, options.keepGenerations ?? 2, generation.generationId);
  return manifest;
}

export function abortIndexGeneration(generation: IndexGeneration): void {
  fs.rmSync(generation.stagingDir, { recursive: true, force: true });
}

export function cleanupOldGenerations(repoDir: string, keep: number, currentGenerationId?: string): void {
  const root = generationsDir(repoDir);
  if (!fs.existsSync(root)) return;
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.staging-'))
    .map((entry) => ({
      name: entry.name,
      path: path.join(root, entry.name),
      mtimeMs: fs.statSync(path.join(root, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const retained = new Set(entries.slice(0, Math.max(1, keep)).map((entry) => entry.name));
  if (currentGenerationId) retained.add(currentGenerationId);
  for (const entry of entries) {
    if (!retained.has(entry.name)) fs.rmSync(entry.path, { recursive: true, force: true });
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.staging-')) {
      fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
    }
  }
}

export function migrateLegacyIndexToGeneration(repoDir: string): IndexGenerationManifest | null {
  if (loadCurrentGenerationManifest(repoDir)) return loadCurrentGenerationManifest(repoDir);
  const legacyDir = indexDir(repoDir);
  const required = ['graph.db', 'bm25.db', 'meta.json'] as const;
  if (!required.every((name) => fs.existsSync(path.join(legacyDir, name)))) return null;
  const generation = createIndexGeneration(repoDir, `legacy-${Date.now()}-${crypto.randomUUID()}`);
  for (const artifact of ['graph.db', 'bm25.db', 'vector.db'] as const) {
    const source = path.join(legacyDir, artifact);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(generation.stagingDir, artifact));
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(legacyDir, 'meta.json'), 'utf8')) as unknown;
  return publishIndexGeneration(repoDir, generation, metadata, {
    vectorRequired: fs.existsSync(path.join(legacyDir, 'vector.db')),
  });
}
