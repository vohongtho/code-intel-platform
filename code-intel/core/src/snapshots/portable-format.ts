/**
 * portable-format.ts — the `.cidx` portable index package.
 *
 * A package is a gzip-compressed POSIX ustar archive with a flat, allowlisted
 * layout: `manifest.json` first, then each artifact under its own bare name in
 * sorted order. Writing is deterministic (fixed mtime/mode/owner, sorted entries,
 * no timestamps in the manifest), so the same snapshot exports to the same bytes.
 *
 * Reading treats the package as untrusted input:
 *  - only regular-file entries with allowlisted bare names are accepted (no
 *    directories, symlinks, hard links, pax/GNU extensions, prefixes or separators),
 *    so no entry can address a path outside the staging directory;
 *  - header checksums, entry count, per-entry size and total decompressed size are
 *    bounded before any byte is written (this also caps decompression bombs);
 *  - the manifest is schema-validated and its descriptor's content-derived ID is
 *    recomputed before any artifact is accepted;
 *  - every artifact is streamed to an exclusive-create file while hashed, and its
 *    size and SHA-256 must match the manifest before the importer opens it.
 *
 * Hashes prove the artifacts match the manifest, not who produced the package.
 * Callers that need producer authenticity pin the package digest obtained out of
 * band (`expectedSha256` in export-import.ts).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';
import { computeSnapshotId, type AnalyzerFingerprints } from './fingerprint.js';
import {
  SNAPSHOT_SCHEMA_VERSION,
  type PortablePrivacyProfile,
  type SemanticSnapshotDescriptor,
  type SnapshotCapabilities,
} from './types.js';

export const PORTABLE_INDEX_FORMAT = 'code-intel-portable-index';
export const PORTABLE_INDEX_FORMAT_VERSION = 1;
export const PORTABLE_MANIFEST_NAME = 'manifest.json';
export const PORTABLE_INDEX_EXTENSION = '.cidx';

/** Artifacts a package may carry. Anything else in an archive is rejected. */
export const PORTABLE_ARTIFACT_ALLOWLIST = Object.freeze({
  'graph.db': { required: true },
  'meta.json': { required: true },
  'bm25.db': { required: false },
  'vector.db': { required: false },
  'evidence.db': { required: false },
  'content-fingerprints.json': { required: false },
  'protocol-contracts.json': { required: false },
});
export type PortableArtifactName = keyof typeof PORTABLE_ARTIFACT_ALLOWLIST;

export function isPortableArtifactName(name: string): name is PortableArtifactName {
  return Object.hasOwn(PORTABLE_ARTIFACT_ALLOWLIST, name);
}

export interface PortableArtifactEntry {
  name: PortableArtifactName;
  size: number;
  sha256: string;
  required: boolean;
}

export interface PortableIndexManifestV1 {
  format: typeof PORTABLE_INDEX_FORMAT;
  formatVersion: 1;
  snapshotSchemaVersion: number;
  /** `createdAt` is normalized to the epoch: it is not part of snapshot identity and would break determinism. */
  descriptor: SemanticSnapshotDescriptor;
  repositoryIdentity: string;
  producer: {
    codeIntelVersion: string;
    analyzer: AnalyzerFingerprints;
  };
  privacyProfile: PortablePrivacyProfile;
  /** Version of the content-stripping transform; present only for `metadata-only`. */
  privacyTransformVersion?: number;
  capabilities: SnapshotCapabilities;
  /** Sorted by name. */
  artifacts: PortableArtifactEntry[];
}

export interface PortableLimits {
  maxManifestBytes: number;
  /** Including the manifest entry. */
  maxEntries: number;
  maxArtifactBytes: number;
  /** Sum of all entry payloads (decompressed). */
  maxTotalBytes: number;
}

export const DEFAULT_PORTABLE_LIMITS: PortableLimits = Object.freeze({
  maxManifestBytes: 1024 * 1024,
  maxEntries: Object.keys(PORTABLE_ARTIFACT_ALLOWLIST).length + 1,
  maxArtifactBytes: 2 * 1024 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
});

