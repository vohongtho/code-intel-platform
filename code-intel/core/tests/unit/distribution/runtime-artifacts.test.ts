import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '../../../../../..');

async function loadBuildRuntimeBundle() {
  const mod = await import(`${pathToFileURL(path.join(repoRoot, 'scripts/distribution/build-runtime-bundle.mjs')).href}?t=${Date.now()}`) as {
    buildRuntimeBundle: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  return mod.buildRuntimeBundle;
}

function makeFakeNodeRuntime(root: string): string {
  const runtimeDir = path.join(root, 'node-vtest-linux-x64');
  fs.mkdirSync(path.join(runtimeDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'bin', 'node'), '#!/bin/sh\nexec node "$@"\n', { mode: 0o755 });
  return runtimeDir;
}

describe('runtime bundle supply-chain artifacts', () => {
  it('writes checksum, sbom, provenance artifacts', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-artifacts-'));
    try {
      const buildRuntimeBundle = await loadBuildRuntimeBundle();
      const result = await buildRuntimeBundle({
        target: 'linux-x64',
        outDir: tmpDir,
        nodeRuntimeDir: makeFakeNodeRuntime(tmpDir),
        archiveMtime: '2024-01-01T00:00:00.000Z',
      }) as { checksumPath: string; sbomPath: string; provenancePath: string; runtimeManifestPath: string };
      assert.ok(fs.existsSync(result.checksumPath));
      assert.ok(fs.existsSync(result.sbomPath));
      assert.ok(fs.existsSync(result.provenancePath));
      const checksum = fs.readFileSync(result.checksumPath, 'utf8');
      assert.match(checksum, /runtime-manifest\.json/);
      assert.match(checksum, /sbom\.cdx\.json/);
      assert.match(checksum, /provenance\.json/);
      const sbom = JSON.parse(fs.readFileSync(result.sbomPath, 'utf8')) as { bomFormat: string; metadata: { component: { version: string } } };
      assert.equal(sbom.bomFormat, 'CycloneDX');
      assert.ok(sbom.metadata.component.version);
      const provenance = JSON.parse(fs.readFileSync(result.provenancePath, 'utf8')) as { predicateType: string; subject: Array<{ name: string }> };
      assert.equal(provenance.predicateType, 'https://slsa.dev/provenance/v1');
      assert.ok(provenance.subject.some((entry) => entry.name === path.basename(result.runtimeManifestPath)));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
