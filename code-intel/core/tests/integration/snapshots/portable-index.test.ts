/**
 * Portable index packages (.cidx): deterministic export, untrusted import, and
 * the metadata-only privacy profile. Every rejection case also asserts that no
 * cache entry was published and no staging directory was left behind.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

import {
  exportPortableIndex,
  identityHasEmbeddedCredentials,
  importPortableIndex,
  listIndexRefs,
  pinIndex,
  removeIndex,
  unpinIndex,
} from '../../../src/snapshots/export-import.js';
import {
  DEFAULT_PORTABLE_LIMITS,
  extractPortablePackage,
  serializeManifest,
  writePortableArchive,
  type PortableIndexManifestV1,
} from '../../../src/snapshots/portable-format.js';
import { computeSnapshotId } from '../../../src/snapshots/fingerprint.js';
import { stripNode } from '../../../src/snapshots/privacy.js';
import { getSnapshotsRoot } from '../../../src/snapshots/paths.js';
import { listSnapshotEntries } from '../../../src/snapshots/cache.js';
import { resolveReadIndexView, resetIndexViewMemoForTests } from '../../../src/storage/index-view-resolver.js';
import { dispatchTool, resetRepoGraphCacheForTests } from '../../../src/mcp-server/server.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';

type Json = Record<string, any>;
const ORIGIN = 'https://example.com/org/service.git';
const MARKER = 'uniqueBodyMarkerQ7';
/**
 * A body expression. Metadata-only keeps identifier names (a local `const` is a
 * `variable` node), so the marker *name* may legitimately appear; the body text must not.
 */