export const EPOCH_ISO = new Date(0).toISOString();

export class PortableFormatError extends Error {
  constructor(readonly code: PortableErrorCode, message: string) {
    super(message);
    this.name = 'PortableFormatError';
  }
}

export type PortableErrorCode =
  | 'malformed-archive'
  | 'unsafe-entry'
  | 'limit-exceeded'
  | 'invalid-manifest'
  | 'hash-mismatch'
  | 'size-mismatch'
  | 'missing-artifact'
  | 'unexpected-artifact';

// ─── Manifest validation ─────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;
const DESCRIPTOR_STRING_FIELDS = [
  'snapshotId', 'repositoryIdentity', 'gitTree', 'parserFingerprint', 'factSchemaFingerprint',
  'identityFingerprint', 'resolverFingerprint', 'graphSchemaFingerprint', 'flowIdentityFingerprint',
] as const;
const ANALYZER_FIELDS = [
  'parserFingerprint', 'factSchemaFingerprint', 'identityFingerprint', 'resolverFingerprint',
  'graphSchemaFingerprint', 'contractFingerprint', 'flowIdentityFingerprint',
] as const;
const MAX_STRING = 4096;

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING && !value.includes('\0');
}

function fail(reason: string): never {
  throw new PortableFormatError('invalid-manifest', reason);
}

/**
 * Structural + integrity validation of an untrusted manifest. Repository identity
 * and analyzer compatibility against the *local* installation are checked by the
 * importer, which knows the target repository.
 */
