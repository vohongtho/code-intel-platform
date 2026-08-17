import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../../..');
const scriptPath = path.join(repoRoot, 'scripts', 'distribution', 'runtime-manifest.mjs');
const scriptUrl = pathToFileURL(scriptPath).href;

async function loadManifestModule(): Promise<{
  buildRuntimeManifest: () => unknown;
}> {
  return import(`${scriptUrl}?test=${Date.now()}`) as Promise<{ buildRuntimeManifest: () => unknown }>;
}

describe('runtime-manifest', () => {
  it('emits bundle inputs and persistent-path assertions', async () => {
    const { buildRuntimeManifest } = await loadManifestModule();
    const manifest = buildRuntimeManifest() as {
      product: { version: string; commitSha: string };
      bundleInputs: { summary: { totalFiles: number; packageDirs: number }; files: string[]; packageDirs: Array<{ packageName: string }> };
      persistentData: { assertions: Array<{ id: string; outsideVersionRoot: boolean }> };
      schemaCompatibility: { currentSchemaVersion: number | null; indexGenerationManifestVersion: number };
    };

    assert.equal(typeof manifest.product.version, 'string');
    assert.ok(manifest.product.version.length > 0);
    assert.equal(typeof manifest.product.commitSha, 'string');
    assert.ok(manifest.bundleInputs.files.includes('code-intel/core/dist/cli/main.js'));
    assert.ok(manifest.bundleInputs.files.includes('code-intel/core/dist/web/index.html'));
    assert.ok(manifest.bundleInputs.packageDirs.some((pkg) => pkg.packageName === '@ladybugdb/core'));
    assert.ok(manifest.bundleInputs.summary.totalFiles >= manifest.bundleInputs.files.length);
    assert.ok(manifest.persistentData.assertions.some((entry) => entry.id === 'global-config' && entry.outsideVersionRoot));
    assert.equal(manifest.schemaCompatibility.indexGenerationManifestVersion, 2);
    assert.equal(typeof manifest.schemaCompatibility.currentSchemaVersion, 'number');
  });

  it('validates and writes manifest output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-manifest-'));
    const outPath = path.join(tmpDir, 'runtime-manifest.json');
    try {
      execFileSync(process.execPath, [scriptPath, '--validate', '--write', outPath], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
      const written = JSON.parse(fs.readFileSync(outPath, 'utf8')) as { bundleInputs: { files: string[] } };
      assert.ok(written.bundleInputs.files.length > 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
