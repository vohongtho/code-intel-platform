import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createIndexGeneration,
  getCurrentManifestPath,
  publishIndexGeneration,
} from '../../../src/storage/index-generation.js';
import {
  IndexSnapshotError,
  requireIndexSnapshot,
  resolveIndexSnapshot,
  snapshotStillCurrent,
} from '../../../src/storage/index-snapshot.js';

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
      const pinned = requireIndexSnapshot(root);

      const g2 = createIndexGeneration(root, 'g2', { baseGenerationId: 'g1' });
      write(g2.graphDbPath, 'graph-2'); write(g2.bm25DbPath, 'bm25-2');
      publishIndexGeneration(root, g2, metadata);

      assert.equal(fs.readFileSync(pinned.graphDbPath, 'utf8'), 'graph-1');
      assert.equal(fs.readFileSync(pinned.bm25DbPath, 'utf8'), 'bm25-1');
      assert.equal(snapshotStillCurrent(pinned), false);
      assert.equal(resolveIndexSnapshot(root)?.generationId, 'g2');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('normalizes a generation-v1 manifest into one cohesive snapshot', () => {
    const root = tempRepo();
    try {
      const generationDir = path.join(root, '.code-intel', 'generations', 'legacy-generation');
      write(path.join(generationDir, 'graph.db'), 'graph');
      write(path.join(generationDir, 'bm25.db'), 'bm25');
      write(path.join(generationDir, 'meta.json'), JSON.stringify(metadata));
      write(getCurrentManifestPath(root), JSON.stringify({
        generationId: 'legacy-generation',
        publishedAt: '2026-08-03T00:00:00.000Z',
        artifacts: ['graph.db', 'bm25.db', 'meta.json'],
      }));
      const snapshot = requireIndexSnapshot(root);
      assert.equal(snapshot.manifestVersion, 1);
      assert.equal(snapshot.generationId, 'legacy-generation');
      assert.equal(path.dirname(snapshot.graphDbPath), snapshot.generationDir);
      assert.equal(path.dirname(snapshot.bm25DbPath), snapshot.generationDir);
      assert.equal(path.dirname(snapshot.metadataPath), snapshot.generationDir);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects a manifest that tries to escape the generations directory', () => {
    const root = tempRepo();
    try {
      write(getCurrentManifestPath(root), JSON.stringify({
        version: 2,
        generationId: '../outside',
        publishedAt: '2026-08-03T00:00:00.000Z',
        artifacts: ['graph.db'],
      }));
      assert.equal(resolveIndexSnapshot(root), null);
      assert.throws(() => requireIndexSnapshot(root), IndexSnapshotError);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects a generation symlink that resolves outside the generation root', { skip: process.platform === 'win32' }, () => {
    const root = tempRepo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'index-snapshot-outside-'));
    try {
      write(path.join(outside, 'graph.db'), 'graph');
      const generations = path.join(root, '.code-intel', 'generations');
      fs.mkdirSync(generations, { recursive: true });
      fs.symlinkSync(outside, path.join(generations, 'escaped'), 'dir');
      write(getCurrentManifestPath(root), JSON.stringify({
        version: 2,
        generationId: 'escaped',
        publishedAt: '2026-08-03T00:00:00.000Z',
        artifacts: ['graph.db'],
      }));
      assert.equal(resolveIndexSnapshot(root), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