export function validatePortableManifest(raw: unknown, limits: PortableLimits = DEFAULT_PORTABLE_LIMITS): PortableIndexManifestV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('manifest must be a JSON object');
  const m = raw as Record<string, unknown>;
  if (m.format !== PORTABLE_INDEX_FORMAT) fail(`unsupported package format ${JSON.stringify(m.format)}`);
  if (m.formatVersion !== PORTABLE_INDEX_FORMAT_VERSION) fail(`unsupported package format version ${JSON.stringify(m.formatVersion)}; this build reads version ${PORTABLE_INDEX_FORMAT_VERSION}`);
  if (m.snapshotSchemaVersion !== SNAPSHOT_SCHEMA_VERSION) fail(`snapshot schema version ${JSON.stringify(m.snapshotSchemaVersion)} is not supported (expected ${SNAPSHOT_SCHEMA_VERSION}); re-export with a matching code-intel version`);

  const d = m.descriptor as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object' || Array.isArray(d)) fail('descriptor missing');
  for (const field of DESCRIPTOR_STRING_FIELDS) if (!isBoundedString(d[field])) fail(`descriptor.${field} invalid`);
  for (const field of ['commit', 'contractFingerprint'] as const) if (d[field] !== undefined && !isBoundedString(d[field])) fail(`descriptor.${field} invalid`);
  if (d.dirtyStateFingerprint !== undefined) fail('working-tree snapshots cannot be packaged');
  if (!HEX64.test(d.snapshotId as string)) fail('descriptor.snapshotId must be a sha256 hex digest');
  const descriptor = { ...(d as unknown as SemanticSnapshotDescriptor), createdAt: EPOCH_ISO };
  const identityFields: Partial<SemanticSnapshotDescriptor> = { ...descriptor };
  delete identityFields.snapshotId;
  delete identityFields.createdAt;
  if (computeSnapshotId(identityFields as Parameters<typeof computeSnapshotId>[0]) !== descriptor.snapshotId) fail('descriptor.snapshotId does not match its fields');
  if (m.repositoryIdentity !== descriptor.repositoryIdentity) fail('repositoryIdentity does not match descriptor');

  const producer = m.producer as Record<string, unknown> | undefined;
  const analyzer = producer?.analyzer as Record<string, unknown> | undefined;
  if (!producer || !isBoundedString(producer.codeIntelVersion) || !analyzer) fail('producer missing');
  for (const field of ANALYZER_FIELDS) if (!isBoundedString(analyzer[field])) fail(`producer.analyzer.${field} invalid`);

  const profile = m.privacyProfile;
  if (profile !== 'full' && profile !== 'metadata-only') fail(`unknown privacy profile ${JSON.stringify(profile)}`);
  if (profile === 'metadata-only' && (typeof m.privacyTransformVersion !== 'number' || !Number.isInteger(m.privacyTransformVersion))) {
    fail('metadata-only packages must declare privacyTransformVersion');
  }

  const c = m.capabilities as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') fail('capabilities missing');
  for (const key of ['sourceContent', 'bm25', 'vector', 'evidence', 'protocolContracts'] as const) {
    if (typeof c[key] !== 'boolean') fail(`capabilities.${key} must be boolean`);
  }
  if (!['full', 'names-only', 'none'].includes(c.bm25Content as string)) fail('capabilities.bm25Content invalid');
  if (c.privacyProfile !== profile) fail('capabilities.privacyProfile does not match privacyProfile');

  if (!Array.isArray(m.artifacts)) fail('artifacts must be an array');
  if (m.artifacts.length + 1 > limits.maxEntries) throw new PortableFormatError('limit-exceeded', `package declares ${m.artifacts.length} artifacts (limit ${limits.maxEntries - 1})`);
  const seen = new Set<string>();
  let total = 0;
  let previous = '';
  const artifacts: PortableArtifactEntry[] = [];
  for (const entry of m.artifacts as unknown[]) {
    const a = entry as Record<string, unknown>;
    if (!a || typeof a !== 'object' || typeof a.name !== 'string' || !isPortableArtifactName(a.name)) {
      throw new PortableFormatError('unexpected-artifact', `artifact ${JSON.stringify(a?.name)} is not allowlisted`);
    }
    if (seen.has(a.name)) fail(`duplicate artifact ${a.name}`);
    if (a.name <= previous) fail('artifacts must be sorted by name');
    previous = a.name;
    seen.add(a.name);
    if (typeof a.size !== 'number' || !Number.isSafeInteger(a.size) || a.size < 0) fail(`artifact ${a.name} size invalid`);
    if (a.size > limits.maxArtifactBytes) throw new PortableFormatError('limit-exceeded', `artifact ${a.name} is ${a.size} bytes (limit ${limits.maxArtifactBytes})`);
    total += a.size;
    if (total > limits.maxTotalBytes) throw new PortableFormatError('limit-exceeded', `package artifacts total more than ${limits.maxTotalBytes} bytes`);
    if (typeof a.sha256 !== 'string' || !HEX64.test(a.sha256)) fail(`artifact ${a.name} sha256 invalid`);
    const required = PORTABLE_ARTIFACT_ALLOWLIST[a.name].required;
    if (a.required !== required) fail(`artifact ${a.name} required flag must be ${required}`);
    artifacts.push({ name: a.name, size: a.size, sha256: a.sha256, required });
  }
  for (const [name, spec] of Object.entries(PORTABLE_ARTIFACT_ALLOWLIST)) {
    if (spec.required && !seen.has(name)) throw new PortableFormatError('missing-artifact', `required artifact ${name} is missing`);
  }

  // Declared capabilities must agree with the artifacts actually shipped.
  const has = (name: PortableArtifactName) => seen.has(name);
  if (c.bm25 !== has('bm25.db')) fail('capabilities.bm25 does not match artifacts');
  if ((c.bm25Content === 'none') !== !has('bm25.db')) fail('capabilities.bm25Content does not match artifacts');
  if (c.vector !== has('vector.db')) fail('capabilities.vector does not match artifacts');
  if (c.evidence !== has('evidence.db')) fail('capabilities.evidence does not match artifacts');
  if (c.protocolContracts !== has('protocol-contracts.json')) fail('capabilities.protocolContracts does not match artifacts');
  if (profile === 'metadata-only' && (c.sourceContent !== false || c.vector !== false || c.protocolContracts !== false || c.bm25Content === 'full')) {
    fail('metadata-only packages cannot declare source-derived capabilities');
  }
  if (profile === 'full' && c.sourceContent !== true) fail('full packages must declare sourceContent');

  return {
    format: PORTABLE_INDEX_FORMAT,
    formatVersion: PORTABLE_INDEX_FORMAT_VERSION,
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    descriptor,
    repositoryIdentity: descriptor.repositoryIdentity,
    producer: {
      codeIntelVersion: producer.codeIntelVersion as string,
      analyzer: Object.fromEntries(ANALYZER_FIELDS.map((k) => [k, analyzer[k]])) as unknown as AnalyzerFingerprints,
    },
    privacyProfile: profile,
    ...(profile === 'metadata-only' ? { privacyTransformVersion: m.privacyTransformVersion as number } : {}),
    capabilities: {
      privacyProfile: profile,
      sourceContent: c.sourceContent as boolean,
      bm25: c.bm25 as boolean,
      bm25Content: c.bm25Content as SnapshotCapabilities['bm25Content'],
      vector: c.vector as boolean,
      evidence: c.evidence as boolean,
      protocolContracts: c.protocolContracts as boolean,
    },
    artifacts,
  };
}

