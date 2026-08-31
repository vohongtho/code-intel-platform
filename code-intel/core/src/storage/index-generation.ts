import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const INDEX_DIR = '.code-intel';
export const GENERATIONS_DIR = 'generations';
export const CURRENT_FILE = 'current.json';
export const STAGING_OWNER_FILE = 'staging.json';
export const DEFAULT_STALE_STAGING_MS = 24 * 60 * 60 * 1000;

export type IndexArtifactName = 'graph.db' | 'bm25.db' | 'vector.db' | 'meta.json' | 'evidence.db' | 'semantic-index.json';
export type ArtifactCloneMode = 'reflink' | 'copy';

export interface IndexArtifactDetails {
  size: number;
  required: boolean;
}

export interface AnalyzerCompatibilityReceipt {
  ddlFingerprint: string;
  analyzerFingerprint: string;
  languageRegistryFingerprint: string;
  factSchemaFingerprint: string;
  identityFingerprint: string;
  resolverFingerprint: string;
  evidenceFingerprint?: string;
  embeddingFingerprint?: string;
}

export type ArtifactStatus =
  | 'verified'
  | 'partial-recoverable'
  | 'stale'
  | 'interrupted'
  | 'unverified'
  | 'collapsed'
  | 'corrupt'
  | 'unavailable';

export interface ArtifactVerification {
  status: ArtifactStatus;
  producedCount?: number;
  persistedCount?: number;
  contentFingerprint?: string;
  reason?: string;
}

export type EvolutionAction =
  | 'reuse'
  | 'metadata-migrate'
  | 'artifact-rebuild'
  | 'full-reanalysis'
  | 'reject-corrupt';

export interface IndexGenerationManifestV1 {
  version?: 1;
  generationId: string;
  publishedAt: string;
  artifacts: IndexArtifactName[];
}

export interface IndexGenerationManifestV2 {
  version: 2;
  generationId: string;
  publishedAt: string;
  baseGenerationId?: string;
  schemaVersion?: number;
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
  artifacts: IndexArtifactName[];
  artifactDetails?: Partial<Record<IndexArtifactName, IndexArtifactDetails>>;
}

export type IndexGenerationManifest = IndexGenerationManifestV1 | IndexGenerationManifestV2;

