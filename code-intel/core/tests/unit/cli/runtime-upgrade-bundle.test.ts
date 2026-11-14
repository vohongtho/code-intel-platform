import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { installRuntimeFromBundle, installRuntimeUpgrade } from '../../../src/cli/runtime-lifecycle.js';
import { RuntimeTrustError, RUNTIME_INDEX_FILENAME, RUNTIME_INDEX_ATTESTATION_FILENAME } from '../../../src/cli/runtime-bundle-index.js';
import { inspectRuntimeTrust, type RuntimeIndexAttestationVerifier } from '../../../src/cli/runtime-trust.js';
import { buildTarGz } from './runtime-fixtures.js';

const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
const TARGET = 'linux-x64';
const WORKFLOW_IDENTITY = 'https://github.com/vohongtho/code-intel-platform/.github/workflows/publish.yml@refs/tags/v1.0.12';

interface Fixture {
  root: string;
  installRoot: string;
  bundleDir: string;
  scriptPath: string;
  /** Stand-in for Sigstore: accepts only the index bytes it "signed". Real verification is covered in runtime-trust.test.ts. */
  verifier: RuntimeIndexAttestationVerifier;
  archiveName: string;
}

function writeVersion(versionRoot: string, version: string) {
  fs.mkdirSync(path.join(versionRoot, 'app', 'code-intel', 'core', 'dist', 'cli'), { recursive: true });
  fs.mkdirSync(path.join(versionRoot, 'app', 'code-intel', 'core', 'dist', 'web'), { recursive: true });
  fs.mkdirSync(path.join(versionRoot, 'runtime', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(versionRoot, 'runtime-manifest.json'), JSON.stringify({ product: { version }, bundleBuild: { target: TARGET } }));
  fs.writeFileSync(path.join(versionRoot, 'runtime', 'bin', 'node'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(versionRoot, 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js'), `console.log('${version}')\n`);
  fs.writeFileSync(path.join(versionRoot, 'app', 'code-intel', 'core', 'dist', 'web', 'index.html'), '<html></html>\n');
}

function setup(options: { archive?: Buffer; pinTrustRoot?: boolean } = {}): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-bundle-'));
  const installRoot = path.join(root, 'install');
  writeVersion(path.join(installRoot, 'versions', '1.0.11'), '1.0.11');
  if (options.pinTrustRoot !== false) {
    fs.mkdirSync(path.join(installRoot, 'versions', '1.0.11', 'trust'), { recursive: true });
    fs.writeFileSync(path.join(installRoot, 'versions', '1.0.11', 'trust', 'sigstore-trusted-root.json'), '{}');
  }
  fs.symlinkSync(path.join('versions', '1.0.11'), path.join(installRoot, 'current'), 'dir');
  fs.mkdirSync(path.join(installRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(installRoot, 'bin', 'code-intel'), '#!/bin/sh\n', { mode: 0o755 });
  const scriptPath = path.join(installRoot, 'current', 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');

  const staging = path.join(root, 'build');
  writeVersion(path.join(staging, '1.0.12'), '1.0.12');
  const bundleDir = path.join(root, 'bundle');
  fs.mkdirSync(bundleDir);
  const archiveName = `code-intel-runtime-v1.0.12-${TARGET}.tar.gz`;
  const archivePath = path.join(bundleDir, archiveName);
  if (options.archive) fs.writeFileSync(archivePath, options.archive);
  else execFileSync('tar', ['-czf', archivePath, '-C', staging, '1.0.12']);
  const archive = fs.readFileSync(archivePath);

  const sbom = Buffer.from('{"bomFormat":"CycloneDX"}\n');
  const provenance = Buffer.from(JSON.stringify({ subject: [{ name: archiveName, digest: { sha256: sha256(archive) } }] }));
  const checksum = Buffer.from(`${sha256(archive)}  ${archiveName}\n`);
  const files = {
    archive: [archiveName, archive],
    checksum: [`${archiveName}.sha256`, checksum],
    sbom: [`${archiveName}.sbom.cdx.json`, sbom],
    provenance: [`${archiveName}.provenance.json`, provenance],
  } as const;
  for (const [name, bytes] of Object.values(files)) if (name !== archiveName) fs.writeFileSync(path.join(bundleDir, name), bytes);
  const entry = (pair: readonly [string, Buffer]) => ({ name: pair[0], size: pair[1].length, sha256: sha256(pair[1]) });
  const index = Buffer.from(JSON.stringify({
    schema: 'code-intel-runtime-index',
    schemaVersion: 1,
    verificationScheme: 'sigstore-github-attestation-v1',
    release: { version: '1.0.12', tag: 'v1.0.12', commit: 'a'.repeat(40) },
    identity: { repository: 'vohongtho/code-intel-platform', workflow: '.github/workflows/publish.yml' },
    minimumInstallerVersion: '1.0.11',
    targets: [{ target: TARGET, archive: entry(files.archive), checksum: entry(files.checksum), sbom: entry(files.sbom), provenance: entry(files.provenance) }],
  }, null, 2));
  fs.writeFileSync(path.join(bundleDir, RUNTIME_INDEX_FILENAME), index);
  fs.writeFileSync(path.join(bundleDir, RUNTIME_INDEX_ATTESTATION_FILENAME), '{"fake":"bundle"}');
  const signedDigest = sha256(index);
  const verifier: RuntimeIndexAttestationVerifier = (input) => {
    if (sha256(input.indexBytes) !== signedDigest) throw new RuntimeTrustError('ATTESTATION_INVALID', 'attestation does not cover the supplied subject digest');
    return { repository: 'vohongtho/code-intel-platform', workflowIdentity: WORKFLOW_IDENTITY, ref: 'refs/tags/v1.0.12', policyVersion: 1 };
  };
  return { root, installRoot, bundleDir, scriptPath, verifier, archiveName };
}

function install(f: Fixture, extra: Partial<Parameters<typeof installRuntimeFromBundle>[0]> = {}) {
  return installRuntimeFromBundle({
    bundleDir: f.bundleDir,
    offline: true,
    target: TARGET,
    installRoot: f.installRoot,
    tempRoot: f.root,
    skipPathCheck: true,
    scriptPath: f.scriptPath,
    installerVersion: '1.0.11',
    attestationVerifier: f.verifier,
    ...extra,
  });
}

function assertUnchanged(f: Fixture) {
  assert.equal(fs.readlinkSync(path.join(f.installRoot, 'current')), path.join('versions', '1.0.11'));
  assert.deepEqual(fs.readdirSync(path.join(f.installRoot, 'versions')).sort(), ['1.0.11']);
  assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith('code-intel-upgrade-')), false);
}

function cleanup(f: Fixture) {
  fs.rmSync(f.root, { recursive: true, force: true });
}

describe('authenticated offline runtime upgrade', () => {
  it('refuses a genuine but older signed release unless --allow-downgrade is passed', async () => {
    const f = setup();
    try {
      await assert.rejects(install(f, { installerVersion: '1.0.13' }), (error: unknown) => error instanceof RuntimeTrustError && error.code === 'DOWNGRADE_REFUSED');
      assertUnchanged(f);
      const result = await install(f, { installerVersion: '1.0.13', allowDowngrade: true });
      assert.equal(result.version, '1.0.12');
    } finally {
      cleanup(f);
    }
  });

  it('installs a valid bundle with zero network calls and records a verified receipt', async () => {
    const f = setup();
    try {
      const result = await install(f);
      assert.equal(result.authenticity, 'verified');
      assert.equal(result.networkAttempts, 0);
      assert.equal(result.release.trustRootSource, 'pinned');
      assert.equal(result.optionalAssets[0].status, 'not-bundled');
      assert.equal(fs.readlinkSync(path.join(f.installRoot, 'current')), path.join('versions', '1.0.12'));
      const trust = inspectRuntimeTrust(path.join(f.installRoot, 'versions', '1.0.12'));
      assert.equal(trust.authenticity, 'verified');
      assert.equal(trust.release?.workflowIdentity, WORKFLOW_IDENTITY);
      // Rollback target keeps its own (legacy) state; it does not borrow the new receipt.
      assert.equal(inspectRuntimeTrust(path.join(f.installRoot, 'versions', '1.0.11')).authenticity, 'legacy-checksum');
    } finally {
      cleanup(f);
    }
  });

  const tampers: Array<[string, (f: Fixture) => void, RegExp]> = [
    ['archive', (f) => fs.appendFileSync(path.join(f.bundleDir, f.archiveName), 'x'), /ARTIFACT_MISMATCH/],
    ['checksum sidecar', (f) => fs.appendFileSync(path.join(f.bundleDir, `${f.archiveName}.sha256`), 'x'), /ARTIFACT_MISMATCH/],
    ['SBOM', (f) => fs.appendFileSync(path.join(f.bundleDir, `${f.archiveName}.sbom.cdx.json`), ' '), /ARTIFACT_MISMATCH/],
    ['provenance', (f) => fs.appendFileSync(path.join(f.bundleDir, `${f.archiveName}.provenance.json`), ' '), /ARTIFACT_MISMATCH/],
    ['index', (f) => fs.appendFileSync(path.join(f.bundleDir, RUNTIME_INDEX_FILENAME), ' '), /ATTESTATION_INVALID/],
    ['missing attestation', (f) => fs.rmSync(path.join(f.bundleDir, RUNTIME_INDEX_ATTESTATION_FILENAME)), /ATTESTATION_MISSING/],
    ['symlinked SBOM', (f) => {
      const p = path.join(f.bundleDir, `${f.archiveName}.sbom.cdx.json`);
      fs.renameSync(p, `${p}.real`);
      fs.symlinkSync(`${p}.real`, p);
    }, /not a regular file/],
  ];
  for (const [label, tamper, pattern] of tampers) {
    it(`fails closed and preserves the active runtime when the ${label} is tampered`, async () => {
      const f = setup();
      try {
        tamper(f);
        await assert.rejects(install(f), pattern);
        assertUnchanged(f);
      } finally {
        cleanup(f);
      }
    });
  }

  it('blocks network access for the whole offline transaction and preserves the active runtime', async () => {
    const f = setup();
    try {
      const reachOut: RuntimeIndexAttestationVerifier = (input) => {
        // Any primitive a verifier might use to fetch fresh trust material.
        void fetch('https://tuf-repo-cdn.sigstore.dev/root.json');
        return f.verifier(input);
      };
      await assert.rejects(install(f, { attestationVerifier: reachOut }), /network access blocked in offline mode \(fetch\)/);
      assertUnchanged(f);
      // The guard is scoped to the transaction: primitives are restored afterwards.
      assert.doesNotMatch(String(globalThis.fetch), /network access blocked/);
    } finally {
      cleanup(f);
    }
  });

  it('rejects a wrong signer identity reported by the verifier', async () => {
    const f = setup();
    try {
      await assert.rejects(install(f, { attestationVerifier: () => { throw new RuntimeTrustError('IDENTITY_MISMATCH', 'wrong workflow'); } }), /IDENTITY_MISMATCH/);
      assertUnchanged(f);
    } finally {
      cleanup(f);
    }
  });

  it('rejects path traversal, link and special-entry archives before extraction', async () => {
    for (const entries of [
      [{ name: '1.0.12/runtime-manifest.json', data: '{}' }, { name: '1.0.12/../../escaped', data: 'x' }],
      [{ name: '1.0.12/l', type: '2', linkname: '../../../etc' }],
      [{ name: '1.0.12/dev', type: '3' }],
    ]) {
      const f = setup({ archive: buildTarGz(entries) });
      try {
        await assert.rejects(install(f), /ARCHIVE_UNSAFE/);
        assertUnchanged(f);
        assert.equal(fs.existsSync(path.join(f.root, 'escaped')), false);
      } finally {
        cleanup(f);
      }
    }
  });

  it('preserves the active runtime when post-extraction validation fails', async () => {
    const f = setup({ archive: buildTarGz([{ name: '1.0.12/runtime-manifest.json', data: '{"product":{"version":"1.0.12"}}' }]) });
    try {
      await assert.rejects(install(f), /Missing required bundle file/);
      assertUnchanged(f);
    } finally {
      cleanup(f);
    }
  });

  it('fails closed without a pinned or operator trusted root', async () => {
    const f = setup({ pinTrustRoot: false });
    try {
      await assert.rejects(install(f), /TRUST_ROOT_MISSING/);
      const operatorRoot = path.join(f.root, 'operator-root.json');
      fs.writeFileSync(operatorRoot, '{}');
      const result = await install(f, { trustedRoot: operatorRoot });
      assert.equal(result.release.trustRootSource, 'operator');
    } finally {
      cleanup(f);
    }
  });

  it('refuses a release that requires a newer installer', async () => {
    const f = setup();
    try {
      await assert.rejects(install(f, { installerVersion: '1.0.10' }), /INSTALLER_TOO_OLD/);
      assertUnchanged(f);
    } finally {
      cleanup(f);
    }
  });

  it('keeps the checksum-only --archive path and labels it legacy-checksum', async () => {
    const f = setup();
    try {
      const archive = path.join(f.bundleDir, f.archiveName);
      const result = await installRuntimeUpgrade({
        archive,
        checksumFile: path.join(f.bundleDir, `${f.archiveName}.sha256`),
        installRoot: f.installRoot,
        tempRoot: f.root,
        skipPathCheck: true,
        scriptPath: f.scriptPath,
      });
      assert.equal(result.authenticity, 'legacy-checksum');
      assert.equal(inspectRuntimeTrust(path.join(f.installRoot, 'versions', '1.0.12')).authenticity, 'legacy-checksum');
    } finally {
      cleanup(f);
    }
  });
});
