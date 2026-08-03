import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMBEDDING_MODELS,
  getDefaultEmbeddingModel,
  getEmbeddingModel,
  getEmbeddingModelCatalog,
  normalizeEmbeddingModelId,
} from '../../../src/search/embedding-model-registry.js';

describe('embedding-model-registry', () => {
  it('defines exactly one default model', () => {
    assert.equal(EMBEDDING_MODELS.filter((model) => model.default).length, 1);
    assert.equal(getDefaultEmbeddingModel().id, 'Xenova/all-MiniLM-L6-v2');
  });

  it('normalizes legacy short id only', () => {
    assert.equal(normalizeEmbeddingModelId('all-MiniLM-L6-v2'), 'Xenova/all-MiniLM-L6-v2');
    assert.equal(normalizeEmbeddingModelId('custom-model'), 'custom-model');
  });

  it('resolves canonical model id lookup', () => {
    assert.equal(getEmbeddingModel('all-MiniLM-L6-v2')?.id, 'Xenova/all-MiniLM-L6-v2');
    assert.equal(getEmbeddingModel('missing-model'), null);
  });

  it('returns deterministic catalog with default model', () => {
    const catalog = getEmbeddingModelCatalog();
    assert.equal(catalog.defaultModel, 'Xenova/all-MiniLM-L6-v2');
    assert.equal(catalog.models[0]?.id, 'Xenova/all-MiniLM-L6-v2');
    assert.equal(typeof catalog.models[0]?.available, 'boolean');
  });
});