export interface IndexGeneration {
  generationId: string;
  baseGenerationId?: string;
  stagingDir: string;
  finalDir: string;
  graphDbPath: string;
  bm25DbPath: string;
  vectorDbPath: string;
  evidenceDbPath?: string;
  metadataPath: string;
  semanticIndexPath: string;
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

export function safeGenerationId(value: string): boolean {
  return value.length > 0
    && !value.includes('\0')
    && value !== '.'
    && value !== '..'
    && !path.isAbsolute(value)
    && !value.includes('/')
    && !value.includes('\\')
    && path.basename(value) === value;
}

function isArtifactName(value: unknown): value is IndexArtifactName {
  return typeof value === 'string'
    && ['graph.db', 'bm25.db', 'vector.db', 'meta.json', 'evidence.db', 'semantic-index.json'].includes(value);
}

export function normalizeIndexGenerationManifest(value: unknown): IndexGenerationManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.generationId !== 'string' || !safeGenerationId(candidate.generationId)) return null;
  if (typeof candidate.publishedAt !== 'string' || !Number.isFinite(Date.parse(candidate.publishedAt))) return null;
  if (!Array.isArray(candidate.artifacts) || !candidate.artifacts.every(isArtifactName)) return null;

  if (candidate.version === undefined || candidate.version === 1) {
    return {
      version: candidate.version as 1 | undefined,
      generationId: candidate.generationId,
      publishedAt: candidate.publishedAt,
      artifacts: [...new Set(candidate.artifacts as IndexArtifactName[])],
    };
  }
  if (candidate.version !== 2) return null;
  if (candidate.baseGenerationId !== undefined
    && (typeof candidate.baseGenerationId !== 'string' || !safeGenerationId(candidate.baseGenerationId))) return null;
  if (candidate.parser !== undefined && candidate.parser !== 'tree-sitter' && candidate.parser !== 'regex') return null;
  if (candidate.schemaVersion !== undefined && !Number.isInteger(candidate.schemaVersion)) return null;
  if (candidate.compatibilityReceipt !== undefined) {
    const receipt = candidate.compatibilityReceipt;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
    const record = receipt as Record<string, unknown>;
    for (const key of ['ddlFingerprint', 'analyzerFingerprint', 'languageRegistryFingerprint', 'factSchemaFingerprint', 'identityFingerprint', 'resolverFingerprint'] as const) {
      if (typeof record[key] !== 'string') return null;
    }
    for (const key of ['evidenceFingerprint', 'embeddingFingerprint'] as const) {
      if (record[key] !== undefined && typeof record[key] !== 'string') return null;
    }
  }
  for (const key of ['graphVerification', 'bm25Verification', 'vectorVerification', 'evidenceVerification'] as const) {
    const verification = candidate[key];
    if (verification === undefined) continue;
    if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return null;
    const record = verification as Record<string, unknown>;
    if (typeof record.status !== 'string') return null;
    for (const countKey of ['producedCount', 'persistedCount'] as const) {
      if (record[countKey] !== undefined && !Number.isInteger(record[countKey])) return null;
    }
    for (const textKey of ['contentFingerprint', 'reason'] as const) {
      if (record[textKey] !== undefined && typeof record[textKey] !== 'string') return null;
    }
  }
  if (candidate.evolutionAction !== undefined
    && !['reuse', 'metadata-migrate', 'artifact-rebuild', 'full-reanalysis', 'reject-corrupt'].includes(candidate.evolutionAction as string)) return null;
  if (candidate.factSchemaVersion !== undefined && typeof candidate.factSchemaVersion !== 'string') return null;
  if (candidate.factSchemaFingerprint !== undefined && typeof candidate.factSchemaFingerprint !== 'string') return null;
  if (candidate.identityFingerprint !== undefined && typeof candidate.identityFingerprint !== 'string') return null;
  if (candidate.resolverVersion !== undefined && typeof candidate.resolverVersion !== 'string') return null;
  if (candidate.resolverFingerprint !== undefined && typeof candidate.resolverFingerprint !== 'string') return null;
  if (candidate.evidenceSchemaVersion !== undefined && !Number.isInteger(candidate.evidenceSchemaVersion)) return null;
  if (candidate.evidenceSchemaFingerprint !== undefined && typeof candidate.evidenceSchemaFingerprint !== 'string') return null;

  return {
    version: 2,
    generationId: candidate.generationId,
    publishedAt: candidate.publishedAt,
    baseGenerationId: candidate.baseGenerationId as string | undefined,
    schemaVersion: candidate.schemaVersion as number | undefined,
    parser: candidate.parser as 'tree-sitter' | 'regex' | undefined,
    compatibilityReceipt: candidate.compatibilityReceipt as AnalyzerCompatibilityReceipt | undefined,
    graphVerification: candidate.graphVerification as ArtifactVerification | undefined,
    bm25Verification: candidate.bm25Verification as ArtifactVerification | undefined,
    vectorVerification: candidate.vectorVerification as ArtifactVerification | undefined,
    evidenceVerification: candidate.evidenceVerification as ArtifactVerification | undefined,
    evolutionAction: candidate.evolutionAction as EvolutionAction | undefined,
    factSchemaVersion: candidate.factSchemaVersion as string | undefined,
    factSchemaFingerprint: candidate.factSchemaFingerprint as string | undefined,
    identityFingerprint: candidate.identityFingerprint as string | undefined,
    resolverVersion: candidate.resolverVersion as string | undefined,
    resolverFingerprint: candidate.resolverFingerprint as string | undefined,
    evidenceSchemaVersion: candidate.evidenceSchemaVersion as number | undefined,
    evidenceSchemaFingerprint: candidate.evidenceSchemaFingerprint as string | undefined,
    artifacts: [...new Set(candidate.artifacts as IndexArtifactName[])],
    artifactDetails: candidate.artifactDetails as IndexGenerationManifestV2['artifactDetails'],
  };
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function loadCurrentGenerationManifest(repoDir: string): IndexGenerationManifest | null {
  try {
    return normalizeIndexGenerationManifest(
      JSON.parse(fs.readFileSync(getCurrentManifestPath(repoDir), 'utf8')) as unknown,
    );
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
    evidenceDbPath: path.join(stagingDir, 'evidence.db'),
    metadataPath: path.join(stagingDir, 'meta.json'),
    semanticIndexPath: path.join(stagingDir, 'semantic-index.json'),
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

function verifyProducedPersisted(receipt: ArtifactVerification | undefined, name: string): void {
  if (!receipt) return;
  if (receipt.status === 'collapsed') {
    throw new Error(`Index generation validation failed: ${name} collapsed`);
  }
  if (
    receipt.producedCount !== undefined
    && receipt.persistedCount !== undefined
    && receipt.persistedCount < receipt.producedCount
  ) {
    throw new Error(`Index generation validation failed: ${name} persisted count ${receipt.persistedCount} below produced count ${receipt.producedCount}`);
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
  options: { vectorRequired?: boolean; keepGenerations?: number; staleStagingMs?: number } = {},
): IndexGenerationManifest {
  assertArtifact(generation.graphDbPath, 'graph.db');
  assertArtifact(generation.bm25DbPath, 'bm25.db');
  if (options.vectorRequired) assertArtifact(generation.vectorDbPath, 'vector.db');

  const metadataValue = metadata && typeof metadata === 'object'
    ? { ...(metadata as Record<string, unknown>), generationId: generation.generationId }
    : metadata;
  const metadataRecord = metadataValue && typeof metadataValue === 'object'
    ? metadataValue as {
        schemaVersion?: number;
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
      }
    : undefined;
  if (metadataRecord?.compatibilityReceipt && !metadataRecord.factSchemaFingerprint) {
    metadataRecord.factSchemaFingerprint = metadataRecord.compatibilityReceipt.factSchemaFingerprint;
  }
  if (metadataRecord?.compatibilityReceipt && !metadataRecord.identityFingerprint) {
    metadataRecord.identityFingerprint = metadataRecord.compatibilityReceipt.identityFingerprint;
  }
  if (metadataRecord?.compatibilityReceipt && !metadataRecord.resolverFingerprint) {
    metadataRecord.resolverFingerprint = metadataRecord.compatibilityReceipt.resolverFingerprint;
  }
  if (metadataRecord?.compatibilityReceipt?.evidenceFingerprint && !metadataRecord.evidenceSchemaFingerprint) {
    metadataRecord.evidenceSchemaFingerprint = metadataRecord.compatibilityReceipt.evidenceFingerprint;
  }
  verifyProducedPersisted(metadataRecord?.graphVerification, 'graph.db');
  verifyProducedPersisted(metadataRecord?.bm25Verification, 'bm25.db');
  verifyProducedPersisted(metadataRecord?.vectorVerification, 'vector.db');
  verifyProducedPersisted(metadataRecord?.evidenceVerification, 'evidence.db');
  atomicWriteJson(generation.metadataPath, metadataValue);
  assertArtifact(generation.metadataPath, 'meta.json');
  fs.rmSync(path.join(generation.stagingDir, STAGING_OWNER_FILE), { force: true });

  fs.rmSync(generation.finalDir, { recursive: true, force: true });
  fs.renameSync(generation.stagingDir, generation.finalDir);

  const artifacts: IndexArtifactName[] = ['graph.db', 'bm25.db', 'meta.json'];
  if (fs.existsSync(path.join(generation.finalDir, 'vector.db'))) artifacts.push('vector.db');
  if (fs.existsSync(path.join(generation.finalDir, 'evidence.db'))) artifacts.push('evidence.db');
  if (fs.existsSync(path.join(generation.finalDir, 'semantic-index.json'))) artifacts.push('semantic-index.json');
  const artifactDetails = Object.fromEntries(artifacts.map((artifact) => {
    const artifactPath = path.join(generation.finalDir, artifact);
    return [artifact, {
      size: fs.statSync(artifactPath).size,
      required: artifact !== 'vector.db' || Boolean(options.vectorRequired),
    }];
  })) as Partial<Record<IndexArtifactName, IndexArtifactDetails>>;
  const manifest: IndexGenerationManifestV2 = {
    version: 2,
    generationId: generation.generationId,
    baseGenerationId: generation.baseGenerationId,
    publishedAt: new Date().toISOString(),
    schemaVersion: metadataRecord?.schemaVersion,
    parser: metadataRecord?.parser,
    compatibilityReceipt: metadataRecord?.compatibilityReceipt,
    graphVerification: metadataRecord?.graphVerification,
    bm25Verification: metadataRecord?.bm25Verification,
    vectorVerification: metadataRecord?.vectorVerification,
    evidenceVerification: metadataRecord?.evidenceVerification,
    evolutionAction: metadataRecord?.evolutionAction,
    factSchemaVersion: metadataRecord?.factSchemaVersion,
    factSchemaFingerprint: metadataRecord?.factSchemaFingerprint,
    identityFingerprint: metadataRecord?.identityFingerprint,
    resolverVersion: metadataRecord?.resolverVersion,
    resolverFingerprint: metadataRecord?.resolverFingerprint,
    evidenceSchemaVersion: metadataRecord?.evidenceSchemaVersion,
    evidenceSchemaFingerprint: metadataRecord?.evidenceSchemaFingerprint,
    artifacts,
    artifactDetails,
  };
  atomicWriteJson(getCurrentManifestPath(repoDir), manifest);
  cleanupOldGenerations(
    repoDir,
    options.keepGenerations ?? 2,
    generation.generationId,
    options.staleStagingMs,
  );
  return manifest;
}

export function abortIndexGeneration(generation: IndexGeneration): void {
  fs.rmSync(generation.stagingDir, { recursive: true, force: true });
}

export function cleanupOldGenerations(
  repoDir: string,
  keep: number,
  currentGenerationId?: string,
  staleStagingMs = DEFAULT_STALE_STAGING_MS,
): void {
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
  cleanupStaleStaging(repoDir, { staleAfterMs: staleStagingMs });
}

export function migrateLegacyIndexToGeneration(repoDir: string): IndexGenerationManifest | null {
  if (loadCurrentGenerationManifest(repoDir)) return loadCurrentGenerationManifest(repoDir);
  const legacyDir = getIndexDir(repoDir);
  const required = ['graph.db', 'bm25.db', 'meta.json'] as const;
  if (!required.every((name) => fs.existsSync(path.join(legacyDir, name)))) return null;
  const generation = createIndexGeneration(repoDir, `legacy-${Date.now()}-${crypto.randomUUID()}`);
  for (const artifact of ['graph.db', 'bm25.db', 'vector.db', 'evidence.db'] as const) {
    const source = path.join(legacyDir, artifact);
    if (fs.existsSync(source)) cloneGenerationArtifact(source, path.join(generation.stagingDir, artifact));
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(legacyDir, 'meta.json'), 'utf8')) as unknown;
  return publishIndexGeneration(repoDir, generation, metadata, {
    vectorRequired: fs.existsSync(path.join(legacyDir, 'vector.db')),
  });
}
