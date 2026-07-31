import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDbPath, getVectorDbPath, saveMetadata } from '../../../src/storage/metadata.js';
import { getBm25DbPath } from '../../../src/search/bm25-index.js';
import { createIndexGeneration, publishIndexGeneration } from '../../../src/storage/index-generation.js';
import { resolveAnalyzeWorkspaceRoot, seedIndexGeneration } from '../../../src/cli/atomic-analyze.js';

const original = process.env['CODE_INTEL_INDEX_STAGING_DIR'];

afterEach(() => {
  if (original === undefined) delete process.env['CODE_INTEL_INDEX_STAGING_DIR'];
  else process.env['CODE_INTEL_INDEX_STAGING_DIR'] = original;
});

describe('atomic analyze argument parsing', () => {
  it('resolves a repository path after boolean and value options', () => {
    assert.equal(resolveAnalyzeWorkspaceRoot(['analyze', '--force', '/tmp/repo'], '/cwd'), '/tmp/repo');
    assert.equal(resolveAnalyzeWorkspaceRoot(['analyze', '--name', 'api', './repo'], '/cwd'), '/cwd/repo');
    assert.equal(resolveAnalyzeWorkspaceRoot(['analyze', './repo', '--force'], '/cwd'), '/cwd/repo');
  });

  it('does not mistake option values for the repository path', () => {
    assert.equal(resolveAnalyzeWorkspaceRoot(['analyze', '--llm-model', 'gpt-4o-mini'], '/cwd'), '/cwd');
    assert.equal(resolveAnalyzeWorkspaceRoot(['analyze', '--name=api', './repo'], '/cwd'), '/cwd/repo');
  });
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

  it('copies the live generation into staging before incremental analysis', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-atomic-seed-'));
    const live = createIndexGeneration(repo, 'live');
    fs.writeFileSync(live.graphDbPath, 'graph');
    fs.writeFileSync(live.bm25DbPath, 'bm25');
    fs.writeFileSync(live.vectorDbPath, 'vector');
    publishIndexGeneration(repo, live, {
      indexedAt: new Date(0).toISOString(),
      stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
    }, { vectorRequired: true });

    const next = createIndexGeneration(repo, 'next');
    seedIndexGeneration(repo, next);
    assert.equal(fs.readFileSync(next.graphDbPath, 'utf8'), 'graph');
    assert.equal(fs.readFileSync(next.bm25DbPath, 'utf8'), 'bm25');
    assert.equal(fs.readFileSync(next.vectorDbPath, 'utf8'), 'vector');
    assert.equal(fs.existsSync(next.metadataPath), true);
  });
});
