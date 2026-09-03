import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupStaleStaging,
  cloneArtifact,
  createIndexGeneration,
  getGenerationsDir,
  publishIndexGeneration,
} from '../../../src/storage/index-generation.js';
import { resolveIndexSnapshot } from '../../../src/storage/index-snapshot.js';
import { seedIndexGeneration } from '../../../src/cli/atomic-analyze.js';

function tempRepo(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'generation-v2-')); }
function write(pathname: string, value: string): void { fs.mkdirSync(path.dirname(pathname), { recursive: true }); fs.writeFileSync(pathname, value); }
const metadata = { indexedAt: '2026-08-03T00:00:00.000Z', schemaVersion: 8, indexVersion: 'v', parser: 'tree-sitter', factSchemaVersion: 'facts-v1', factSchemaFingerprint: 'fact-fp', identityFingerprint: 'identity-fp', resolverVersion: 'resolver-v1', resolverFingerprint: 'resolver-fp', evidenceSchemaVersion: 1, evidenceSchemaFingerprint: 'evidence-fp', apiContractSchemaVersion: 'api-contract-v1', apiContractFingerprint: 'api-contract-fp', embeddings: { enabled: true, status: 'ready', provider: 'x', model: 'x', dimension: 3 }, stats: { nodes: 1, edges: 0, files: 1, duration: 1 } };

describe('Generation V2 storage', () => {
  it('clones only requested vector and metadata seed artifacts', () => {
    const root = tempRepo();
    try {
      const current = createIndexGeneration(root, 'g1');
      write(current.graphDbPath, 'graph'); write(current.bm25DbPath, 'bm25'); write(current.vectorDbPath, 'vector'); write(current.evidenceDbPath!, 'evidence');
      publishIndexGeneration(root, current, metadata, { vectorRequired: true });
      const next = createIndexGeneration(root, 'g2', { baseGenerationId: 'g1' });
      const modes = seedIndexGeneration(root, next, resolveIndexSnapshot(root), ['vector.db', 'evidence.db', 'meta.json']);
      assert.ok(fs.existsSync(next.vectorDbPath));
      assert.ok(fs.existsSync(next.evidenceDbPath!));
      assert.ok(fs.existsSync(next.metadataPath));
      assert.equal(fs.existsSync(next.graphDbPath), false);
      assert.equal(fs.existsSync(next.bm25DbPath), false);
      assert.ok(modes['vector.db'] === 'copy' || modes['vector.db'] === 'reflink');
      assert.ok(modes['evidence.db'] === 'copy' || modes['evidence.db'] === 'reflink');
      assert.ok(modes['meta.json'] === 'copy' || modes['meta.json'] === 'reflink');
      assert.equal(JSON.parse(fs.readFileSync(next.metadataPath, 'utf8')).generationId, 'g1');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('falls back to a valid physical copy when cloning', () => {
    const root = tempRepo();
    try {
      const source = path.join(root, 'source.db'); const target = path.join(root, 'target.db');
      write(source, 'content');
      const mode = cloneArtifact(source, target);
      assert.ok(mode === 'copy' || mode === 'reflink');
      assert.equal(fs.readFileSync(target, 'utf8'), 'content');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('removes stale staging but preserves recent and active staging', () => {
    const root = tempRepo();
    try {
      const stale = createIndexGeneration(root, 'stale');
      const recent = createIndexGeneration(root, 'recent');
      const active = createIndexGeneration(root, 'active');
      const old = '2000-01-01T00:00:00.000Z';
      fs.writeFileSync(path.join(stale.stagingDir, 'staging.json'), JSON.stringify({ version: 1, generationId: 'stale', pid: 1, hostname: 'x', createdAt: old, lastActivityAt: old }));
      const removed = cleanupStaleStaging(root, { staleAfterMs: 60_000, activeGenerationId: 'active', nowMs: Date.now() });
      assert.deepEqual(removed, ['stale']);
      assert.equal(fs.existsSync(stale.stagingDir), false);
      assert.equal(fs.existsSync(recent.stagingDir), true);
      assert.equal(fs.existsSync(active.stagingDir), true);
      assert.ok(fs.existsSync(getGenerationsDir(root)));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('reopens published evidence artifact through snapshot', () => {
    const root = tempRepo();
    try {
      const gen = createIndexGeneration(root, 'g1');
      write(gen.graphDbPath, 'graph');
      write(gen.bm25DbPath, 'bm25');
      write(gen.evidenceDbPath!, 'evidence');
      const manifest = publishIndexGeneration(root, gen, metadata, { vectorRequired: false });
      const snapshot = resolveIndexSnapshot(root);
      assert.ok(snapshot);
      assert.equal(manifest.version, 2);
      if (manifest.version !== 2) throw new Error('expected v2 manifest');
      assert.equal(manifest.evidenceSchemaVersion, 1);
      assert.equal(manifest.evidenceSchemaFingerprint, 'evidence-fp');
      assert.equal(manifest.apiContractSchemaVersion, 'api-contract-v1');
      assert.equal(manifest.apiContractFingerprint, 'api-contract-fp');
      assert.equal(manifest.resolverVersion, 'resolver-v1');
      assert.equal(snapshot?.manifest?.version, 2);
      assert.equal(snapshot?.evidenceDbPath?.endsWith(path.join('g1', 'evidence.db')), true);
      assert.equal(fs.readFileSync(snapshot!.evidenceDbPath!, 'utf8'), 'evidence');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
