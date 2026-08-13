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
  touchIndexGeneration,
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
      applyIndexCleanup(plan);
      assert.equal(fs.existsSync(path.join(getGenerationsDir(repo), 'g3')), true);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it('dry-run planning does not mutate files', () => {
    const repo = tempRepo();
    try {
      publish(repo, 'g1'); publish(repo, 'g2');
      const plan = planIndexCleanup(repo, { keepGenerations: 1 });
      assert.ok(plan.removeGenerations.length <= 1);
      assert.equal(fs.existsSync(path.join(getGenerationsDir(repo), 'g1')), true);
      assert.equal(fs.existsSync(path.join(getGenerationsDir(repo), 'g2')), true);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it('requires a trusted published generation before removing legacy artifacts', () => {
    const repo = tempRepo();
    try {
      write(path.join(repo, '.code-intel', 'graph.db'), 'legacy');
      assert.throws(() => planIndexCleanup(repo, { removeLegacy: true }), /trusted published generation/);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it('preserves staging owned by the active analyze lock', () => {
    const repo = tempRepo();
    try {
      const generation = createIndexGeneration(repo, 'locked');
      const lockPath = getAnalyzeLockPath(repo);
      write(lockPath, JSON.stringify({ version: 1, token: 'lock', pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), stagingGenerationId: 'locked' }));
      const plan = planIndexCleanup(repo, { staleStagingMs: 0, nowMs: Date.now() + 10 });
      assert.deepEqual(plan.removeStaging, []);
      assert.ok(plan.preserved.some((value) => value.includes('.staging-locked') && value.includes('lock-owned')));
      applyIndexCleanup(plan);
      assert.equal(fs.existsSync(generation.stagingDir), true);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it('preserves remote-host staging when ownership is uncertain', () => {
    const repo = tempRepo();
    try {
      const generation = createIndexGeneration(repo, 'remote');
      write(path.join(generation.stagingDir, 'staging.json'), JSON.stringify({
        version: 1,
        generationId: 'remote',
        pid: process.pid,
        hostname: 'other-host',
        createdAt: '2026-08-03T00:00:00.000Z',
        lastActivityAt: '2026-08-03T00:00:00.000Z',
      }));
      const plan = planIndexCleanup(repo, { staleStagingMs: 0, nowMs: Date.now() + 10 });
      assert.deepEqual(plan.removeStaging, []);
      assert.ok(plan.preserved.some((value) => value.includes('.staging-remote') && value.includes('another host')));
      applyIndexCleanup(plan);
      assert.equal(fs.existsSync(generation.stagingDir), true);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it('skips staging deletion when ownership changes after planning', () => {
    const repo = tempRepo();
    try {
      const generation = createIndexGeneration(repo, 'claim-race');
      write(path.join(generation.stagingDir, 'staging.json'), JSON.stringify({
        version: 1,
        generationId: 'claim-race',
        pid: process.pid + 100000,
        hostname: os.hostname(),
        createdAt: '2026-08-03T00:00:00.000Z',
        lastActivityAt: '2026-08-03T00:00:00.000Z',
      }));
      const plan = planIndexCleanup(repo, { staleStagingMs: 0, nowMs: Date.now() + 10 });
      assert.deepEqual(plan.removeStaging, ['.staging-claim-race']);
      write(path.join(generation.stagingDir, 'staging.json'), JSON.stringify({
        version: 1,
        generationId: 'claim-race',
        pid: process.pid + 100001,
        hostname: os.hostname(),
        createdAt: '2026-08-03T00:00:01.000Z',
        lastActivityAt: '2026-08-03T00:00:01.000Z',
      }));
      applyIndexCleanup(plan);
      assert.equal(fs.existsSync(generation.stagingDir), true);
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it('touchIndexGeneration refreshes staging activity for long-running work', () => {
    const repo = tempRepo();
    try {
      const generation = createIndexGeneration(repo, 'heartbeat');
      const ownerPath = path.join(generation.stagingDir, 'staging.json');
      const before = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as { lastActivityAt: string };
      touchIndexGeneration(generation);
      const after = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as { lastActivityAt: string };
      assert.ok(Date.parse(after.lastActivityAt) >= Date.parse(before.lastActivityAt));
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
