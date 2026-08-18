import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createIndexGeneration,
  publishIndexGeneration,
  abortIndexGeneration,
  loadCurrentGenerationManifest,
  resolvePublishedArtifactPath,
  migrateLegacyIndexToGeneration,
  normalizeIndexGenerationManifest,
} from '../../../src/storage/index-generation.js';

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-generation-'));
}

function write(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

const metadata = {
  indexedAt: '2026-07-30T00:00:00.000Z',
  stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
};

describe('index generation publication', () => {
  it('publishes all artifacts behind one manifest swap', () => {
    const root = tempRepo();
    try {
      const generation = createIndexGeneration(root, 'g1');
      write(generation.graphDbPath, 'graph-v1');
      write(generation.bm25DbPath, 'bm25-v1');
      write(generation.vectorDbPath, 'vector-v1');

      const manifest = publishIndexGeneration(root, generation, metadata, { vectorRequired: true });

      assert.equal(manifest.generationId, 'g1');
      assert.equal(loadCurrentGenerationManifest(root)?.generationId, 'g1');
      assert.equal(fs.readFileSync(resolvePublishedArtifactPath(root, 'graph.db'), 'utf8'), 'graph-v1');
      assert.equal(fs.readFileSync(resolvePublishedArtifactPath(root, 'bm25.db'), 'utf8'), 'bm25-v1');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the previous generation live when validation fails', () => {
    const root = tempRepo();
    try {
      const first = createIndexGeneration(root, 'g1');
      write(first.graphDbPath, 'graph-v1');
      write(first.bm25DbPath, 'bm25-v1');
      publishIndexGeneration(root, first, metadata);

      const failed = createIndexGeneration(root, 'g2');
      write(failed.graphDbPath, 'graph-v2');
      assert.throws(() => publishIndexGeneration(root, failed, metadata), /bm25\.db/);
      abortIndexGeneration(failed);

      assert.equal(loadCurrentGenerationManifest(root)?.generationId, 'g1');
      assert.equal(fs.readFileSync(resolvePublishedArtifactPath(root, 'graph.db'), 'utf8'), 'graph-v1');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('migrates a complete legacy flat index without deleting the source files', () => {
    const root = tempRepo();
    try {
      const legacyDir = path.join(root, '.code-intel');
      write(path.join(legacyDir, 'graph.db'), 'legacy-graph');
      write(path.join(legacyDir, 'bm25.db'), 'legacy-bm25');
      write(path.join(legacyDir, 'meta.json'), JSON.stringify(metadata));

      const manifest = migrateLegacyIndexToGeneration(root);

      assert.ok(manifest?.generationId.startsWith('legacy-'));
      assert.equal(fs.readFileSync(resolvePublishedArtifactPath(root, 'graph.db'), 'utf8'), 'legacy-graph');
      assert.equal(fs.readFileSync(path.join(legacyDir, 'graph.db'), 'utf8'), 'legacy-graph');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});


describe('index generation manifest compatibility', () => {
  it('normalizes a v1 manifest without rewriting its compatibility fields', () => {
    const manifest = normalizeIndexGenerationManifest({
      generationId: 'g-v1',
      publishedAt: '2026-08-03T00:00:00.000Z',
      artifacts: ['graph.db', 'bm25.db', 'meta.json'],
    });
    assert.deepEqual(manifest, {
      version: undefined,
      generationId: 'g-v1',
      publishedAt: '2026-08-03T00:00:00.000Z',
      artifacts: ['graph.db', 'bm25.db', 'meta.json'],
    });
  });

  it('publishes v2 details while retaining v1-compatible top-level fields', () => {
    const root = tempRepo();
    try {
      const generation = createIndexGeneration(root, 'g-v2');
      write(generation.graphDbPath, 'graph');
      write(generation.bm25DbPath, 'bm25');
      const manifest = publishIndexGeneration(root, generation, {
        ...metadata,
        schemaVersion: 8,
        parser: 'tree-sitter',
        factSchemaVersion: '1.0.11',
        factSchemaFingerprint: 'abc123',
      });
      assert.equal(manifest.version, 2);
      assert.equal(manifest.generationId, 'g-v2');
      assert.ok(manifest.artifacts.includes('graph.db'));
      if (manifest.version === 2) {
        assert.equal(manifest.schemaVersion, 8);
        assert.equal(manifest.parser, 'tree-sitter');
        assert.equal(manifest.factSchemaVersion, '1.0.11');
        assert.equal(manifest.factSchemaFingerprint, 'abc123');
        assert.ok((manifest.artifactDetails?.['graph.db']?.size ?? 0) > 0);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe generation identifiers', () => {
    for (const generationId of ['../escape', '/absolute', 'nested/path', 'nested\\path', 'bad\0id']) {
      assert.equal(normalizeIndexGenerationManifest({
        version: 2,
        generationId,
        publishedAt: '2026-08-03T00:00:00.000Z',
        artifacts: ['graph.db'],
      }), null);
    }
  });
});
