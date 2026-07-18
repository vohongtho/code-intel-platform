import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveMetadata,
  loadMetadata,
  getDbPath,
  getVectorDbPath,
  computeIndexVersion,
  getAgentTargetsPath,
  loadAgentTargets,
  saveAgentTargets,
} from '../../../src/storage/metadata.js';

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('Metadata', () => {
  let repoDir: string;

  before(() => {
    repoDir = path.join(os.tmpdir(), `metadata-test-${Date.now()}`);
    fs.mkdirSync(repoDir, { recursive: true });
  });

  after(() => {
    try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('saveMetadata + loadMetadata — round-trip', () => {
    const meta = {
      indexedAt: '2025-01-01T00:00:00.000Z',
      stats: { nodes: 42, edges: 100, files: 10, duration: 500 },
    };
    saveMetadata(repoDir, meta);
    const loaded = loadMetadata(repoDir);
    assert.ok(loaded !== null);
    assert.equal(loaded!.stats.nodes, 42);
    assert.equal(loaded!.stats.edges, 100);
    assert.equal(loaded!.indexedAt, '2025-01-01T00:00:00.000Z');
    assert.equal(loaded!.stats.duration, 500);
  });

  it('loadMetadata — returns null for missing directory', () => {
    const result = loadMetadata('/nonexistent/path/that/does/not/exist-xyz');
    assert.equal(result, null);
  });

  it('saveMetadata — creates .code-intel/ directory if missing', () => {
    const newDir = path.join(os.tmpdir(), `meta-newdir-${Date.now()}`);
    try {
      saveMetadata(newDir, {
        indexedAt: new Date().toISOString(),
        stats: { nodes: 1, edges: 0, files: 1, duration: 10 },
      });
      assert.ok(fs.existsSync(path.join(newDir, '.code-intel', 'meta.json')));
    } finally {
      try { fs.rmSync(newDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('getDbPath — returns path ending in graph.db inside .code-intel', () => {
    const dbPath = getDbPath('/my/repo');
    assert.ok(dbPath.endsWith('graph.db'));
    assert.ok(dbPath.includes('.code-intel'));
    assert.ok(dbPath.startsWith('/my/repo'));
  });

  it('getVectorDbPath — returns path ending in vector.db inside .code-intel', () => {
    const vdbPath = getVectorDbPath('/my/repo');
    assert.ok(vdbPath.endsWith('vector.db'));
    assert.ok(vdbPath.includes('.code-intel'));
  });

  it('loadMetadata — returns null for corrupted meta.json', () => {
    const dir = path.join(os.tmpdir(), `meta-corrupt-${Date.now()}`);
    try {
      const codeIntelDir = path.join(dir, '.code-intel');
      fs.mkdirSync(codeIntelDir, { recursive: true });
      fs.writeFileSync(path.join(codeIntelDir, 'meta.json'), 'INVALID JSON {{{');
      const result = loadMetadata(dir);
      assert.equal(result, null);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('computeIndexVersion — changes when published index files change', () => {
    const dir = path.join(os.tmpdir(), `meta-version-${Date.now()}`);
    try {
      const codeIntelDir = path.join(dir, '.code-intel');
      fs.mkdirSync(codeIntelDir, { recursive: true });
      fs.writeFileSync(path.join(codeIntelDir, 'graph.db'), 'a');
      const first = computeIndexVersion(dir, 1, '2025-01-01T00:00:00.000Z');
      fs.writeFileSync(path.join(codeIntelDir, 'graph.db'), 'ab');
      const second = computeIndexVersion(dir, 1, '2025-01-01T00:00:00.000Z');
      assert.notEqual(first, second);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('getAgentTargetsPath — returns path inside .code-intel', () => {
    const targetsPath = getAgentTargetsPath('/my/repo');
    assert.ok(targetsPath.endsWith('agent-targets.json'));
    assert.ok(targetsPath.includes('.code-intel'));
    assert.ok(targetsPath.startsWith('/my/repo'));
  });

  it('saveAgentTargets + loadAgentTargets — round-trip', () => {
    const selection = {
      selectedAgents: ['cursor'],
      targets: {
        cursor: {
          agentId: 'cursor',
          label: 'Cursor',
          path: '.cursor/rules/code-intel.mdc',
          format: 'markdown' as const,
          builtin: true,
        },
      },
    };
    saveAgentTargets(repoDir, selection);
    const loaded = loadAgentTargets(repoDir);
    assert.deepEqual(loaded, selection);
  });

  it('loadAgentTargets — returns null for missing file', () => {
    const dir = path.join(os.tmpdir(), `agent-targets-missing-${Date.now()}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      assert.equal(loadAgentTargets(dir), null);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
