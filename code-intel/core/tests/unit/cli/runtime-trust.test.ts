import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {
  RUNTIME_IDENTITY_POLICY,
  buildChecksumReceipt,
  buildVerifiedReceipt,
  inspectRuntimeTrust,
  releaseIdentityPattern,
  runWithNetworkDenied,
  verifyRuntimeIndexAttestation,
  verifySigstoreAttestation,
  writeTrustReceipt,
} from '../../../src/cli/runtime-trust.js';
import { parseRuntimeBundleIndex } from '../../../src/cli/runtime-bundle-index.js';
import { sampleIndex } from './runtime-fixtures.js';

// A real GitHub Actions-signed Sigstore v0.3 bundle (npm provenance for
// @sigstore/verify@3.1.1, the same DSSE/in-toto format actions/attest-build-provenance
// emits), the Sigstore public-good trusted root, and the attested tarball itself.
const FIXTURES = path.resolve('tests/fixtures/runtime-trust');
const attestation = fs.readFileSync(path.join(FIXTURES, 'npm-provenance-bundle.json'));
const trustedRoot = fs.readFileSync(path.join(FIXTURES, 'trusted-root.json'));
const subject = fs.readFileSync(path.join(FIXTURES, 'sigstore-verify-3.1.1.tgz'));
const FIXTURE_SIGNER = '^https://github\\.com/sigstore/sigstore-js/\\.github/workflows/release\\.yml@refs/heads/main$';
const ISSUER = 'https://token.actions.githubusercontent.com';

function verifyFixture(sanPattern: string, opts: { mutate?: (bundle: any) => void; subject?: Buffer } = {}) {
  const bundle = JSON.parse(attestation.toString('utf8'));
  opts.mutate?.(bundle);
  return verifySigstoreAttestation({
    attestation: Buffer.from(JSON.stringify(bundle)),
    subject: opts.subject ?? subject,
    trustedRoot,
    sanPattern,
    issuer: ISSUER,
  });
}

describe('runtime trust: Sigstore verification', () => {
  it('verifies a real bundle end to end with every network primitive denied', async () => {
    const { result, networkAttempts } = await runWithNetworkDenied(async () => verifyFixture(FIXTURE_SIGNER));
    assert.equal(networkAttempts, 0);
    assert.match(result.subjectAlternativeName, /sigstore-js\/\.github\/workflows\/release\.yml/);
    assert.equal(result.issuer, ISSUER);
  });

  it('rejects a subject the attestation does not cover', () => {
    assert.throws(() => verifyFixture(FIXTURE_SIGNER, { subject: Buffer.concat([subject, Buffer.from('x')]) }), /does not cover the supplied subject digest/);
  });

  it('rejects the genuine bundle under the pinned Code Intel identity policy', () => {
    assert.throws(() => verifyFixture(releaseIdentityPattern()), /IDENTITY_MISMATCH/);
  });

  it('rejects a tampered DSSE payload', () => {
    assert.throws(() => verifyFixture(FIXTURE_SIGNER, { mutate: (bundle) => {
      const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
      statement.subject[0].digest.sha512 = '0'.repeat(128);
      bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
    } }), /ATTESTATION_INVALID/);
  });

  it('rejects a trusted root that does not contain the signing CA', () => {
    const emptyRoot = JSON.parse(trustedRoot.toString('utf8'));
    emptyRoot.certificateAuthorities = [];
    assert.throws(() => verifySigstoreAttestation({
      attestation, subject, trustedRoot: Buffer.from(JSON.stringify(emptyRoot)), sanPattern: FIXTURE_SIGNER, issuer: ISSUER,
    }), /ATTESTATION_INVALID/);
  });

  it('rejects malformed attestation material', () => {
    assert.throws(() => verifySigstoreAttestation({ attestation: Buffer.from('{'), subject, trustedRoot, sanPattern: FIXTURE_SIGNER, issuer: ISSUER }), /ATTESTATION_INVALID/);
  });

  it('pins the release identity to the publish workflow on version tags', () => {
    const pattern = new RegExp(releaseIdentityPattern());
    assert.ok(pattern.test('https://github.com/vohongtho/code-intel-platform/.github/workflows/publish.yml@refs/tags/v1.0.12'));
    assert.ok(!pattern.test('https://github.com/vohongtho/code-intel-platform/.github/workflows/publish.yml@refs/heads/main'));
    assert.ok(!pattern.test('https://github.com/attacker/code-intel-platform/.github/workflows/publish.yml@refs/tags/v1.0.12'));
    assert.ok(!pattern.test('https://github.com/vohongtho/code-intel-platform/.github/workflows/other.yml@refs/tags/v1.0.12'));
    assert.ok(!pattern.test('https://github.com/vohongtho/code-intel-platformX/.github/workflows/publish.yml@refs/tags/v1.0.12'));
  });

  it('rejects an index whose declared identity differs from the pinned policy before any crypto', () => {
    const index = parseRuntimeBundleIndex(Buffer.from(JSON.stringify(sampleIndex({ identity: { repository: 'attacker/fork', workflow: '.github/workflows/publish.yml' } }))));
    assert.throws(() => verifyRuntimeIndexAttestation({ attestation, indexBytes: Buffer.from('{}'), index, trustedRoot }), /IDENTITY_MISMATCH/);
  });
});

