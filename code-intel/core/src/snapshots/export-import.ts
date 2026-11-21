/**
 * export-import.ts — portable index export/import over the semantic-snapshot cache.
 *
 * Export packages one validated snapshot cache entry (held by a read pin) into a
 * deterministic `.cidx` file. Import treats a package as untrusted input:
 *
 *   bound + extract allowlisted entries into a fresh staging dir (portable-format.ts)
 *   → verify every size/hash against the manifest before any DB is opened
 *   → (optional) verify the whole package against a digest pinned out of band
 *   → validate repository identity, analyzer/schema fingerprints and Git tree
 *   → enforce the declared privacy profile (metadata-only ⇒ no source text)
 *   → reopen every artifact read-only (verifySnapshotReadBack)
 *   → atomically publish the cache entry, optionally pin it locally.
 *
 * Nothing here touches Generation V2: an imported snapshot is only ever a
 * read source for explicit `ref` queries and graph diffs.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IndexMetadata } from '../storage/metadata.js';
import { resolveReadIndexView } from '../storage/index-view-resolver.js';
import { loadGraphSnapshotFromDbPath } from '../multi-repo/graph-from-db.js';
import { verifySnapshotReadBack } from './snapshot-builder.js';
import { computeAnalyzerFingerprints, type AnalyzerFingerprints } from './fingerprint.js';
import { GitMaterializationError, resolveGitRef, resolveRepositoryIdentity } from './git-materializer.js';
import {
  isSnapshotPinned,
  listSnapshotEntries,
  pinSnapshot,
  publishSnapshotEntry,
  removeSnapshotEntry,
  resolveSnapshotDescriptor,
  unpinSnapshot,
  type RemoveSnapshotResult,
  type SnapshotEntrySummary,
} from './cache.js';
import { getSnapshotStagingDir, SNAPSHOT_CAPABILITIES_FILE } from './paths.js';
import {
  DEFAULT_PORTABLE_LIMITS,
  EPOCH_ISO,
  extractPortablePackage,
  isPortableArtifactName,
  PORTABLE_ARTIFACT_ALLOWLIST,
  PORTABLE_INDEX_FORMAT,
  PORTABLE_INDEX_FORMAT_VERSION,
  PORTABLE_MANIFEST_NAME,
  PortableFormatError,
  serializeManifest,
  writePortableArchive,
  type PortableArtifactEntry,
  type PortableArtifactName,
  type PortableIndexManifestV1,
  type PortableLimits,
} from './portable-format.js';
import { bm25HasNoSnippets, findSourceContent, METADATA_ONLY_TRANSFORM_VERSION, writeMetadataOnlyArtifacts } from './privacy.js';
import { SNAPSHOT_SCHEMA_VERSION, type PortablePrivacyProfile, type SnapshotCapabilities } from './types.js';

// ─── Shared helpers ─────────────────────────────────────────────────────────

let cachedVersion: string | null = null;

/** Informational producer version (not used for compatibility; analyzer fingerprints are). */
export function codeIntelPackageVersion(): string {
  if (cachedVersion) return cachedVersion;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === '@vohongtho.infotech/code-intel' && pkg.version) return (cachedVersion = pkg.version);
    } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return (cachedVersion = 'unknown');
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Repository identities that embed credentials (e.g. `https://user:token@host/…`)
 * must never be written into a shareable package.
 */
export function identityHasEmbeddedCredentials(identity: string): boolean {
  if (!identity.includes('://')) return false;
  try {
    const url = new URL(identity);
    if (url.password) return true;
    return Boolean(url.username) && url.protocol !== 'ssh:' && url.protocol !== 'git+ssh:';
  } catch {
    return /:\/\/[^/]*@/.test(identity);
  }
}

const SQLITE_ARTIFACTS: ReadonlySet<PortableArtifactName> = new Set(['bm25.db', 'vector.db', 'evidence.db']);

