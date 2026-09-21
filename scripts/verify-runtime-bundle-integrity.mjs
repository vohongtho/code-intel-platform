#!/usr/bin/env node
/**
 * Runtime bundle integrity gate (tasks 5.2 / 5.3 / 5.4 / 5.5).
 *
 * `build-runtime-bundle.mjs` already generates `.sha256` / `.sbom.cdx.json` /
 * `.provenance.json` sidecars per archive. Prior release CI only asserted
 * those files were *present* (`ls` non-empty) — it never proved the checksum
 * actually matches the archive bytes, or that the SBOM/provenance content
 * identifies the correct product version and target, or that the archive
 * actually CONTAINS the runtime assets it's supposed to. This script closes
 * those gaps: recomputing/parsing each sidecar against the archive it
 * describes, and listing (not extracting — cheap, no disk churn) the
 * archive's own contents to assert the required paths are present.
 *
 * Usage: node scripts/verify-runtime-bundle-integrity.mjs [bundleDir]
 *   bundleDir defaults to dist/runtime-bundles
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const bundleDir = path.resolve(repoRoot, process.argv[2] || 'dist/runtime-bundles');

const corePkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'code-intel/core/package.json'), 'utf8'));
const expectedVersion = corePkg.version;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

if (!fs.existsSync(bundleDir)) {
  console.error(`✗ bundle directory does not exist: ${bundleDir}`);
  process.exit(1);
}

const archives = fs.readdirSync(bundleDir).filter((name) => name.endsWith('.tar.gz') || name.endsWith('.zip'));
if (archives.length === 0) {
  console.error(`✗ no runtime archives found in ${bundleDir}`);
  process.exit(1);
}

const failures = [];

for (const archiveName of archives) {
  const archivePath = path.join(bundleDir, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const sbomPath = `${archivePath}.sbom.cdx.json`;
  const provenancePath = `${archivePath}.provenance.json`;

  console.log(`\n=== ${archiveName} ===`);

  // Expected target key from the versioned archive filename, e.g.
  // code-intel-runtime-v1.0.11-linux-x64.tar.gz -> linux-x64
  const targetMatch = archiveName.match(/^code-intel-runtime-v(.+)-([a-z]+-[a-z0-9]+)\.(tar\.gz|zip)$/);
  if (!targetMatch) {
    failures.push(`${archiveName}: does not match expected archive naming convention code-intel-runtime-v<version>-<target>.<ext>`);
    continue;
  }
  const [, archiveVersion, targetKey] = targetMatch;
  if (archiveVersion !== expectedVersion) {
    failures.push(`${archiveName}: archive filename version "${archiveVersion}" != package.json version "${expectedVersion}"`);
  }

  // Content inventory (task 5.2): list (not extract) the archive and assert
  // required paths are present. The install-time launcher itself is NOT
  // shipped inside the archive (it's copied from scripts/distribution/launcher/
  // at install time — see install-runtime.mjs), so this checks the
  // entrypoint/bundled-Node/Web/grammar/workflow/manifest content the
  // archive itself is actually responsible for.
  if (archiveName.endsWith('.tar.gz')) {
    let entries;
    try {
      entries = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
    } catch (error) {
      failures.push(`${archiveName}: failed to list archive contents — ${error instanceof Error ? error.message : String(error)}`);
      entries = [];
    }
    const requiredSuffixes = [
      ['bundled Node runtime binary', '/runtime/bin/node'],
      ['runtime manifest', '/runtime-manifest.json'],
      ['Core dist entrypoint', '/app/code-intel/core/dist/cli/main.js'],
      ['Core package.json', '/app/code-intel/core/package.json'],
      ['Web UI index.html', '/app/code-intel/core/dist/web/index.html'],
      ['Shared dist', '/app/code-intel/shared/dist/index.js'],
    ];
    for (const [label, suffix] of requiredSuffixes) {
      if (!entries.some((e) => e.endsWith(suffix))) failures.push(`${archiveName}: missing ${label} (expected a path ending in "${suffix}")`);
    }
    if (!entries.some((e) => /\/app\/code-intel\/core\/dist\/wasm\/.+\.wasm$/.test(e))) {
      failures.push(`${archiveName}: no bundled grammar .wasm files found under dist/wasm/`);
    }
    if (!entries.some((e) => /\/app\/code-intel\/core\/dist\/agents\/workflows\/assets\/.+\.md$/.test(e))) {
      failures.push(`${archiveName}: no bundled workflow markdown assets found under dist/agents/workflows/assets/`);
    }
    if (failures.length === 0 || !failures.some((f) => f.startsWith(archiveName))) {
      console.log(`  ✓ archive contains entrypoint, bundled Node, dist/web, grammars, and workflow assets (${entries.length} entries)`);
    }
  } else {
    console.log(`  (skipping content inventory for non-.tar.gz archive: ${archiveName})`);
  }

  // .sha256
  if (!fs.existsSync(checksumPath)) {
    failures.push(`${archiveName}: missing .sha256 sidecar`);
  } else {
    const checksumContent = fs.readFileSync(checksumPath, 'utf8');
    const line = checksumContent.split('\n').find((l) => l.trim().endsWith(archiveName));
    if (!line) {
      failures.push(`${archiveName}: .sha256 does not contain an entry for the archive itself`);
    } else {
      const recordedHash = line.trim().split(/\s+/)[0];
      const actualHash = sha256File(archivePath);
      if (recordedHash !== actualHash) {
        failures.push(`${archiveName}: sha256 mismatch — recorded ${recordedHash}, actual ${actualHash}`);
      } else {
        console.log(`  ✓ sha256 matches archive bytes (${actualHash})`);
      }
    }
  }

  // .sbom.cdx.json
  if (!fs.existsSync(sbomPath)) {
    failures.push(`${archiveName}: missing .sbom.cdx.json sidecar`);
  } else {
    try {
      const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
      const sbomVersion = sbom?.metadata?.component?.version;
      const sbomTarget = sbom?.metadata?.properties?.find((p) => p.name === 'code-intel:target')?.value;
      if (sbomVersion !== expectedVersion) {
        failures.push(`${archiveName}: SBOM component version "${sbomVersion}" != expected "${expectedVersion}"`);
      } else if (sbomTarget !== targetKey) {
        failures.push(`${archiveName}: SBOM target "${sbomTarget}" != expected "${targetKey}"`);
      } else {
        console.log(`  ✓ SBOM parses and matches version/target (${sbomVersion}, ${sbomTarget})`);
      }
    } catch (error) {
      failures.push(`${archiveName}: SBOM failed to parse — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // .provenance.json
  if (!fs.existsSync(provenancePath)) {
    failures.push(`${archiveName}: missing .provenance.json sidecar`);
  } else {
    try {
      const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
      const params = provenance?.predicate?.buildDefinition?.externalParameters;
      const provenanceVersion = params?.version;
      const provenanceTarget = params?.target;
      if (provenanceVersion !== expectedVersion) {
        failures.push(`${archiveName}: provenance version "${provenanceVersion}" != expected "${expectedVersion}"`);
      } else if (provenanceTarget !== targetKey) {
        failures.push(`${archiveName}: provenance target "${provenanceTarget}" != expected "${targetKey}"`);
      } else {
        const archiveSubject = provenance?.subject?.find((s) => s.name === archiveName);
        if (!archiveSubject) {
          failures.push(`${archiveName}: provenance subject list does not include the archive itself`);
        } else if (archiveSubject.digest?.sha256 !== sha256File(archivePath)) {
          failures.push(`${archiveName}: provenance subject digest does not match archive bytes`);
        } else {
          console.log(`  ✓ provenance parses, matches version/target (${provenanceVersion}, ${provenanceTarget}) and archive digest`);
        }
      }
    } catch (error) {
      failures.push(`${archiveName}: provenance failed to parse — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (failures.length > 0) {
  console.error('\n✗ Runtime bundle integrity check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`\n✓ All ${archives.length} runtime archive(s) have verified checksums, SBOM and provenance.`);