describe('runtime trust: receipts', () => {
  function versionRoot(version = '1.0.12') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-trust-'));
    fs.writeFileSync(path.join(dir, 'runtime-manifest.json'), JSON.stringify({ product: { version }, bundleBuild: { target: 'linux-x64' } }));
    return dir;
  }
  const release = {
    repository: RUNTIME_IDENTITY_POLICY.repository,
    workflowIdentity: 'https://github.com/vohongtho/code-intel-platform/.github/workflows/publish.yml@refs/tags/v1.0.12',
    ref: 'refs/tags/v1.0.12',
    policyVersion: 1,
  };

  it('reports legacy-checksum for a manifest without a receipt and unverified without a manifest', () => {
    const dir = versionRoot('1.0.11');
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-trust-empty-'));
    try {
      assert.equal(inspectRuntimeTrust(dir).authenticity, 'legacy-checksum');
      assert.equal(inspectRuntimeTrust(empty).authenticity, 'unverified');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('honors a verified receipt only for its own version and the pinned identity', () => {
    const dir = versionRoot();
    try {
      writeTrustReceipt(dir, buildVerifiedReceipt({ version: '1.0.12', target: 'linux-x64', artifactSha256: 'c'.repeat(64), indexBytes: Buffer.from('{}'), release, trustRootSource: 'pinned' }));
      const ok = inspectRuntimeTrust(dir);
      assert.equal(ok.authenticity, 'verified');
      assert.equal(ok.release?.workflowIdentity, release.workflowIdentity);

      writeTrustReceipt(dir, buildVerifiedReceipt({ version: '1.0.11', target: 'linux-x64', artifactSha256: 'c'.repeat(64), indexBytes: Buffer.from('{}'), release, trustRootSource: 'pinned' }));
      assert.equal(inspectRuntimeTrust(dir).authenticity, 'invalid');

      writeTrustReceipt(dir, { ...buildVerifiedReceipt({ version: '1.0.12', target: 'linux-x64', artifactSha256: 'c'.repeat(64), indexBytes: Buffer.from('{}'), release, trustRootSource: 'pinned' }), repository: 'attacker/fork' });
      assert.equal(inspectRuntimeTrust(dir).authenticity, 'invalid');

      writeTrustReceipt(dir, buildChecksumReceipt('1.0.12', 'linux-x64', 'c'.repeat(64)));
      assert.equal(inspectRuntimeTrust(dir).authenticity, 'legacy-checksum');

      fs.writeFileSync(path.join(dir, 'trust-receipt.json'), '{corrupt');
      assert.equal(inspectRuntimeTrust(dir).authenticity, 'invalid');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runtime trust: network guard', () => {
  it('counts and blocks attempts, then restores the primitives', async () => {
    const originalFetch = globalThis.fetch;
    const originalRequest = https.request;
    const { result, networkAttempts } = await runWithNetworkDenied(async () => {
      const outcomes: string[] = [];
      for (const attempt of [() => fetch('https://example.invalid'), () => https.request('https://example.invalid')]) {
        try { await attempt(); outcomes.push('allowed'); } catch { outcomes.push('blocked'); }
      }
      return outcomes;
    });
    assert.deepEqual(result, ['blocked', 'blocked']);
    assert.equal(networkAttempts, 2);
    assert.equal(globalThis.fetch, originalFetch);
    assert.equal(https.request, originalRequest);
  });
});
