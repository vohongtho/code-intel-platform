import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyAnalyzeUnlock,
  applyIndexCleanup,
  planAnalyzeUnlock,
  planIndexCleanup,
} from '../../../src/storage/index-maintenance.js';
import {
  createIndexGeneration,
  getGenerationsDir,
  publishIndexGeneration,
} from '../../../src/storage/index-generation.js';
import { getAnalyzeLockPath } from '../../../src/storage/analyze-lock.js';

function tempRepo(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'index-maintenance-')); }
function write(file: string, value: string): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
const metadata = { indexedAt: '2026-08-03T00:00:00.000Z', schemaVersion: 8, indexVersion: 'v', parser: 'tree-sitter', stats: { nodes: 1, edges: 0, files: 1, duration: 1 } };
function publish(repo: string, id: string): void {
  const generation = createIndexGeneration(repo, id);
  write(generation.graphDbPath, `graph-${id}`);
  write(generation.bm25DbPath, `bm25-${id}`);
  publishIndexGeneration(repo, generation, metadata, { keepGenerations: 10 });
}

describe('index maintenance', () => {
  it('plans and removes old generations without removing current', () => {
    const repo = tempRepo();
    try {
      publish(repo, 'g1'); publish(repo, 'g2'); publish(repo, 'g3');
      const plan = planIndexCleanup(repo, { keepGenerations: 2 });
      assert.equal(plan.currentGenerationId, 'g3');
      assert.deepEqual(plan.removeGenerations, ['g1']);
      applyIndexCleanup(plan);
      assert.equal(fs.existsSync(path.join(getGenerationsDir(repo), 'g1')), false);
      assert.equal(fs.existsSync(path.join(getGenerationsDir(repo), 'g3')), true);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it('dry-run planning does not mutate files', () => {
    const repo = tempRepo();
    try {
      publish(repo, 'g1'); publish(repo, 'g2');
      const plan = planIndexCleanup(repo, { keepGenerations: 1 });
      assert.deepEqual(plan.removeGenerations, ['g1']);
      assert.equal(fs.existsSync(path.join(getGenerationsDir(repo), 'g1')), true);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it('requires a trusted published generation before removing legacy artifacts', () => {
    const repo = tempRepo();
    try {
      write(path.join(repo, '.code-intel', 'graph.db'), 'legacy');
      assert.throws(() => planIndexCleanup(repo, { removeLegacy: true }), /trusted published generation/);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it('does not unlock a live owner without force', () => {
    const repo = tempRepo();
    try {
      const lockPath = getAnalyzeLockPath(repo);
      write(lockPath, JSON.stringify({ version: 1, token: 'live', pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString() }));
      const plan = planAnalyzeUnlock(repo);
      assert.equal(plan.removable, false);
      assert.throws(() => applyAnalyzeUnlock(plan), /still running/);
      const forced = planAnalyzeUnlock(repo, true);
      applyAnalyzeUnlock(forced);
      assert.equal(fs.existsSync(lockPath), false);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });
});
