import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIndexGenerationManifest } from '../../../src/storage/index-generation.js';

describe('generation manifest fact compatibility', () => {
  it('accepts fact schema metadata on v2 manifests', () => {
    const manifest = normalizeIndexGenerationManifest({
      version: 2,
      generationId: 'g1',
      publishedAt: '2026-08-03T00:00:00.000Z',
      schemaVersion: 8,
      parser: 'tree-sitter',
      factSchemaVersion: '1.0.11',
      factSchemaFingerprint: 'abc123',
      artifacts: ['graph.db', 'bm25.db', 'meta.json'],
    });

    assert.equal(manifest?.version, 2);
    if (manifest?.version === 2) {
      assert.equal(manifest.factSchemaVersion, '1.0.11');
      assert.equal(manifest.factSchemaFingerprint, 'abc123');
    }
  });
});