/** A non-empty WAL means the main file alone is not the artifact's full content. */
function assertNoPendingWal(dir: string, name: PortableArtifactName): void {
  if (!SQLITE_ARTIFACTS.has(name)) return;
  const wal = path.join(dir, `${name}-wal`);
  try {
    if (fs.statSync(wal).size > 0) throw new Error(`${name} has an un-checkpointed write-ahead log; re-run the query that built it or rebuild the snapshot`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export interface ExportPortableIndexRequest {
  repoDir: string;
  ref: string;
  outputPath: string;
  privacyProfile?: PortablePrivacyProfile;
  /** Include the snapshot's own vectors when it has ready ones. Default true. */
  includeVectors?: boolean;
  /** Build the snapshot if it is not cached. Default true. */
  allowBuild?: boolean;
  /** Replace an existing output file. Default false. */
  overwrite?: boolean;
  limits?: PortableLimits;
}

export type ExportPortableIndexResult =
  | {
    status: 'exported';
    outputPath: string;
    manifest: PortableIndexManifestV1;
    packageSha256: string;
    packageBytes: number;
    durationMs: number;
  }
  | { status: 'failed'; code: string; message: string };

interface PlannedArtifact {
  name: PortableArtifactName;
  filePath: string;
}

export async function exportPortableIndex(request: ExportPortableIndexRequest): Promise<ExportPortableIndexResult> {
  const startedAt = Date.now();
  const profile = request.privacyProfile ?? 'full';
  const limits = request.limits ?? DEFAULT_PORTABLE_LIMITS;
  const outputPath = path.resolve(request.outputPath);
  if (fs.existsSync(outputPath) && !request.overwrite) {
    return { status: 'failed', code: 'output-exists', message: `${outputPath} already exists (pass overwrite to replace it)` };
  }

  const resolution = await resolveReadIndexView({ repoDir: request.repoDir, ref: request.ref, allowBuild: request.allowBuild });
  if (!resolution.ok) return { status: 'failed', code: resolution.boundary.kind, message: resolution.boundary.message };
  const view = resolution.view;
  const workDir = getSnapshotStagingDir(view.repositoryRoot, `export-${crypto.randomUUID()}`);
  try {
    if (view.kind !== 'semantic-snapshot' || !view.descriptor) {
      return { status: 'failed', code: 'not-a-snapshot', message: 'only committed-ref snapshots can be exported' };
    }
    const descriptor = { ...view.descriptor, createdAt: EPOCH_ISO };
    if (identityHasEmbeddedCredentials(descriptor.repositoryIdentity)) {
      return { status: 'failed', code: 'identity-has-credentials', message: 'the repository remote URL embeds credentials; remove them from `origin` before exporting' };
    }
    if (profile === 'full' && !view.capabilities.sourceContent) {
      return { status: 'failed', code: 'source-unavailable', message: 'this snapshot carries no source content (it was imported metadata-only); export it with privacy profile metadata-only' };
    }

    const planned: PlannedArtifact[] = [];
    let capabilities: SnapshotCapabilities;
    const src = view.artifactsDir;
    const present = (name: PortableArtifactName) => fs.existsSync(path.join(src, name));

    if (profile === 'metadata-only') {
      fs.mkdirSync(workDir, { recursive: true });
      const stripped = await writeMetadataOnlyArtifacts(src, workDir);
      planned.push({ name: 'graph.db', filePath: stripped.graphDbPath });
      planned.push({ name: 'bm25.db', filePath: stripped.bm25DbPath });
      if (stripped.evidenceDbPath) planned.push({ name: 'evidence.db', filePath: stripped.evidenceDbPath });
      for (const name of ['meta.json', 'content-fingerprints.json'] as const) if (present(name)) planned.push({ name, filePath: path.join(src, name) });
      capabilities = {
        privacyProfile: 'metadata-only',
        sourceContent: false,
        bm25: true,
        bm25Content: 'names-only',
        vector: false,
        evidence: Boolean(stripped.evidenceDbPath),
        protocolContracts: false,
      };
    } else {
      const includeVector = request.includeVectors !== false && view.capabilities.vector;
      for (const name of Object.keys(PORTABLE_ARTIFACT_ALLOWLIST) as PortableArtifactName[]) {
        if (!present(name)) continue;
        if (name === 'vector.db' && !includeVector) continue;
        if (name === 'bm25.db' && !view.capabilities.bm25) continue;
        if (name === 'evidence.db' && !view.capabilities.evidence) continue;
        if (name === 'protocol-contracts.json' && !view.capabilities.protocolContracts) continue;
        assertNoPendingWal(src, name);
        planned.push({ name, filePath: path.join(src, name) });
      }
      capabilities = {
        privacyProfile: 'full',
        sourceContent: true,
        bm25: planned.some((a) => a.name === 'bm25.db'),
        bm25Content: planned.some((a) => a.name === 'bm25.db') ? view.capabilities.bm25Content : 'none',
        vector: planned.some((a) => a.name === 'vector.db'),
        evidence: planned.some((a) => a.name === 'evidence.db'),
        protocolContracts: planned.some((a) => a.name === 'protocol-contracts.json'),
      };
    }
    planned.sort((a, b) => a.name.localeCompare(b.name));

    const artifacts: PortableArtifactEntry[] = [];
    let total = 0;
    for (const artifact of planned) {
      const size = fs.statSync(artifact.filePath).size;
      if (size > limits.maxArtifactBytes) return { status: 'failed', code: 'limit-exceeded', message: `${artifact.name} is ${size} bytes (limit ${limits.maxArtifactBytes})` };
      total += size;
      if (total > limits.maxTotalBytes) return { status: 'failed', code: 'limit-exceeded', message: `package would exceed ${limits.maxTotalBytes} bytes` };
      artifacts.push({ name: artifact.name, size, sha256: await sha256File(artifact.filePath), required: PORTABLE_ARTIFACT_ALLOWLIST[artifact.name].required });
    }

    const manifest: PortableIndexManifestV1 = {
      format: PORTABLE_INDEX_FORMAT,
      formatVersion: PORTABLE_INDEX_FORMAT_VERSION,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      descriptor,
      repositoryIdentity: descriptor.repositoryIdentity,
      producer: { codeIntelVersion: codeIntelPackageVersion(), analyzer: computeAnalyzerFingerprints() },
      privacyProfile: profile,
      ...(profile === 'metadata-only' ? { privacyTransformVersion: METADATA_ONLY_TRANSFORM_VERSION } : {}),
      capabilities,
      artifacts,
    };
    const manifestBytes = serializeManifest(manifest);
    if (manifestBytes.length > limits.maxManifestBytes) return { status: 'failed', code: 'limit-exceeded', message: 'manifest exceeds its size limit' };

    // Write beside the target and rename: a crash never leaves a partial package at outputPath.
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const tmp = `${outputPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      await writePortableArchive(tmp, [
        { name: PORTABLE_MANIFEST_NAME, data: manifestBytes, size: manifestBytes.length },
        ...planned.map((artifact, i) => ({ name: artifact.name, filePath: artifact.filePath, size: artifacts[i]!.size })),
      ]);
      // Re-check hashes after packaging: the pin prevents eviction, not an external writer.
      for (let i = 0; i < planned.length; i += 1) {
        if (await sha256File(planned[i]!.filePath) !== artifacts[i]!.sha256) throw new Error(`${planned[i]!.name} changed while packaging`);
      }
      fs.renameSync(tmp, outputPath);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return {
      status: 'exported',
      outputPath,
      manifest,
      packageSha256: await sha256File(outputPath),
      packageBytes: fs.statSync(outputPath).size,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return { status: 'failed', code: 'export-failed', message: error instanceof Error ? error.message : String(error) };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    view.release();
  }
}

// ─── Import ──────────────────────────────────────────────────────────────────

export interface ImportPortableIndexRequest {
  repoDir: string;
  packagePath: string;
  /** Protect the imported snapshot from cache eviction. */
  pin?: boolean;
  /** SHA-256 of the whole package obtained out of band (CI artifact digest, release note…). */
  expectedSha256?: string;
  limits?: PortableLimits;
}

export type ImportRejectionCode =
  | 'package-unreadable'
  | 'package-digest-mismatch'
  | 'repository-mismatch'
  | 'incompatible-analyzer'
  | 'git-tree-mismatch'
  | 'privacy-violation'
  | 'readback-failed'
  | 'publish-failed'
  | PortableFormatError['code'];

export type ImportPortableIndexResult =
  | {
    status: 'imported' | 'already-present';
    snapshotId: string;
    manifest: PortableIndexManifestV1;
    pinned: boolean;
    warnings: string[];
    durationMs: number;
  }
  | { status: 'rejected'; code: ImportRejectionCode; message: string; remediation?: string };

const ANALYZER_FIELDS: (keyof AnalyzerFingerprints)[] = [
  'parserFingerprint', 'factSchemaFingerprint', 'identityFingerprint', 'resolverFingerprint',
  'graphSchemaFingerprint', 'contractFingerprint', 'flowIdentityFingerprint',
];

function reject(code: ImportRejectionCode, message: string, remediation?: string): ImportPortableIndexResult {
  return { status: 'rejected', code, message, ...(remediation ? { remediation } : {}) };
}

export async function importPortableIndex(request: ImportPortableIndexRequest): Promise<ImportPortableIndexResult> {
  const startedAt = Date.now();
  const limits = request.limits ?? DEFAULT_PORTABLE_LIMITS;
  const repoDir = path.resolve(request.repoDir);
  const packagePath = path.resolve(request.packagePath);
  const warnings: string[] = [];

  let stat: fs.Stats;
  try {
    stat = fs.statSync(packagePath);
  } catch (error) {
    return reject('package-unreadable', `cannot read ${packagePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) return reject('package-unreadable', `${packagePath} is not a regular file`);
  // Compressed input can only be smaller than its payload; anything larger than the payload cap is rejected unread.
  if (stat.size > limits.maxTotalBytes + limits.maxManifestBytes) return reject('limit-exceeded', `package is ${stat.size} bytes (limit ${limits.maxTotalBytes})`);

  if (request.expectedSha256 !== undefined) {
    const expected = request.expectedSha256.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) return reject('package-digest-mismatch', 'expected digest must be a sha256 hex string');
    const actual = await sha256File(packagePath);
    if (actual !== expected) return reject('package-digest-mismatch', `package digest ${actual} does not match the expected ${expected}`);
  }

  let localIdentity: string;
  try {
    localIdentity = resolveRepositoryIdentity(repoDir);
  } catch (error) {
    return reject('repository-mismatch', `cannot resolve the target repository identity: ${error instanceof Error ? error.message : String(error)}`);
  }

  const stagingDir = getSnapshotStagingDir(repoDir, `import-${crypto.randomUUID()}`);
  fs.mkdirSync(path.dirname(stagingDir), { recursive: true });
  fs.mkdirSync(stagingDir);
  let published = false;
  try {
    let manifest: PortableIndexManifestV1;
    try {
      ({ manifest } = await extractPortablePackage(packagePath, stagingDir, limits));
    } catch (error) {
      if (error instanceof PortableFormatError) return reject(error.code, error.message);
      throw error;
    }
    // Defense in depth: only allowlisted, regular files may exist in staging.
    for (const entry of fs.readdirSync(stagingDir, { withFileTypes: true })) {
      if (!entry.isFile() || !isPortableArtifactName(entry.name)) return reject('unsafe-entry', `unexpected staging entry ${entry.name}`);
    }

    const descriptor = manifest.descriptor;
    if (descriptor.repositoryIdentity !== localIdentity) {
      return reject('repository-mismatch', `package belongs to ${JSON.stringify(descriptor.repositoryIdentity)}, not this repository (${JSON.stringify(localIdentity)})`,
        'Import into a clone of the same repository (same `origin` URL). Repository remapping is not supported.');
    }

    // Both the producer's analyzer and the descriptor's fingerprints must equal this installation's;
    // otherwise the snapshot ID a local ref resolves to would never match the imported entry anyway.
    const local = computeAnalyzerFingerprints();
    const descriptorFields = descriptor as unknown as Record<string, string | undefined>;
    const mismatched = ANALYZER_FIELDS.filter((field) => manifest.producer.analyzer[field] !== local[field]
      || (descriptorFields[field] ?? local[field]) !== local[field]);
    if (mismatched.length > 0) {
      return reject('incompatible-analyzer', `package was produced by an incompatible analyzer (${mismatched.join(', ')} differ; producer ${manifest.producer.codeIntelVersion}, local ${codeIntelPackageVersion()})`,
        'Install the code-intel version that produced the package, or re-export it with this version.');
    }

    if (descriptor.commit) {
      try {
        const resolved = resolveGitRef(repoDir, descriptor.commit);
        if (resolved.tree !== descriptor.gitTree) {
          return reject('git-tree-mismatch', `commit ${descriptor.commit} has tree ${resolved.tree} locally, but the package declares ${descriptor.gitTree}`);
        }
      } catch (error) {
        if (!(error instanceof GitMaterializationError)) throw error;
        warnings.push(`commit ${descriptor.commit} is not available locally; fetch it to query this snapshot by ref`);
      }
    }

    let metadata: IndexMetadata;
    try {
      metadata = JSON.parse(fs.readFileSync(path.join(stagingDir, 'meta.json'), 'utf8')) as IndexMetadata;
    } catch {
      return reject('readback-failed', 'meta.json is not valid JSON');
    }

    if (manifest.privacyProfile === 'metadata-only') {
      // Enforce the declared profile on the bytes actually received.
      const graph = await loadGraphSnapshotFromDbPath(path.join(stagingDir, 'graph.db'));
      const leaked = findSourceContent(graph);
      if (leaked) return reject('privacy-violation', `package declares metadata-only but carries source text (${leaked})`);
      if (manifest.capabilities.bm25 && !bm25HasNoSnippets(path.join(stagingDir, 'bm25.db'))) {
        return reject('privacy-violation', 'package declares metadata-only but its BM25 index carries snippets');
      }
    }

    let verification: Awaited<ReturnType<typeof verifySnapshotReadBack>>;
    try {
      verification = await verifySnapshotReadBack(stagingDir, metadata, manifest.capabilities);
    } catch (error) {
      return reject('readback-failed', `artifact read-back failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!verification.ok) return reject('readback-failed', verification.reason);

    fs.writeFileSync(path.join(stagingDir, SNAPSHOT_CAPABILITIES_FILE), `${JSON.stringify(manifest.capabilities, null, 2)}\n`, { flag: 'wx', mode: 0o644 });

    let outcome: Awaited<ReturnType<typeof publishSnapshotEntry>>;
    try {
      outcome = await publishSnapshotEntry(repoDir, stagingDir, { ...descriptor, createdAt: new Date().toISOString() });
    } catch (error) {
      return reject('publish-failed', error instanceof Error ? error.message : String(error));
    }
    published = true;
    if (outcome === 'already-present') warnings.push('an equivalent snapshot was already cached; it was kept');
    if (request.pin) pinSnapshot(repoDir, descriptor.snapshotId, `import ${path.basename(packagePath)}`);
    return {
      status: outcome === 'published' ? 'imported' : 'already-present',
      snapshotId: descriptor.snapshotId,
      manifest,
      pinned: isSnapshotPinned(repoDir, descriptor.snapshotId),
      warnings,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (!published) fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

// ─── Listing / local lifecycle ───────────────────────────────────────────────

export interface IndexRefEntry extends SnapshotEntrySummary {
  /** Local branches/tags whose current commit maps to this snapshot. */
  refs: string[];
}

const MAX_LISTED_REFS = 200;

/** Snapshot cache entries plus the local branches/tags that currently resolve to each. */
export function listIndexRefs(repoDir: string): IndexRefEntry[] {
  const entries = listSnapshotEntries(repoDir);
  const byId = new Map(entries.map((entry) => [entry.snapshotId, [] as string[]]));
  let refNames: string[] = [];
  try {
    refNames = resolveLocalRefNames(repoDir).slice(0, MAX_LISTED_REFS);
  } catch {
    refNames = [];
  }
  for (const ref of refNames) {
    const resolution = resolveSnapshotDescriptor(repoDir, ref);
    if ('error' in resolution) continue;
    byId.get(resolution.descriptor.snapshotId)?.push(ref);
  }
  return entries.map((entry) => ({ ...entry, refs: (byId.get(entry.snapshotId) ?? []).sort() }));
}

function resolveLocalRefNames(repoDir: string): string[] {
  // Read-only plumbing; ref names are passed back to Git only as argv elements.
  const out = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/tags'], { cwd: repoDir, encoding: 'utf8' });
  return out.split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('-')).sort();
}

/**
 * Resolves a user-supplied selector (full snapshot ID, unique ≥8-char prefix of a
 * cached snapshot ID, or a Git ref) to a snapshot ID.
 */
export function resolveSnapshotSelector(repoDir: string, selector: string): { snapshotId: string } | { error: string } {
  const value = selector.trim();
  if (/^[0-9a-f]{8,64}$/.test(value)) {
    const matches = listSnapshotEntries(repoDir).filter((entry) => entry.snapshotId.startsWith(value));
    if (matches.length === 1) return { snapshotId: matches[0]!.snapshotId };
    if (matches.length > 1) return { error: `snapshot prefix ${value} is ambiguous` };
  }
  const resolution = resolveSnapshotDescriptor(repoDir, value);
  if ('error' in resolution) return { error: resolution.error.message };
  return { snapshotId: resolution.descriptor.snapshotId };
}

export function pinIndex(repoDir: string, selector: string): { snapshotId: string; pinned: true } | { error: string } {
  const resolved = resolveSnapshotSelector(repoDir, selector);
  if ('error' in resolved) return resolved;
  if (!listSnapshotEntries(repoDir).some((entry) => entry.snapshotId === resolved.snapshotId)) {
    return { error: `no cached snapshot for ${selector}; query or import it first` };
  }
  pinSnapshot(repoDir, resolved.snapshotId, 'manual');
  return { snapshotId: resolved.snapshotId, pinned: true };
}

export function unpinIndex(repoDir: string, selector: string): { snapshotId: string; wasPinned: boolean } | { error: string } {
  const resolved = resolveSnapshotSelector(repoDir, selector);
  if ('error' in resolved) return resolved;
  return { snapshotId: resolved.snapshotId, wasPinned: unpinSnapshot(repoDir, resolved.snapshotId) };
}

export function removeIndex(repoDir: string, selector: string): { snapshotId: string; result: RemoveSnapshotResult } | { error: string } {
  const resolved = resolveSnapshotSelector(repoDir, selector);
  if ('error' in resolved) return resolved;
  return { snapshotId: resolved.snapshotId, result: removeSnapshotEntry(repoDir, resolved.snapshotId) };
}