/** Stable serialization: fixed key order comes from construction in export-import.ts. */
export function serializeManifest(manifest: PortableIndexManifestV1): Buffer {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

// ─── ustar writer ────────────────────────────────────────────────────────────

const BLOCK = 512;

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0');
  if (text.length > length - 1) throw new Error(`value ${value} does not fit in a ${length}-byte tar field`);
  header.write(`${text}\0`, offset, length, 'ascii');
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(BLOCK, 0);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

export interface PortableArchiveEntrySource {
  name: string;
  /** Exactly one of `filePath` / `data`. */
  filePath?: string;
  data?: Buffer;
  size: number;
}

async function* archiveChunks(entries: PortableArchiveEntrySource[]): AsyncGenerator<Buffer> {
  for (const entry of entries) {
    yield tarHeader(entry.name, entry.size);
    let written = 0;
    if (entry.data) {
      yield entry.data;
      written = entry.data.length;
    } else if (entry.filePath) {
      for await (const chunk of fs.createReadStream(entry.filePath)) {
        written += (chunk as Buffer).length;
        yield chunk as Buffer;
      }
    }
    if (written !== entry.size) throw new Error(`${entry.name} changed size while packaging (${written} != ${entry.size})`);
    const pad = (BLOCK - (entry.size % BLOCK)) % BLOCK;
    if (pad > 0) yield Buffer.alloc(pad, 0);
  }
  yield Buffer.alloc(BLOCK * 2, 0);
}

/** Writes entries (caller-ordered) as a deterministic gzip'd ustar stream to `outputPath`. */
export async function writePortableArchive(outputPath: string, entries: PortableArchiveEntrySource[]): Promise<void> {
  const gzip = zlib.createGzip({ level: 6 });
  let first = true;
  // Pin the gzip header OS byte so the same input compresses to the same bytes on every platform.
  const normalizeHeader = new Writable({
    write(chunk: Buffer, _enc, cb) {
      if (first && chunk.length >= 10) {
        chunk = Buffer.from(chunk);
        chunk[9] = 0xff;
        first = false;
      }
      out.write(chunk, cb);
    },
    final(cb) { out.end(cb); },
  });
  const out = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o644 });
  const closed = new Promise<void>((resolve, reject) => { out.on('close', resolve); out.on('error', reject); });
  await pipeline(Readable.from(archiveChunks(entries)), gzip, normalizeHeader);
  await closed;
}

// ─── ustar reader ────────────────────────────────────────────────────────────

function readString(header: Buffer, offset: number, length: number): string {
  const slice = header.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? length : nul).toString('utf8');
}

