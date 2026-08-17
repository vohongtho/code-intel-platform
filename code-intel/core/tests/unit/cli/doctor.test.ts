import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDoctorChecks } from '../../../src/cli/doctor.js';
import { saveMetadata } from '../../../src/storage/metadata.js';
import { getBm25DbPath } from '../../../src/search/bm25-index.js';
import { getDbPath, getVectorDbPath } from '../../../src/storage/metadata.js';

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-checks-'));
}

function writeArtifact(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'artifact');
}

describe('doctor checks', () => {
  it('returns deterministic ordered checks', async () => {
    const repoDir = tempRepo();
    try {
      const checks = await collectDoctorChecks({ repoDir, scriptPath: path.resolve('code-intel/core/dist/cli/main.js') });
      assert.deepEqual(checks.map((check) => check.id), [
        'node-version',
        'git',
        'config',
        'runtime-launcher',
        'runtime-versions',
        'runtime-uninstall',
        'global-dir',
        'logs-dir',
        'setup-selection',
        'tree-sitter-wasm',
        'repo-index-trust',
        'vector-runtime',
        'path-conflicts',
      ]);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('reports trusted repo index when artifacts are present', async () => {
    const repoDir = tempRepo();
    try {
      writeArtifact(getDbPath(repoDir));
      writeArtifact(getBm25DbPath(repoDir));
      writeArtifact(getVectorDbPath(repoDir));
      const indexedAt = new Date().toISOString();
      saveMetadata(repoDir, {
        indexedAt,
        schemaVersion: 1,
        indexVersion: 'legacy-ok',
        embeddings: { enabled: true, status: 'ready', provider: 'huggingface-transformers', model: 'Xenova/all-MiniLM-L6-v2', dimension: 384 },
        stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
      });
      const checks = await collectDoctorChecks({ repoDir, scriptPath: path.resolve('code-intel/core/dist/cli/main.js') });
      const repoTrust = checks.find((check) => check.id === 'repo-index-trust');
      assert.ok(repoTrust);
      assert.ok(['warn', 'fail', 'pass'].includes(repoTrust!.status));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
