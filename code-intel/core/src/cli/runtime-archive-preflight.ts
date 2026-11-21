/**
 * Pre-extraction safety check for runtime `.tar.gz` archives.
 *
 * Reads tar headers from the gzip stream (file data is skipped, never written)
 * and rejects anything `tar -x` could use to write outside the extraction root:
 * absolute or `..` paths, links that resolve outside the single top-level
 * directory, entries nested under a symlink, device/FIFO/unknown entry types,
 * and archives over the entry-count or size bounds.
 *
 * This proves filesystem safety only. It says nothing about who published the
 * archive; see runtime-trust.ts for authenticity.
 *
 * Dependency-free (node: built-ins only) so the bootstrap installer
 * `scripts/distribution/install/install-runtime.mjs` can import the compiled file.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ArchivePreflightLimits {
  maxEntries: number;
  maxPathLength: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxMetaBytes: number;
}

export const DEFAULT_ARCHIVE_PREFLIGHT_LIMITS: ArchivePreflightLimits = {
  maxEntries: 250_000,
  maxPathLength: 4096,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxTotalBytes: 6 * 1024 * 1024 * 1024,
  maxMetaBytes: 64 * 1024,
};

export interface ArchivePreflightResult {
  topLevel: string;
  entries: number;
  totalBytes: number;
  symlinks: number;
}

export class ArchivePreflightError extends Error {
  constructor(message: string) {
    super(`ARCHIVE_UNSAFE: ${message}`);
    this.name = 'ArchivePreflightError';
  }
}

const BLOCK = 512;
// '0' / '\0' regular, '7' contiguous, '5' directory, '1' hard link, '2' symlink.
const ENTRY_TYPES = new Set(['0', '7', '5', '1', '2']);
// GNU long name / long link, POSIX per-entry and global extended headers.
const META_TYPES = new Set(['L', 'K', 'x', 'g']);

function cstring(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function readSize(block: Buffer): number {
  if (block[124] & 0x80) {
    // GNU base-256: big-endian magnitude in the remaining 11 bytes.
    let value = 0;
    for (let i = 125; i < 136; i++) value = value * 256 + block[i];
    return value;
  }
  const text = cstring(block, 124, 12).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new ArchivePreflightError('corrupt header size field');
  return parseInt(text, 8);
}

function checksumMatches(block: Buffer): boolean {
  const text = cstring(block, 148, 8).trim();
  if (!/^[0-7]+$/.test(text)) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  return sum === parseInt(text, 8);
}

function parsePax(data: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(data.toString('utf8', offset, space));
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > data.length) {
      throw new ArchivePreflightError('corrupt pax header');
    }
    const record = data.toString('utf8', space + 1, offset + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    offset += length;
  }
  return out;
}

/** Normalize an archive member path; throws when it is absolute or escapes upward. */
function normalizeMember(raw: string, limits: ArchivePreflightLimits): string {
  if (raw.length === 0) throw new ArchivePreflightError('empty entry name');
  if (raw.length > limits.maxPathLength) throw new ArchivePreflightError(`entry name exceeds ${limits.maxPathLength} characters`);
  if (raw.includes('\0') || raw.includes('\\')) throw new ArchivePreflightError(`entry name contains a forbidden character: ${JSON.stringify(raw.slice(0, 120))}`);
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new ArchivePreflightError(`absolute entry path: ${raw.slice(0, 120)}`);
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..')) throw new ArchivePreflightError(`parent traversal in entry path: ${raw.slice(0, 120)}`);
  if (segments.length === 0) throw new ArchivePreflightError(`entry path resolves to the archive root: ${raw.slice(0, 120)}`);
  return segments.join('/');
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

const MAX_LINK_HOPS = 40;

/**
 * Resolve a symlink target the way the filesystem will after extraction:
 * any segment that names another archive symlink is replaced by that link's
 * target. Throws when resolution ever leaves the top-level directory.
 */
function resolveArchiveLink(name: string, symlinks: Map<string, string>, topLevel: string): void {
  const stack = name.split('/').slice(0, -1);
  const pending = symlinks.get(name)!.split('/').reverse();
  let hops = 0;
  while (pending.length > 0) {
    const segment = pending.pop()!;
    if (segment === '' || segment === '.') continue;
    if (segment === '..') stack.pop();
    else stack.push(segment);
    if (stack.length === 0 || stack[0] !== topLevel) throw new ArchivePreflightError(`symlink ${name} escapes the archive root`);
    const target = symlinks.get(stack.join('/'));
    if (target === undefined) continue;
    if (++hops > MAX_LINK_HOPS) throw new ArchivePreflightError(`symlink ${name} has too many levels of links`);
    stack.pop();
    for (const next of target.split('/').reverse()) pending.push(next);
  }
}

export async function preflightRuntimeArchive(
  archivePath: string,
  limits: ArchivePreflightLimits = DEFAULT_ARCHIVE_PREFLIGHT_LIMITS,
): Promise<ArchivePreflightResult> {
  const names = new Set<string>();
  const regularFiles = new Set<string>();
  const symlinks = new Map<string, string>();
  let topLevel: string | null = null;
  let entries = 0;
  let totalBytes = 0;
  let ended = false;

  let pendingName: string | null = null;
  let pendingLink: string | null = null;
  let pendingPax: Map<string, string> | null = null;

  let buffer: Buffer = Buffer.alloc(0);
  let skip = 0;
  let meta: { type: string; size: number; padded: number } | null = null;

  const padded = (size: number) => Math.ceil(size / BLOCK) * BLOCK;

  const acceptEntry = (type: string, rawName: string, rawLink: string, size: number) => {
    entries++;
    if (entries > limits.maxEntries) throw new ArchivePreflightError(`more than ${limits.maxEntries} entries`);
    if (!ENTRY_TYPES.has(type)) throw new ArchivePreflightError(`unsupported entry type '${type}' for ${rawName.slice(0, 120)}`);
    if (size > limits.maxEntryBytes) throw new ArchivePreflightError(`entry ${rawName.slice(0, 120)} exceeds ${limits.maxEntryBytes} bytes`);
    totalBytes += size;
    if (totalBytes > limits.maxTotalBytes) throw new ArchivePreflightError(`expanded size exceeds ${limits.maxTotalBytes} bytes`);

    const name = normalizeMember(rawName, limits);
    const first = name.split('/')[0];
    if (topLevel === null) topLevel = first;
    else if (first !== topLevel) throw new ArchivePreflightError(`archive has more than one top-level directory (${topLevel}, ${first})`);
    names.add(name);

    if (type === '2') {
      if (!rawLink || rawLink.includes('\0') || rawLink.includes('\\') || rawLink.startsWith('/')) {
        throw new ArchivePreflightError(`unsafe symlink target for ${name}`);
      }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), rawLink));
      if (resolved.startsWith('..') || !within(topLevel, resolved)) {
        throw new ArchivePreflightError(`symlink ${name} escapes the archive root`);
      }
      symlinks.set(name, rawLink);
    } else if (type === '1') {
      const target = normalizeMember(rawLink, limits);
      if (!within(topLevel, target) || !regularFiles.has(target)) {
        throw new ArchivePreflightError(`hard link ${name} does not point at an earlier regular file in the archive`);
      }
    } else if (type !== '5') {
      regularFiles.add(name);
    }
  };

  const consumeHeader = (block: Buffer) => {
    if (block.every((byte) => byte === 0)) {
      ended = true;
      return;
    }
    if (ended) throw new ArchivePreflightError('data after end-of-archive marker');
    if (!checksumMatches(block)) throw new ArchivePreflightError('corrupt tar header checksum');
    const size = readSize(block);
    const typeByte = String.fromCharCode(block[156]);
    const type = typeByte === '\0' ? '0' : typeByte;
    if (META_TYPES.has(type)) {
      if (size > limits.maxMetaBytes) throw new ArchivePreflightError(`extended header exceeds ${limits.maxMetaBytes} bytes`);
      meta = { type, size, padded: padded(size) };
      return;
    }
    const magic = block.toString('latin1', 257, 263);
    const prefix = magic === 'ustar\0' ? cstring(block, 345, 155) : '';
    const headerName = prefix ? `${prefix}/${cstring(block, 0, 100)}` : cstring(block, 0, 100);
    const name = pendingPax?.get('path') ?? pendingName ?? headerName;
    const link = pendingPax?.get('linkpath') ?? pendingLink ?? cstring(block, 157, 100);
    const paxSize = pendingPax?.get('size');
    const entrySize = paxSize !== undefined ? Number(paxSize) : size;
    if (!Number.isSafeInteger(entrySize) || entrySize < 0) throw new ArchivePreflightError('corrupt pax size');
    pendingName = null;
    pendingLink = null;
    pendingPax = null;
    acceptEntry(type, name, link, type === '0' || type === '7' ? entrySize : 0);
    skip = type === '0' || type === '7' ? padded(entrySize) : padded(size);
  };

  const consumeMeta = (type: string, data: Buffer) => {
    if (type === 'L') pendingName = cstring(data, 0, data.length);
    else if (type === 'K') pendingLink = cstring(data, 0, data.length);
    else if (type === 'x') pendingPax = parsePax(data);
    else {
      const global = parsePax(data);
      if (global.has('path') || global.has('linkpath')) throw new ArchivePreflightError('global pax header overrides entry paths');
    }
  };

  const stream = fs.createReadStream(archivePath).pipe(zlib.createGunzip());
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      for (;;) {
        if (skip > 0) {
          const n = Math.min(skip, buffer.length);
          skip -= n;
          buffer = buffer.subarray(n);
          if (skip > 0) break;
        }
        if (meta) {
          const pending: { type: string; size: number; padded: number } = meta;
          if (buffer.length < pending.padded) break;
          consumeMeta(pending.type, buffer.subarray(0, pending.size));
          buffer = buffer.subarray(pending.padded);
          meta = null;
          continue;
        }
        if (buffer.length < BLOCK) break;
        const block = buffer.subarray(0, BLOCK);
        buffer = buffer.subarray(BLOCK);
        consumeHeader(block);
      }
    }
  } catch (error) {
    if (error instanceof ArchivePreflightError) throw error;
    throw new ArchivePreflightError(`archive could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!ended && entries === 0) throw new ArchivePreflightError('archive is empty or truncated');
  if (skip > 0 || meta) throw new ArchivePreflightError('archive is truncated');
  if (topLevel === null) throw new ArchivePreflightError('archive has no entries');

  // An entry nested under a symlink would be written through the link at
  // extraction time, so a link that is safe on its own can still redirect it.
  for (const name of names) {
    let slash = name.indexOf('/');
    while (slash !== -1) {
      if (symlinks.has(name.slice(0, slash))) throw new ArchivePreflightError(`entry ${name.slice(0, 120)} is nested under symlink ${name.slice(0, slash)}`);
      slash = name.indexOf('/', slash + 1);
    }
  }

  // The per-entry check above is lexical. A target that passes through another
  // archive symlink (`a/b/l1 -> ../..`, then `l2 -> a/b/l1/../..`) resolves
  // through that link on disk, so re-check every target against the archive's links.
  for (const name of symlinks.keys()) resolveArchiveLink(name, symlinks, topLevel);

  return { topLevel, entries, totalBytes, symlinks: symlinks.size };
}
