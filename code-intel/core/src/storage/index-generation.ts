import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const INDEX_DIR = '.code-intel';
export const GENERATIONS_DIR = 'generations';
export const CURRENT_FILE = 'current.json';
export const STAGING_OWNER_FILE = 'staging.json';
export const DEFAULT_STALE_STAGING_MS = 24 * 60 * 60 * 1000;

export type IndexArtifactName = 'graph.db' | 'bm25.db' | 'vector.db' | 'meta.json';
export type ArtifactCloneMode = 'reflink' | 'copy';

export interface IndexGenerationManifest {
  version?: 1 | 2;
  generationId: string;
  publishedAt: string;
  baseGenerationId?: string;
  artifacts: IndexArtifactName[];
}

export interface IndexGeneration {
  generationId: string;
  baseGenerationId?: string;
  stagingDir: string;
  finalDir: string;
  graphDbPath: string;
  bm25DbPath: string;
  vectorDbPath: string;
  metadataPath: string;
}

export interface StagingOwner {
  version: 1;
  generationId: string;
  baseGenerationId?: string;
  pid: number;
  hostname: string;
  createdAt: string;
  lastActivityAt: string;
}

export function getIndexDir(repoDir: string): string {
  return path.join(path.resolve(repoDir), INDEX_DIR);
}

export function getGenerationsDir(repoDir: string): string {
  return path.join(getIndexDir(repoDir), GENERATIONS_DIR);
}

export function getCurrentManifestPath(repoDir: string): string {
  return path.join(getIndexDir(repoDir), CURRENT_FILE);
}

function safeGenerationId(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && path.basename(value) === value;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function loadCurrentGenerationManifest(repoDir: string): IndexGenerationManifest | null {
  try {
    const value = JSON.parse(fs.readFileSync(getCurrentManifestPath(repoDir), 'utf8')) as IndexGenerationManifest;
    if (!safeGenerationId(value.generationId) || !Array.isArray(value.artifacts)) return null;
    if (!value.artifacts.every((artifact) => ['graph.db', 'bm25.db', 'vector.db', 'meta.json'].includes(artifact))) return null;
    return value;
  } catch {
    return null;
  }
}

export function getPublishedGenerationDir(repoDir: string): string | null {
  const manifest = loadCurrentGenerationManifest(repoDir);
  if (!manifest) return null;
  const dir = path.join(getGenerationsDir(repoDir), manifest.generationId);
  return fs.existsSync(dir) ? dir : null;
}

export function resolvePublishedArtifactPath(repoDir: string, artifact: IndexArtifactName): string {
  const staging = process.env['CODE_INTEL_INDEX_STAGING_DIR']?.trim();
  if (staging) return path.join(path.resolve(staging), artifact);
  const generationDir = getPublishedGenerationDir(repoDir);
  if (generationDir) return path.join(generationDir, artifact);
  return path.join(getIndexDir(repoDir), artifact);
}

function ownerFor(generation: IndexGeneration): StagingOwner {
  const now = new Date().toISOString();
  return {
    version: 1,
    generationId: generation.generationId,
    baseGenerationId: generation.baseGenerationId,
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: now,
    lastActivityAt: now,
  };
}

export function createIndexGeneration(
  repoDir: string,
  generationId = `${Date.now()}-${crypto.randomUUID()}`,
  options: { baseGenerationId?: string } = {},
): IndexGeneration {
  if (!safeGenerationId(generationId)) throw new Error(`Invalid index generation ID: ${generationId}`);
  const root = getGenerationsDir(repoDir);
  fs.mkdirSync(root, { recursive: true });
  const stagingDir = path.join(root, `.staging-${generationId}`);
  const finalDir = path.join(root, generationId);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  const generation: IndexGeneration = {
    generationId,
    baseGenerationId: options.baseGenerationId,
    stagingDir,
    finalDir,
    graphDbPath: path.join(stagingDir, 'graph.db'),
    bm25DbPath: path.join(stagingDir, 'bm25.db'),
    vectorDbPath: path.join(stagingDir, 'vector.db'),
    metadataPath: path.join(stagingDir, 'meta.json'),
  };
  atomicWriteJson(path.join(stagingDir, STAGING_OWNER_FILE), ownerFor(generation));
  return generation;
}

export function touchIndexGeneration(generation: IndexGeneration): void {
  const ownerPath = path.join(generation.stagingDir, STAGING_OWNER_FILE);
  try {
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as StagingOwner;
    owner.lastActivityAt = new Date().toISOString();
    atomicWriteJson(ownerPath, owner);
  } catch {
    atomicWriteJson(ownerPath, ownerFor(generation));
  }
}

export function cloneArtifact(source: string, target: string): ArtifactCloneMode {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE_FORCE);
    return 'reflink';
  } catch {
    try {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
      return 'reflink';
    } catch {
      fs.copyFileSync(source, target);
      return 'copy';
    }
  }
}

