import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { VectorIndex } from '../../../src/search/vector-index.js';
import { resolveVectorRuntimeState } from '../../../src/search/vector-runtime-state.js';
import { getDefaultEmbeddingModel, type EmbeddingModelDescriptor } from '../../../src/search/embedding-model-registry.js';
import type { IndexMetadata } from '../../../src/storage/metadata.js';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `vector-runtime-state-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function makeMetadata(overrides: Partial<NonNullable<IndexMetadata['embeddings']>> = {}): IndexMetadata {
  const descriptor = getDefaultEmbeddingModel();
  return {
    indexedAt: new Date().toISOString(),
    stats: { nodes: 1, edges: 0, files: 1, duration: 0 },
    embeddings: {
      enabled: true,
      status: 'ready',
      provider: descriptor.provider,
      model: descriptor.id,
      dimension: descriptor.dimension,
      ...overrides,
    },
  };
}

function runtimeFingerprint(descriptor: EmbeddingModelDescriptor) {
  return {
    provider: descriptor.provider,
    model: descriptor.id,
    dimension: descriptor.dimension,
  };
}

describe('resolveVectorRuntimeState', () => {
  it('reports missing when vector.db does not exist', async () => {
    const descriptor = getDefaultEmbeddingModel();
    const state = await resolveVectorRuntimeState({
      vectorDbPath: tmpDbPath(),
      descriptor,
      runtimeFingerprint: runtimeFingerprint(descriptor),
    });
    assert.equal(state.status, 'missing');
    assert.equal(state.ready, false);
  });

  it('reports unavailable when metadata disables embeddings', async () => {
    const descriptor = getDefaultEmbeddingModel();
    const dbPath = tmpDbPath();
    const idx = new VectorIndex(dbPath);
    await idx.init();
    await idx.buildIndex([{ id: 'n1', name: 'n1', kind: 'function', filePath: 'src/a.ts', text: 'n1', embedding: Array(descriptor.dimension).fill(0).map((_, i) => (i === 0 ? 1 : 0)) }]);
    idx.close();

    const state = await resolveVectorRuntimeState({
      vectorDbPath: dbPath,
      descriptor,
      runtimeFingerprint: runtimeFingerprint(descriptor),
      metadata: makeMetadata({ enabled: false }),
    });
    assert.equal(state.status, 'unavailable');
    assert.equal(state.ready, false);
    fs.unlinkSync(dbPath);
  });

  it('reports stale when metadata marks embeddings stale', async () => {
    const descriptor = getDefaultEmbeddingModel();
    const dbPath = tmpDbPath();
    const idx = new VectorIndex(dbPath);
    await idx.init();
    await idx.buildIndex([{ id: 'n1', name: 'n1', kind: 'function', filePath: 'src/a.ts', text: 'n1', embedding: Array(descriptor.dimension).fill(0).map((_, i) => (i === 0 ? 1 : 0)) }]);
    idx.close();

    const state = await resolveVectorRuntimeState({
      vectorDbPath: dbPath,
      descriptor,
      runtimeFingerprint: runtimeFingerprint(descriptor),
      metadata: makeMetadata({ status: 'stale' }),
    });
    assert.equal(state.status, 'stale');
    assert.equal(state.ready, false);
    fs.unlinkSync(dbPath);
  });

  it('reports incompatible when embedding fingerprint differs', async () => {
    const descriptor = getDefaultEmbeddingModel();
    const dbPath = tmpDbPath();
    const idx = new VectorIndex(dbPath);
    await idx.init();
    await idx.buildIndex([{ id: 'n1', name: 'n1', kind: 'function', filePath: 'src/a.ts', text: 'n1', embedding: Array(descriptor.dimension).fill(0).map((_, i) => (i === 0 ? 1 : 0)) }]);
    idx.close();

    const state = await resolveVectorRuntimeState({
      vectorDbPath: dbPath,
      descriptor,
      runtimeFingerprint: runtimeFingerprint(descriptor),
      metadata: makeMetadata({ model: 'different-model' }),
    });
    assert.equal(state.status, 'incompatible');
    assert.equal(state.ready, false);
    fs.unlinkSync(dbPath);
  });

  it('reports corrupt when vector.db cannot be read', async () => {
    const descriptor = getDefaultEmbeddingModel();
    const dbPath = tmpDbPath();
    fs.writeFileSync(dbPath, 'not-a-sqlite-db');
    const state = await resolveVectorRuntimeState({
      vectorDbPath: dbPath,
      descriptor,
      runtimeFingerprint: runtimeFingerprint(descriptor),
      metadata: makeMetadata(),
    });
    assert.equal(state.status, 'corrupt');
    assert.equal(state.ready, false);
    fs.unlinkSync(dbPath);
  });

  it('reports ready for a valid compatible vector index', async () => {
    const descriptor = getDefaultEmbeddingModel();
    const dbPath = tmpDbPath();
    const idx = new VectorIndex(dbPath);
    await idx.init();
    await idx.buildIndex([{ id: 'n1', name: 'n1', kind: 'function', filePath: 'src/a.ts', text: 'n1', embedding: Array(descriptor.dimension).fill(0).map((_, i) => (i === 0 ? 1 : 0)) }]);
    idx.close();

    const state = await resolveVectorRuntimeState({
      vectorDbPath: dbPath,
      descriptor,
      runtimeFingerprint: runtimeFingerprint(descriptor),
      metadata: makeMetadata(),
    });
    assert.equal(state.status, 'ready');
    assert.equal(state.ready, true);
    fs.unlinkSync(dbPath);
  });
});
