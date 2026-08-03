import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIndexGeneration, publishIndexGeneration } from '../../../src/storage/index-generation.js';
import { resolveIndexSnapshot, snapshotStillCurrent } from '../../../src/storage/index-snapshot.js';

function tempRepo(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'index-snapshot-')); }
function write(pathname: string, value: string): void { fs.mkdirSync(path.dirname(pathname), { recursive: true }); fs.writeFileSync(pathname, value); }
const metadata = { indexedAt: '2026-08-03T00:00:00.000Z', schemaVersion: 8, indexVersion: 'v', parser: 'tree-sitter', stats: { nodes: 1, edges: 0, files: 1, duration: 1 } };

describe('index snapshot', () => {
  it('pins all artifact paths to one generation during publication', () => {
    const root = tempRepo();
    try {
      const g1 = createIndexGeneration(root, 'g1');
      write(g1.graphDbPath, 'graph-1'); write(g1.bm25DbPath, 'bm25-1');
      publishIndexGeneration(root, g1, metadata);
      const pinned = resolveIndexSnapshot(root)!;

      const g2 = createIndexGeneration(root, 'g2', { baseGenerationId: 'g1' });
      write(g2.graphDbPath, 'graph-2'); write(g2.bm25DbPath, 'bm25-2');
      publishIndexGeneration(root, g2, metadata);

      assert.equal(fs.readFileSync(pinned.graphDbPath, 'utf8'), 'graph-1');
      assert.equal(fs.readFileSync(pinned.bm25DbPath, 'utf8'), 'bm25-1');
      assert.equal(snapshotStillCurrent(pinned), false);
      assert.equal(resolveIndexSnapshot(root)?.generationId, 'g2');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