function readOctal(header: Buffer, offset: number, length: number): number {
  const text = readString(header, offset, length).trim();
  if (!/^[0-7]+$/.test(text)) throw new PortableFormatError('malformed-archive', 'invalid numeric field in tar header');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) throw new PortableFormatError('malformed-archive', 'numeric field out of range');
  return value;
}

function verifyChecksum(header: Buffer): void {
  const expected = readOctal(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  if (sum !== expected) throw new PortableFormatError('malformed-archive', 'tar header checksum mismatch');
}

const ENTRY_TYPE_NAMES: Record<string, string> = {
  '1': 'hard link', '2': 'symlink', '3': 'character device', '4': 'block device', '5': 'directory', '6': 'fifo',
  'x': 'pax header', 'g': 'pax global header', 'L': 'GNU long name', 'K': 'GNU long link',
};

/** Rejects anything but a bare allowlisted file name. */
function assertSafeEntryName(name: string, prefix: string): void {
  if (prefix) throw new PortableFormatError('unsafe-entry', `entry uses a path prefix (${JSON.stringify(prefix)})`);
  if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..' || path.isAbsolute(name)) {
    throw new PortableFormatError('unsafe-entry', `entry name ${JSON.stringify(name)} is not a bare file name`);
  }
  if (name !== PORTABLE_MANIFEST_NAME && !isPortableArtifactName(name)) {
    throw new PortableFormatError('unexpected-artifact', `entry ${JSON.stringify(name)} is not allowlisted`);
  }
}

export interface ExtractedPortablePackage {
  manifest: PortableIndexManifestV1;
  /** Names written into the staging directory (each size/hash verified). */
  extracted: PortableArtifactName[];
}

/**
 * Streams `packagePath` into `stagingDir` (which must exist and be empty). Throws
 * PortableFormatError on any violation; on throw the caller deletes the staging dir.
 */
