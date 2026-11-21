import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, type CodeIntelConfig } from '../../../src/cli/init-wizard.js';
import { validateConfig } from '../../../src/cli/config-manager.js';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../../../src/search/embedding-models.js';

function configWithModel(model: string, enabled = DEFAULT_CONFIG.embeddings.enabled): CodeIntelConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    embeddings: { ...DEFAULT_CONFIG.embeddings, model, enabled },
  };
}

describe('embedding model config validation', () => {
  it('accepts the canonical catalog model', () => {
    assert.deepEqual(validateConfig(configWithModel(DEFAULT_EMBEDDING_MODEL_ID)), []);
  });

  it('accepts the legacy alias for migration compatibility', () => {
    assert.deepEqual(validateConfig(configWithModel('all-MiniLM-L6-v2')), []);
  });

  it('rejects arbitrary free-text models when embeddings are enabled', () => {
    const errors = validateConfig(configWithModel('custom/unknown-model', true));
    assert.ok(errors.some((error) => error.path === 'embeddings.model'));
  });

  it('does not block a disabled embeddings config on its model name', () => {
    assert.deepEqual(validateConfig(configWithModel('custom/unknown-model', false)), []);
  });
});
