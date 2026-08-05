import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

let tmpHome: string;
let reconcileRegistryEntry: typeof import('../../../src/storage/registry-reconciliation.js')['reconcileRegistryEntry'];

const backupHome = process.env['HOME'];

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('registry-reconciliation preservation', () => {
  before(async () => {
    tmpHome = path.join(os.tmpdir(), `registry-reconcile-preserve-${Date.now()}`);
    process.env['HOME'] = tmpHome;
    fs.mkdirSync(path.join(tmpHome, '.code-intel'), { recursive: true });

    const reconcileMod = await import('../../../src/storage/registry-reconciliation.js');
    reconcileRegistryEntry = reconcileMod.reconcileRegistryEntry;
  });

  after(() => {
    if (backupHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = backupHome;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('restores registry entry without changing published artifact bytes', () => {
    const repoDir = path.join(os.tmpdir(), `registry-preserve-repo-${Date.now()}`);
    const ciDir = path.join(repoDir, '.code-intel');
    fs.mkdirSync(ciDir, { recursive: true });

    const files = {
      current: path.join(ciDir, 'current.json'),
      graph: path.join(ciDir, 'graph.db'),
      bm25: path.join(ciDir, 'bm25.db'),
      vector: path.join(ciDir, 'vector.db'),
      meta: path.join(ciDir, 'meta.json'),
    };

    fs.writeFileSync(files.current, JSON.stringify({ generationId: 'g1' }, null, 2));
    fs.writeFileSync(files.graph, Buffer.from('graph-db-bytes'));
    fs.writeFileSync(files.bm25, Buffer.from('bm25-db-bytes'));
    fs.writeFileSync(files.vector, Buffer.from('vector-db-bytes'));
    fs.writeFileSync(files.meta, JSON.stringify({ indexedAt: '2025-01-01T00:00:00.000Z' }, null, 2));

    const before = Object.fromEntries(Object.entries(files).map(([name, filePath]) => [name, hashFile(filePath)]));

    const result = reconcileRegistryEntry({
      workspaceRoot: repoDir,
      requestedName: 'preserved',
      metadata: {
        repoId: 'preserved-repo-id',
        indexedAt: '2025-01-01T00:00:00.000Z',
        stats: { nodes: 10, edges: 5, files: 2, duration: 0 },
      },
    });

    assert.equal(result.outcome, 'registered');
    assert.equal(result.entry?.id, 'preserved-repo-id');

    const after = Object.fromEntries(Object.entries(files).map(([name, filePath]) => [name, hashFile(filePath)]));
    assert.deepEqual(after, before);
  });
});