export function cloneGenerationArtifact(source: string, target: string): ArtifactCloneMode {
  const mode = cloneArtifact(source, target);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${source}${suffix}`;
    if (fs.existsSync(sidecar)) cloneArtifact(sidecar, `${target}${suffix}`);
  }
  return mode;
}

function assertArtifact(filePath: string, name: string): void {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size <= 0) {
    throw new Error(`Index generation validation failed: ${name} is missing or empty`);
  }
}

export function cleanupStaleStaging(
  repoDir: string,
  options: { staleAfterMs?: number; activeGenerationId?: string; nowMs?: number } = {},
): string[] {
  const root = getGenerationsDir(repoDir);
  if (!fs.existsSync(root)) return [];
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_STAGING_MS;
  const nowMs = options.nowMs ?? Date.now();
  const removed: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.staging-')) continue;
    const generationId = entry.name.slice('.staging-'.length);
    if (generationId === options.activeGenerationId) continue;
    const entryPath = path.join(root, entry.name);
    let activityMs = fs.statSync(entryPath).mtimeMs;
    try {
      const owner = JSON.parse(fs.readFileSync(path.join(entryPath, STAGING_OWNER_FILE), 'utf8')) as StagingOwner;
      const parsed = Date.parse(owner.lastActivityAt || owner.createdAt);
      if (Number.isFinite(parsed)) activityMs = parsed;
    } catch {
      // Invalid owner data is removable only after the same conservative TTL.
    }
    if (nowMs - activityMs < staleAfterMs) continue;
    fs.rmSync(entryPath, { recursive: true, force: true });
    removed.push(generationId);
  }
  return removed;
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

  const metadataValue = metadata && typeof metadata === 'object'
    ? { ...(metadata as Record<string, unknown>), generationId: generation.generationId }
    : metadata;
  atomicWriteJson(generation.metadataPath, metadataValue);
  assertArtifact(generation.metadataPath, 'meta.json');
  fs.rmSync(path.join(generation.stagingDir, STAGING_OWNER_FILE), { force: true });

  fs.rmSync(generation.finalDir, { recursive: true, force: true });
  fs.renameSync(generation.stagingDir, generation.finalDir);

  const artifacts: IndexArtifactName[] = ['graph.db', 'bm25.db', 'meta.json'];
  if (fs.existsSync(path.join(generation.finalDir, 'vector.db'))) artifacts.push('vector.db');
  const manifest: IndexGenerationManifest = {
    version: 2,
    generationId: generation.generationId,
    baseGenerationId: generation.baseGenerationId,
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
  const root = getGenerationsDir(repoDir);
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
  cleanupStaleStaging(repoDir);
}

export function migrateLegacyIndexToGeneration(repoDir: string): IndexGenerationManifest | null {
  if (loadCurrentGenerationManifest(repoDir)) return loadCurrentGenerationManifest(repoDir);
  const legacyDir = getIndexDir(repoDir);
  const required = ['graph.db', 'bm25.db', 'meta.json'] as const;
  if (!required.every((name) => fs.existsSync(path.join(legacyDir, name)))) return null;
  const generation = createIndexGeneration(repoDir, `legacy-${Date.now()}-${crypto.randomUUID()}`);
  for (const artifact of ['graph.db', 'bm25.db', 'vector.db'] as const) {
    const source = path.join(legacyDir, artifact);
    if (fs.existsSync(source)) cloneGenerationArtifact(source, path.join(generation.stagingDir, artifact));
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(legacyDir, 'meta.json'), 'utf8')) as unknown;
  return publishIndexGeneration(repoDir, generation, metadata, {
    vectorRequired: fs.existsSync(path.join(legacyDir, 'vector.db')),
  });
}
