import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  listEmbeddingModels,
  normalizeEmbeddingModelId,
  resolveEmbeddingModel,
} from '../../../src/search/embedding-models.js';

describe('embedding model catalog', () => {
  it('exposes a canonical backend-owned default model', () => {
    const models = listEmbeddingModels();
    assert.ok(models.length > 0);
    assert.equal(models[0]?.id, DEFAULT_EMBEDDING_MODEL_ID);
    assert.equal(models[0]?.dimension, 384);
  });

  it('normalizes the legacy short model name', () => {
    assert.equal(normalizeEmbeddingModelId('all-MiniLM-L6-v2'), DEFAULT_EMBEDDING_MODEL_ID);
    assert.equal(resolveEmbeddingModel('all-MiniLM-L6-v2')?.id, DEFAULT_EMBEDDING_MODEL_ID);
  });

  it('rejects unknown model IDs', () => {
    assert.equal(resolveEmbeddingModel('vendor/unknown-model'), null);
  });
});