const BODY = `alphaBase() + ${MARKER}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-index-'));
const SOURCE = path.join(TMP, 'source');
let head = '';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function sha(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function clone(name: string, origin = ORIGIN): string {
  const dir = path.join(TMP, name);
  git(['clone', '--quiet', SOURCE, dir], TMP);
  git(['remote', 'set-url', 'origin', origin], dir);
  return dir;
}

function stagingLeftovers(repoDir: string): string[] {
  const root = getSnapshotsRoot(repoDir);
  return fs.existsSync(root) ? fs.readdirSync(root).filter((name) => name.startsWith('.staging-')) : [];
}

function assertNothingPublished(repoDir: string): void {
  assert.deepEqual(listSnapshotEntries(repoDir), [], 'no cache entry may be published');
  assert.deepEqual(stagingLeftovers(repoDir), [], 'staging must be removed');
}

// ─── crafted archives ────────────────────────────────────────────────────────

interface CraftEntry { name: string; data?: Buffer; type?: string; prefix?: string; linkname?: string; size?: number }

function craftHeader(entry: CraftEntry, size: number): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(entry.name, 0, 100, 'utf8');
  h.write('0000644\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii');
  h.write('0000000\0', 116, 8, 'ascii');
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  h.write('00000000000\0', 136, 12, 'ascii');
  h.fill(0x20, 148, 156);
  h.write(entry.type ?? '0', 156, 1, 'ascii');
  if (entry.linkname) h.write(entry.linkname, 157, 100, 'utf8');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  if (entry.prefix) h.write(entry.prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return h;
}

function craftArchive(file: string, entries: CraftEntry[]): string {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0);
    parts.push(craftHeader(entry, entry.size ?? data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat(parts)));
  return file;
}

/** Unpacks a real package so a test can tamper with it and repack. */
async function unpack(pkg: string): Promise<{ dir: string; manifest: PortableIndexManifestV1 }> {
  const dir = fs.mkdtempSync(path.join(TMP, 'unpacked-'));
  const { manifest } = await extractPortablePackage(pkg, dir);
  return { dir, manifest };
}

async function repack(file: string, dir: string, manifest: PortableIndexManifestV1): Promise<string> {
  const manifestBytes = serializeManifest(manifest);
  fs.rmSync(file, { force: true });
  await writePortableArchive(file, [
    { name: 'manifest.json', data: manifestBytes, size: manifestBytes.length },
    ...manifest.artifacts.map((a) => ({ name: a.name, filePath: path.join(dir, a.name), size: fs.statSync(path.join(dir, a.name)).size })),
  ]);
  return file;
}

let fullPackage = '';
let metadataPackage = '';

before(async () => {
  fs.mkdirSync(SOURCE);
  git(['init', '--quiet'], SOURCE);
  git(['config', 'user.email', 'test@example.com'], SOURCE);
  git(['config', 'user.name', 'Test'], SOURCE);
  git(['remote', 'add', 'origin', ORIGIN], SOURCE);
  fs.writeFileSync(path.join(SOURCE, '.gitignore'), '.code-intel/\n');
  fs.writeFileSync(path.join(SOURCE, 'index.ts'), [
    'export function alphaBase() { return 1; }',
    `export function betaHead() {`,
    `  const ${MARKER} = 42;`,
    `  return alphaBase() + ${MARKER};`,
    '}',
    '',
  ].join('\n'));
  git(['add', '.'], SOURCE);
  git(['commit', '--quiet', '-m', 'head'], SOURCE);
  head = git(['rev-parse', 'HEAD'], SOURCE);

  const full = await exportPortableIndex({ repoDir: SOURCE, ref: head, outputPath: path.join(TMP, 'full.cidx') });
  assert.equal(full.status, 'exported', JSON.stringify(full));
  fullPackage = path.join(TMP, 'full.cidx');
  const meta = await exportPortableIndex({ repoDir: SOURCE, ref: head, outputPath: path.join(TMP, 'meta.cidx'), privacyProfile: 'metadata-only' });
  assert.equal(meta.status, 'exported', JSON.stringify(meta));
  metadataPackage = path.join(TMP, 'meta.cidx');
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('portable export', { timeout: 300_000 }, () => {
  it('is deterministic and declares a bounded, versioned manifest', async () => {
    const again = await exportPortableIndex({ repoDir: SOURCE, ref: 'HEAD', outputPath: fullPackage, overwrite: true });
    assert.equal(again.status, 'exported');
    if (again.status !== 'exported') return;
    const second = await exportPortableIndex({ repoDir: SOURCE, ref: head, outputPath: path.join(TMP, 'full-2.cidx') });
    assert.equal(second.status, 'exported');
    assert.equal(sha(path.join(TMP, 'full-2.cidx')), sha(fullPackage), 'same snapshot ⇒ identical package bytes');

    const m = again.manifest;
    assert.equal(m.format, 'code-intel-portable-index');
    assert.equal(m.formatVersion, 1);
    assert.equal(m.descriptor.createdAt, new Date(0).toISOString());
    assert.equal(m.descriptor.commit, head);
    assert.equal(m.repositoryIdentity, ORIGIN);
    assert.deepEqual(m.artifacts.map((a) => a.name), [...m.artifacts.map((a) => a.name)].sort());
    assert.ok(m.artifacts.some((a) => a.name === 'graph.db' && a.required));
    assert.equal(m.capabilities.sourceContent, true);
    assert.equal(m.capabilities.vector, false, 'on-demand snapshots carry no vectors');
  });

  it('refuses existing output, unknown refs, and identities with embedded credentials', async () => {
    const exists = await exportPortableIndex({ repoDir: SOURCE, ref: head, outputPath: fullPackage });
    assert.equal(exists.status, 'failed');
    const unknown = await exportPortableIndex({ repoDir: SOURCE, ref: 'nope', outputPath: path.join(TMP, 'x.cidx') });
    assert.equal(unknown.status === 'failed' && unknown.code, 'unknown-ref');
    assert.equal(identityHasEmbeddedCredentials('https://user:pw@example.com/r.git'), true);
    assert.equal(identityHasEmbeddedCredentials('https://tokenonly@example.com/r.git'), true);
    assert.equal(identityHasEmbeddedCredentials('ssh://git@example.com/r.git'), false);
    assert.equal(identityHasEmbeddedCredentials('git@example.com:org/r.git'), false);
    assert.equal(identityHasEmbeddedCredentials(ORIGIN), false);
  });
});

describe('portable import', { timeout: 300_000 }, () => {
  it('imports into a clone; the ref is then served from cache without building', async () => {
    const target = clone('clone-ok');
    const result = await importPortableIndex({ repoDir: target, packagePath: fullPackage, pin: true, expectedSha256: sha(fullPackage) });
    if (result.status !== 'imported') assert.fail(JSON.stringify(result));
    assert.equal(result.pinned, true);
    assert.equal(fs.existsSync(path.join(target, '.code-intel', 'current.json')), false, 'import never creates/advances a generation');

    resetIndexViewMemoForTests();
    const view = await resolveReadIndexView({ repoDir: target, ref: 'HEAD', allowBuild: false });
    assert.ok(view.ok, !view.ok ? view.boundary.message : '');
    assert.equal(view.view.resolution, 'cached');
    assert.equal(view.view.identity, result.snapshotId);
    view.view.release();

    const again = await importPortableIndex({ repoDir: target, packagePath: fullPackage });
    assert.equal(again.status, 'already-present');

    const refs = listIndexRefs(target);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.pinned, true);
    assert.ok(refs[0]!.refs.length > 0, 'local branch maps to the imported snapshot');

    assert.ok('snapshotId' in unpinIndex(target, 'HEAD'));
    assert.ok('snapshotId' in pinIndex(target, result.snapshotId.slice(0, 12)));
    const held = await resolveReadIndexView({ repoDir: target, ref: 'HEAD', allowBuild: false });
    assert.ok(held.ok);
    const busy = removeIndex(target, 'HEAD');
    assert.ok('result' in busy && busy.result === 'in-use');
    held.view.release();
    const removed = removeIndex(target, 'HEAD');
    assert.ok('result' in removed && removed.result === 'removed');
    assert.deepEqual(listSnapshotEntries(target), []);
  });

  it('rejects a package from another repository identity', async () => {
    const other = clone('clone-other', 'https://example.com/org/other.git');
    const result = await importPortableIndex({ repoDir: other, packagePath: fullPackage });
    assert.equal(result.status === 'rejected' && result.code, 'repository-mismatch');
    assertNothingPublished(other);
  });

  it('rejects a package whose whole-file digest does not match the pinned digest', async () => {
    const target = clone('clone-digest');
    const result = await importPortableIndex({ repoDir: target, packagePath: fullPackage, expectedSha256: '0'.repeat(64) });
    assert.equal(result.status === 'rejected' && result.code, 'package-digest-mismatch');
    assertNothingPublished(target);
  });

  it('rejects a graph artifact that does not match its manifest hash', async () => {
    const target = clone('clone-tamper');
    const { dir, manifest } = await unpack(fullPackage);
    const graphPath = path.join(dir, 'graph.db');
    const bytes = fs.readFileSync(graphPath);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    fs.writeFileSync(graphPath, bytes);
    const pkg = await repack(path.join(TMP, 'tampered.cidx'), dir, manifest);
    const result = await importPortableIndex({ repoDir: target, packagePath: pkg });
    assert.equal(result.status === 'rejected' && result.code, 'hash-mismatch');
    assertNothingPublished(target);
  });

  it('rejects analyzer fingerprint mismatches with remediation', async () => {
    const target = clone('clone-fingerprint');
    const { dir, manifest } = await unpack(fullPackage);
    const descriptor = { ...manifest.descriptor, parserFingerprint: 'older-parser' };
    const { snapshotId: _s, createdAt: _c, ...fields } = descriptor;
    const forged: PortableIndexManifestV1 = {
      ...manifest,
      descriptor: { ...descriptor, snapshotId: computeSnapshotId(fields) },
      producer: { ...manifest.producer, analyzer: { ...manifest.producer.analyzer, parserFingerprint: 'older-parser' } },
    };
    const pkg = await repack(path.join(TMP, 'old-analyzer.cidx'), dir, forged);
    const result = await importPortableIndex({ repoDir: target, packagePath: pkg });
    assert.equal(result.status === 'rejected' && result.code, 'incompatible-analyzer');
    assert.ok(result.status === 'rejected' && result.remediation);
    assertNothingPublished(target);
  });

  it('rejects a descriptor whose snapshotId does not match its fields', async () => {
    const target = clone('clone-forged-id');
    const { dir, manifest } = await unpack(fullPackage);
    const pkg = await repack(path.join(TMP, 'forged-id.cidx'), dir, { ...manifest, descriptor: { ...manifest.descriptor, gitTree: 'f'.repeat(40) } });
    const result = await importPortableIndex({ repoDir: target, packagePath: pkg });
    assert.equal(result.status === 'rejected' && result.code, 'invalid-manifest');
    assertNothingPublished(target);
  });

  it('rejects path traversal, prefixes, symlinks, hard links and non-allowlisted entries', async () => {
    const target = clone('clone-unsafe');
    const { manifest } = await unpack(fullPackage);
    const m = serializeManifest(manifest);
    const cases: [string, CraftEntry[], string][] = [
      ['traversal', [{ name: 'manifest.json', data: m }, { name: '../graph.db', data: Buffer.from('x') }], 'unsafe-entry'],
      ['absolute', [{ name: 'manifest.json', data: m }, { name: '/tmp/graph.db', data: Buffer.from('x') }], 'unsafe-entry'],
      ['prefix', [{ name: 'manifest.json', data: m }, { name: 'graph.db', prefix: '..', data: Buffer.from('x') }], 'unsafe-entry'],
      ['symlink', [{ name: 'manifest.json', data: m }, { name: 'graph.db', type: '2', linkname: '/etc/passwd' }], 'unsafe-entry'],
      ['hardlink', [{ name: 'manifest.json', data: m }, { name: 'graph.db', type: '1', linkname: 'meta.json' }], 'unsafe-entry'],
      ['directory', [{ name: 'manifest.json', data: m }, { name: 'graph.db', type: '5' }], 'unsafe-entry'],
      ['not allowlisted', [{ name: 'manifest.json', data: m }, { name: 'hook.sh', data: Buffer.from('#!/bin/sh') }], 'unexpected-artifact'],
      ['manifest not first', [{ name: 'graph.db', data: Buffer.from('x') }, { name: 'manifest.json', data: m }], 'invalid-manifest'],
      ['undeclared size', [{ name: 'manifest.json', data: m }, { name: 'bm25.db', data: Buffer.from('short') }], 'size-mismatch'],
      ['truncated', [{ name: 'manifest.json', data: m }], 'missing-artifact'],
    ];
    for (const [label, entries, code] of cases) {
      const pkg = craftArchive(path.join(TMP, `unsafe-${label.replace(/\s+/g, '-')}.cidx`), entries);
      const result = await importPortableIndex({ repoDir: target, packagePath: pkg });
      assert.equal(result.status === 'rejected' && result.code, code, `${label}: ${JSON.stringify(result)}`);
      assertNothingPublished(target);
    }
    assert.equal(fs.existsSync(path.join(TMP, 'graph.db')), false, 'nothing escaped the staging directory');
  });

  it('enforces max-size and max-count limits before writing payloads', async () => {
    const target = clone('clone-limits');
    const small = await importPortableIndex({ repoDir: target, packagePath: fullPackage, limits: { ...DEFAULT_PORTABLE_LIMITS, maxArtifactBytes: 1024 } });
    assert.equal(small.status === 'rejected' && small.code, 'limit-exceeded');
    const count = await importPortableIndex({ repoDir: target, packagePath: fullPackage, limits: { ...DEFAULT_PORTABLE_LIMITS, maxEntries: 2 } });
    assert.equal(count.status === 'rejected' && count.code, 'limit-exceeded');
    const manifestCap = await importPortableIndex({ repoDir: target, packagePath: fullPackage, limits: { ...DEFAULT_PORTABLE_LIMITS, maxManifestBytes: 16 } });
    assert.equal(manifestCap.status === 'rejected' && manifestCap.code, 'limit-exceeded');
    // A decompression bomb: a tiny gzip that expands past the payload cap.
    const bomb = path.join(TMP, 'bomb.cidx');
    fs.writeFileSync(bomb, zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x41)));
    const bombed = await importPortableIndex({ repoDir: target, packagePath: bomb, limits: { ...DEFAULT_PORTABLE_LIMITS, maxTotalBytes: 1024 * 1024 } });
    assert.equal(bombed.status, 'rejected');
    assertNothingPublished(target);
  });
});

describe('metadata-only privacy profile', { timeout: 300_000 }, () => {
  it('strips content and nested source-bearing metadata from nodes', () => {
    const stripped = stripNode({
      id: 'n', kind: 'function', name: 'f', filePath: 'a.ts', content: 'function f() {}',
      metadata: { framework: 'express', securitySignals: [{ type: 'XSS', sink: 'send', line: 3, expression: 'res.send(q)', source: 'req.query' } as never] },
    });
    assert.equal(stripped.content, undefined);
    assert.deepEqual(stripped.metadata, { framework: 'express', securitySignals: [{ type: 'XSS', sink: 'send', line: 3 }] });
  });

  it('declares its capability consequences and rebuilds BM25 names-only', async () => {
    const { manifest } = await unpack(metadataPackage);
    assert.equal(manifest.privacyProfile, 'metadata-only');
    assert.equal(typeof manifest.privacyTransformVersion, 'number');
    assert.deepEqual(
      { s: manifest.capabilities.sourceContent, b: manifest.capabilities.bm25Content, v: manifest.capabilities.vector, p: manifest.capabilities.protocolContracts },
      { s: false, b: 'names-only', v: false, p: false },
    );
    assert.equal(manifest.artifacts.some((a) => a.name === 'protocol-contracts.json' || a.name === 'vector.db'), false);
    const raw = fs.readFileSync(path.join((await unpack(metadataPackage)).dir, 'graph.db'));
    assert.equal(raw.includes(Buffer.from(BODY)), false, 'graph bytes carry no source text');
    const fullRaw = fs.readFileSync(path.join((await unpack(fullPackage)).dir, 'graph.db'));
    assert.equal(fullRaw.includes(Buffer.from(BODY)), true, 'control: the full profile does carry the body');
  });

  it('source-dependent reads report missing content instead of stale or working-tree source', async () => {
    const target = clone('clone-metadata');
    const imported = await importPortableIndex({ repoDir: target, packagePath: metadataPackage });
    assert.equal(imported.status, 'imported', JSON.stringify(imported));
    resetRepoGraphCacheForTests();
    resetIndexViewMemoForTests();
    const graph = createKnowledgeGraph();

    const inspect = await dispatchTool('inspect', { symbol_name: 'betaHead', ref: 'HEAD' }, graph, 'clone', target);
    const inspected = JSON.parse(inspect.content[0]!.text) as Json;
    assert.equal(inspected.node.name, 'betaHead');
    assert.equal(inspected.content, undefined);
    assert.equal(inspected.indexView.capabilities.sourceContent, false);
    assert.ok((inspected.indexView.boundaries as Json[]).some((b) => b.kind === 'missing-content'));

    // The clone's working tree *does* contain the source; it must not be hydrated into the answer.
    const explore = await dispatchTool('explore', { task: 'how does betaHead use alphaBase', ref: 'HEAD' }, graph, 'clone', target);
    assert.notEqual(explore.isError, true, explore.content[0]?.text);
    assert.equal(explore.content.some((c) => c.text.includes(BODY)), false, 'no source text in a metadata-only answer');
    const explored = JSON.parse(explore.content[0]!.text) as Json;
    assert.ok((explored.capabilities.degraded as string[]).some((d) => d.includes('missing-content')));

    const search = JSON.parse((await dispatchTool('search', { query: 'betaHead', ref: 'HEAD' }, graph, 'clone', target)).content[0]!.text) as Json;
    const hit = (search.results as Json[]).find((r) => r.name === 'betaHead');
    assert.ok(hit, 'names-only BM25 still finds symbols');
    assert.equal(JSON.stringify(search).includes(BODY), false);
  });

  it('rejects a package that declares metadata-only but carries source text', async () => {
    const target = clone('clone-liar');
    const { dir, manifest } = await unpack(fullPackage);
    const keep = manifest.artifacts.filter((a) => a.name !== 'protocol-contracts.json' && a.name !== 'vector.db');
    const lying: PortableIndexManifestV1 = {
      ...manifest,
      privacyProfile: 'metadata-only',
      privacyTransformVersion: 1,
      capabilities: { ...manifest.capabilities, privacyProfile: 'metadata-only', sourceContent: false, bm25Content: 'names-only', vector: false, protocolContracts: false },
      artifacts: keep,
    };
    const pkg = await repack(path.join(TMP, 'liar.cidx'), dir, lying);
    const result = await importPortableIndex({ repoDir: target, packagePath: pkg });
    assert.equal(result.status === 'rejected' && result.code, 'privacy-violation');
    assertNothingPublished(target);
  });
});
