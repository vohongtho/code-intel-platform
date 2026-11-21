#!/usr/bin/env node
/**
 * Runtime release asset gate.
 *
 * 1. Every file named by the runtime index exists with the indexed size/SHA-256,
 *    and every runtime archive/sidecar in the directory is named by the index
 *    (no unindexed or missing release files).
 * 2. With --verify-attestation: the index attestation verifies offline against
 *    the pinned Sigstore trusted root and the pinned release identity, using the
 *    same code path as `code-intel upgrade --bundle-dir`. Requires a built core.
 *
 * Usage: node scripts/verify-runtime-release-assets.mjs [bundleDir] [--verify-attestation] [--trusted-root <file>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const bundleDir = path.resolve(repoRoot, args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--trusted-root') || 'dist/runtime-bundles');
const trustedRootArg = args.includes('--trusted-root') ? args[args.indexOf('--trusted-root') + 1] : null;
const trustedRootPath = path.resolve(trustedRootArg || path.join(repoRoot, 'scripts/distribution/trust/sigstore-public-good-trusted-root.json'));

const INDEX = 'code-intel-runtime-index-v1.json';
const ATTESTATION = 'code-intel-runtime-index-v1.sigstore.json';
const RUNTIME_FILE = /^code-intel-runtime-v.+\.tar\.gz(\.sha256|\.sbom\.cdx\.json|\.provenance\.json)?$/;

const failures = [];
const indexPath = path.join(bundleDir, INDEX);
if (!fs.existsSync(indexPath)) {
  console.error(`✗ ${INDEX} missing from ${bundleDir}`);
  process.exit(1);
}
const indexBytes = fs.readFileSync(indexPath);
const index = JSON.parse(indexBytes.toString('utf8'));

const indexed = new Set();
for (const target of index.targets ?? []) {
  for (const role of ['archive', 'checksum', 'sbom', 'provenance']) {
    const entry = target[role];
    indexed.add(entry.name);
    const filePath = path.join(bundleDir, entry.name);
    if (!fs.existsSync(filePath)) {
      failures.push(`${target.target}/${role}: ${entry.name} is indexed but not present`);
      continue;
    }
    const bytes = fs.readFileSync(filePath);
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.size || sha !== entry.sha256) failures.push(`${entry.name}: size/sha256 differ from the index`);
  }
}
for (const name of fs.readdirSync(bundleDir)) {
  if (RUNTIME_FILE.test(name) && !indexed.has(name)) failures.push(`${name} is a runtime release file but is not in the index`);
}
if (!fs.existsSync(path.join(bundleDir, ATTESTATION))) failures.push(`${ATTESTATION} missing`);

if (args.includes('--verify-attestation') && failures.length === 0) {
  const dist = path.join(repoRoot, 'code-intel/core/dist/cli');
  const { parseRuntimeBundleIndex } = await import(pathToFileURL(path.join(dist, 'runtime-bundle-index.js')).href);
  const { verifyRuntimeIndexAttestation } = await import(pathToFileURL(path.join(dist, 'runtime-trust.js')).href);
  try {
    const release = verifyRuntimeIndexAttestation({
      attestation: fs.readFileSync(path.join(bundleDir, ATTESTATION)),
      indexBytes,
      index: parseRuntimeBundleIndex(indexBytes),
      trustedRoot: fs.readFileSync(trustedRootPath),
    });
    console.log(`✓ attestation verified offline: ${release.workflowIdentity}`);
  } catch (error) {
    failures.push(`attestation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(`✓ ${index.targets.length} runtime target(s) match ${INDEX} one-to-one`);
