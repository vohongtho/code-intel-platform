#!/usr/bin/env node
/**
 * Release metadata consistency gate (tasks 1.1 / 3.4).
 *
 * The `code-intel/core/package.json` version is treated as the single
 * source of truth for "what version is this release candidate" — every
 * other place that carries a version number MUST agree with it. This
 * intentionally never hardcodes a version string so the check keeps working
 * unchanged across future releases.
 *
 * Checks:
 *   - package-lock.json workspace entry for code-intel/core
 *   - `code-intel --version` output of the already-built dist (run the
 *     authoritative product build first)
 *   - scripts/distribution/runtime-manifest.mjs --json product.version
 *
 * npm tarball version is checked separately by
 * code-intel/core/scripts/validate-dist.mjs, which already has to unpack the
 * tarball for content validation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

const failures = [];

const corePkg = readJson('code-intel/core/package.json');
const expectedVersion = corePkg.version;
console.log(`Expected release version (from code-intel/core/package.json): ${expectedVersion}`);

const lockfile = readJson('package-lock.json');
const lockedVersion = lockfile.packages?.['code-intel/core']?.version;
if (lockedVersion !== expectedVersion) {
  failures.push(`package-lock.json workspace version "${lockedVersion}" != package.json version "${expectedVersion}"`);
} else {
  console.log(`✓ package-lock.json workspace version matches (${lockedVersion})`);
}

const cliEntry = path.join(repoRoot, 'code-intel/core/dist/cli/main.js');
if (!fs.existsSync(cliEntry)) {
  failures.push(`${cliEntry} does not exist — run the product build before verifying release metadata`);
} else {
  const cliVersion = execFileSync('node', [cliEntry, '--version'], { encoding: 'utf8' }).trim();
  if (cliVersion !== expectedVersion) {
    failures.push(`code-intel --version reported "${cliVersion}", expected "${expectedVersion}"`);
  } else {
    console.log(`✓ code-intel --version matches (${cliVersion})`);
  }
}

try {
  const manifestJson = execFileSync('node', [path.join(repoRoot, 'scripts/distribution/runtime-manifest.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const manifest = JSON.parse(manifestJson);
  const manifestVersion = manifest?.product?.version;
  if (manifestVersion !== expectedVersion) {
    failures.push(`runtime manifest product.version "${manifestVersion}" != package.json version "${expectedVersion}"`);
  } else {
    console.log(`✓ runtime manifest product.version matches (${manifestVersion})`);
  }
} catch (error) {
  failures.push(`failed to generate/parse runtime manifest: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length > 0) {
  console.error('\n✗ Release metadata is inconsistent:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\n✓ All release metadata sources agree on the version.');
