import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDbPath, getVectorDbPath, saveMetadata } from '../../../src/storage/metadata.js';
import { getBm25DbPath } from '../../../src/search/bm25-index.js';

const original = process.env['CODE_INTEL_INDEX_STAGING_DIR'];

afterEach(() => {
  if (original === undefined) delete process.env['CODE_INTEL_INDEX_STAGING_DIR'];
  else process.env['CODE_INTEL_INDEX_STAGING_DIR'] = original;
});

describe('atomic staging artifact routing', () => {
  it('routes graph, BM25, vector and metadata writes to one staging directory', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-atomic-repo-'));
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-atomic-stage-'));
    process.env['CODE_INTEL_INDEX_STAGING_DIR'] = staging;

    assert.equal(getDbPath(repo), path.join(staging, 'graph.db'));
    assert.equal(getBm25DbPath(repo), path.join(staging, 'bm25.db'));
    assert.equal(getVectorDbPath(repo), path.join(staging, 'vector.db'));

    saveMetadata(repo, {
      indexedAt: new Date(0).toISOString(),
      stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
    });
    assert.equal(fs.existsSync(path.join(staging, 'meta.json')), true);
    assert.equal(fs.existsSync(path.join(repo, '.code-intel', 'meta.json')), false);
  });
});
