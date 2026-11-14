#!/usr/bin/env node
/**
 * Build `code-intel-runtime-index-v1.json`, the single attested subject of a
 * runtime release. It names every per-target archive and sidecar by file name,
 * size and SHA-256. Output is deterministic (sorted targets, fixed key order).
 *
 * Format owner: code-intel/core/src/cli/runtime-bundle-index.ts (parser).
 *
 * Usage:
 *   node scripts/distribution/build-runtime-index.mjs [--bundle-dir dist/runtime-bundles]
 *     [--version 1.0.12] [--commit <sha>] [--repository owner/name] [--workflow .github/workflows/publish.yml]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');

export const RUNTIME_INDEX_FILENAME = 'code-intel-runtime-index-v1.json';
export const RUNTIME_INDEX_ATTESTATION_FILENAME = 'code-intel-runtime-index-v1.sigstore.json';
// First installer that understands verification scheme v1.
const MINIMUM_INSTALLER_VERSION = '1.0.12';
const ARCHIVE = /^code-intel-runtime-v(.+)-((?:linux|darwin)-(?:x64|arm64))\.tar\.gz$/;
const SIDECARS = { checksum: '.sha256', sbom: '.sbom.cdx.json', provenance: '.provenance.json' };

function parseArgs(argv) {
  const read = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    bundleDir: path.resolve(repoRoot, read('--bundle-dir') || path.join('dist', 'runtime-bundles')),
    version: read('--version'),
    commit: read('--commit'),
    repository: read('--repository') || process.env['GITHUB_REPOSITORY'] || 'vohongtho/code-intel-platform',
    workflow: read('--workflow') || '.github/workflows/publish.yml',
  };
}

function fileEntry(dir, name) {
  const filePath = path.join(dir, name);
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`missing runtime release file: ${name}`);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  return { name, size: stat.size, sha256 };
}

export function buildRuntimeIndex(options) {
  const version = options.version || JSON.parse(fs.readFileSync(path.join(repoRoot, 'code-intel/core/package.json'), 'utf8')).version;
  const commit = options.commit || process.env['GITHUB_SHA'] || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const targets = fs.readdirSync(options.bundleDir)
    .map((name) => ({ name, match: name.match(ARCHIVE) }))
    .filter(({ match }) => match)
    .map(({ name, match }) => {
      if (match[1] !== version) throw new Error(`${name} does not belong to release ${version}`);
      return {
        target: match[2],
        archive: fileEntry(options.bundleDir, name),
        checksum: fileEntry(options.bundleDir, `${name}${SIDECARS.checksum}`),
        sbom: fileEntry(options.bundleDir, `${name}${SIDECARS.sbom}`),
        provenance: fileEntry(options.bundleDir, `${name}${SIDECARS.provenance}`),
      };
    })
    .sort((a, b) => a.target.localeCompare(b.target));
  if (targets.length === 0) throw new Error(`no runtime archives for ${version} in ${options.bundleDir}`);
  return {
    schema: 'code-intel-runtime-index',
    schemaVersion: 1,
    verificationScheme: 'sigstore-github-attestation-v1',
    release: { version, tag: `v${version}`, commit },
    identity: { repository: options.repository, workflow: options.workflow },
    minimumInstallerVersion: MINIMUM_INSTALLER_VERSION,
    targets,
  };
}

if (process.argv[1] === __filename) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const index = buildRuntimeIndex(options);
    const out = path.join(options.bundleDir, RUNTIME_INDEX_FILENAME);
    fs.writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ index: out, targets: index.targets.map((t) => t.target) }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
