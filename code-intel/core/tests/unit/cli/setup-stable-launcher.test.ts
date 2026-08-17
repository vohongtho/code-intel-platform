import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSetupPlan } from '../../../src/cli/setup-plan.js';
import { resolveStableMcpConfig, resolveStableHookCommand } from '../../../src/cli/runtime-command.js';
import { getDbPath, getVectorDbPath, loadMetadata, saveMetadata } from '../../../src/storage/metadata.js';

describe('stable launcher setup compatibility', () => {
  it('setup plan still resolves repo root while stable MCP command is launcher-safe', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-stable-'));
    try {
      const plan = resolveSetupPlan(repo, { allAgents: true });
      const mcp = resolveStableMcpConfig(plan.repositoryRoot, '/tmp/install/current/app/code-intel/core/dist/cli/main.js');
      assert.equal(plan.repositoryRoot, repo);
      assert.equal(mcp.command, path.resolve('/tmp/install/bin/code-intel'));
      assert.deepEqual(mcp.args, ['mcp', repo]);
      assert.match(resolveStableHookCommand('claude', '/tmp/install/current/app/code-intel/core/dist/cli/main.js'), /hook claude$/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('metadata paths remain repo-local and independent from bundled install root', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-stable-'));
    try {
      saveMetadata(repo, {
        indexedAt: new Date().toISOString(),
        schemaVersion: 3,
        indexVersion: 'test',
        parser: 'tree-sitter',
        stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
      });
      const metaPath = path.join(repo, '.code-intel', 'meta.json');
      fs.writeFileSync(getDbPath(repo), 'graph');
      fs.writeFileSync(path.join(repo, '.code-intel', 'bm25.db'), 'bm25');
      fs.writeFileSync(getVectorDbPath(repo), 'vector');
      assert.ok(getDbPath(repo).includes(path.join(repo, '.code-intel')));
      assert.ok(metaPath.includes(path.join(repo, '.code-intel')));
      assert.ok(loadMetadata(repo));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