export async function extractPortablePackage(
  packagePath: string,
  stagingDir: string,
  limits: PortableLimits = DEFAULT_PORTABLE_LIMITS,
): Promise<ExtractedPortablePackage> {
  let buffer: Buffer = Buffer.alloc(0);
  let manifest: PortableIndexManifestV1 | null = null;
  const manifestChunks: Buffer[] = [];
  const extracted: PortableArtifactName[] = [];
  const seen = new Set<string>();
  let entries = 0;
  let totalPayload = 0;
  let ended = false;

  // Current entry state.
  let current: { name: string; remaining: number; padding: number; hash?: crypto.Hash; fd?: number; size: number } | null = null;

  const finishEntry = () => {
    if (!current) return;
    if (current.name === PORTABLE_MANIFEST_NAME) {
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(manifestChunks).toString('utf8'));
      } catch {
        throw new PortableFormatError('invalid-manifest', 'manifest.json is not valid JSON');
      }
      manifest = validatePortableManifest(raw, limits);
    } else {
      fs.closeSync(current.fd!);
      const declared = manifest!.artifacts.find((a) => a.name === current!.name)!;
      const digest = current.hash!.digest('hex');
      if (digest !== declared.sha256) throw new PortableFormatError('hash-mismatch', `${current.name} does not match its manifest hash`);
      extracted.push(current.name as PortableArtifactName);
    }
    current = null;
  };

  const startEntry = (header: Buffer) => {
    verifyChecksum(header);
    const magic = readString(header, 257, 6);
    if (magic !== 'ustar') throw new PortableFormatError('malformed-archive', 'not a ustar archive');
    const type = String.fromCharCode(header[156]!);
    if (type !== '0' && type !== '\0') {
      throw new PortableFormatError('unsafe-entry', `unsupported entry type: ${ENTRY_TYPE_NAMES[type] ?? JSON.stringify(type)}`);
    }
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    assertSafeEntryName(name, prefix);
    if (seen.has(name)) throw new PortableFormatError('unsafe-entry', `duplicate entry ${name}`);
    seen.add(name);
    entries += 1;
    if (entries > limits.maxEntries) throw new PortableFormatError('limit-exceeded', `package has more than ${limits.maxEntries} entries`);
    const size = readOctal(header, 124, 12);
    totalPayload += size;
    if (totalPayload > limits.maxTotalBytes + limits.maxManifestBytes) throw new PortableFormatError('limit-exceeded', `package payload exceeds ${limits.maxTotalBytes} bytes`);

    if (entries === 1) {
      if (name !== PORTABLE_MANIFEST_NAME) throw new PortableFormatError('invalid-manifest', 'manifest.json must be the first entry');
      if (size > limits.maxManifestBytes) throw new PortableFormatError('limit-exceeded', `manifest is ${size} bytes (limit ${limits.maxManifestBytes})`);
      current = { name, remaining: size, padding: (BLOCK - (size % BLOCK)) % BLOCK, size };
      return;
    }
    if (name === PORTABLE_MANIFEST_NAME) throw new PortableFormatError('unsafe-entry', 'duplicate manifest');
    const declared = manifest!.artifacts.find((a) => a.name === name);
    if (!declared) throw new PortableFormatError('unexpected-artifact', `${name} is not declared in the manifest`);
    if (declared.size !== size) throw new PortableFormatError('size-mismatch', `${name} is ${size} bytes but the manifest declares ${declared.size}`);
    // Exclusive create: never follows or overwrites anything already at the target path.
    const fd = fs.openSync(path.join(stagingDir, name), 'wx', 0o600);
    current = { name, remaining: size, padding: (BLOCK - (size % BLOCK)) % BLOCK, hash: crypto.createHash('sha256'), fd, size };
  };

  const consume = (data: Buffer) => {
    buffer = buffer.length === 0 ? data : Buffer.concat([buffer, data]);
    while (!ended) {
      if (current) {
        if (current.remaining > 0) {
          if (buffer.length === 0) return;
          const take = Math.min(current.remaining, buffer.length);
          const piece = buffer.subarray(0, take);
          if (current.name === PORTABLE_MANIFEST_NAME) manifestChunks.push(Buffer.from(piece));
          else {
            current.hash!.update(piece);
            fs.writeSync(current.fd!, piece);
          }
          current.remaining -= take;
          buffer = buffer.subarray(take);
          continue;
        }
        if (buffer.length < current.padding) return;
        buffer = buffer.subarray(current.padding);
        finishEntry();
        continue;
      }
      if (buffer.length < BLOCK) return;
      const header = buffer.subarray(0, BLOCK);
      buffer = buffer.subarray(BLOCK);
      if (header.every((byte) => byte === 0)) {
        ended = true;
        return;
      }
      startEntry(header);
    }
  };

  const decompressedCap = limits.maxTotalBytes + limits.maxManifestBytes + (limits.maxEntries + 4) * BLOCK * 2;
  let decompressed = 0;
  try {
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        try {
          decompressed += chunk.length;
          if (decompressed > decompressedCap) throw new PortableFormatError('limit-exceeded', 'decompressed package exceeds the size limit');
          if (!ended) consume(chunk);
          cb();
        } catch (error) {
          cb(error as Error);
        }
      },
    });
    await pipeline(fs.createReadStream(packagePath), zlib.createGunzip(), sink);
  } catch (error) {
    // `current` is mutated inside the stream callbacks; TS cannot see that and narrows it to null.
    const open = current as { fd?: number } | null;
    if (open?.fd !== undefined) { try { fs.closeSync(open.fd); } catch { /* already closed */ } }
    if (error instanceof PortableFormatError) throw error;
    throw new PortableFormatError('malformed-archive', `package could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  if ((current as unknown) !== null || !ended) throw new PortableFormatError('malformed-archive', 'package is truncated');
  if (!manifest) throw new PortableFormatError('invalid-manifest', 'package has no manifest');
  const finalManifest: PortableIndexManifestV1 = manifest;
  for (const artifact of finalManifest.artifacts) {
    if (!extracted.includes(artifact.name)) throw new PortableFormatError('missing-artifact', `${artifact.name} is declared but missing from the package`);
  }
  return { manifest: finalManifest, extracted };
}
