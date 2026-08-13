import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfigEmbeddingModel, validateConfig } from '../../../src/cli/config-manager.js';
import type { CodeIntelConfig } from '../../../src/cli/init-wizard.js';

function makeConfig(overrides: Partial<CodeIntelConfig['embeddings']> = {}): CodeIntelConfig {
  return {
    llm: { provider: 'ollama', model: 'llama3', apiKey: '', batchSize: 20, maxTokensPerSummary: 100 },
    embeddings: { model: 'Xenova/all-MiniLM-L6-v2', enabled: false, ...overrides },
    analysis: { maxFileSizeKB: 512, ignorePatterns: [], incrementalByDefault: false },
    index: { keepGenerations: 2, staleStagingHours: 24 },
    serve: { defaultPort: 4747, openBrowser: true },
    auth: { mode: 'local' },
    updates: { checkOnStartup: true, intervalHours: 24 },
    telemetry: { enabled: false },
  };
}

describe('config-manager embeddings validation', () => {
  it('normalizes legacy short id', () => {
    const cfg = normalizeConfigEmbeddingModel(makeConfig({ model: 'all-MiniLM-L6-v2' }));
    assert.equal(cfg.embeddings.model, 'Xenova/all-MiniLM-L6-v2');
  });

  it('accepts valid canonical model', () => {
    assert.deepEqual(validateConfig(makeConfig({ enabled: true })), []);
  });

  it('rejects unknown model when embeddings enabled', () => {
    const errors = validateConfig(makeConfig({ enabled: true, model: 'missing-model' }));
    assert.equal(errors.some((error) => error.path === 'embeddings.model' && /Unsupported embedding model/.test(error.reason)), true);
  });

  it('allows unknown model when embeddings disabled', () => {
    assert.deepEqual(validateConfig(makeConfig({ enabled: false, model: 'missing-model' })), []);
  });
});
