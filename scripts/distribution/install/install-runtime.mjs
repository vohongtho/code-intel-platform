#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_INSTALL_ROOT = process.env['CODE_INTEL_INSTALL_ROOT']?.trim() || path.join(os.homedir(), '.local', 'share', 'code-intel');
const STABLE_LAUNCHER_NAME = process.platform === 'win32' ? 'code-intel.cmd' : 'code-intel';

function parseArgs(argv) {
  const read = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    archive: read('--archive'),
    checksumFile: read('--checksum-file'),
    checksum: read('--checksum'),
    installRoot: path.resolve(read('--install-root') || DEFAULT_INSTALL_ROOT),
    tempRoot: path.resolve(read('--temp-root') || os.tmpdir()),
    yes: argv.includes('--yes'),
    json: argv.includes('--json'),
    skipPathCheck: argv.includes('--skip-path-check'),
  };
}

function mkdirp(target) {
  fs.mkdirSync(target, { recursive: true });
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readChecksumFile(checksumFile, expectedName) {
  const lines = fs.readFileSync(checksumFile, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (!match) continue;
    if (path.basename(match[2]) === expectedName) return match[1].toLowerCase();
  }
  return null;
}

function verifyArchiveChecksum(archivePath, opts) {
  const actual = sha256File(archivePath);
  const expected = opts.checksum?.toLowerCase() || (opts.checksumFile ? readChecksumFile(opts.checksumFile, path.basename(archivePath)) : null);
  if (!expected) {
    throw new Error('Missing archive checksum. Provide --checksum or --checksum-file.');
  }
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${archivePath}. expected ${expected}, got ${actual}`);
  }
  return actual;
}

function extractArchive(archivePath, tempRoot) {
  const extractDir = fs.mkdtempSync(path.join(tempRoot, 'code-intel-install-'));
  execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' });
  const entries = fs.readdirSync(extractDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error(`Archive must contain exactly one top-level directory, found ${entries.length}`);
  return path.join(extractDir, entries[0].name);
}

function validateManifest(versionRoot) {
  const manifestPath = path.join(versionRoot, 'runtime-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing runtime manifest: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const required = [
    path.join(versionRoot, 'runtime', 'bin', 'node'),
    path.join(versionRoot, 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js'),
    path.join(versionRoot, 'app', 'code-intel', 'core', 'dist', 'web', 'index.html'),
  ];
  for (const filePath of required) {
    if (!fs.existsSync(filePath)) throw new Error(`Missing required bundle file: ${filePath}`);
  }
  return { manifestPath, manifest };
}

function smokeTest(versionRoot) {
  const cli = path.join(versionRoot, 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
  const child = spawnSync(process.execPath, [cli, '--version'], {
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-install-smoke-')),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.status !== 0) {
    throw new Error(`Launcher smoke test failed: ${child.stderr || child.stdout}`);
  }
  return child.stdout.trim();
}

function detectPathConflicts(installRoot) {
  const ownLauncher = path.resolve(installRoot, 'bin', STABLE_LAUNCHER_NAME);
  const conflicts = [];
  const segments = (process.env['PATH'] || '').split(path.delimiter).filter(Boolean);
  for (const segment of segments) {
    const candidate = path.join(segment, STABLE_LAUNCHER_NAME);
    if (!fs.existsSync(candidate)) continue;
    const resolved = fs.realpathSync(candidate);
    if (resolved !== ownLauncher) {
      conflicts.push({ path: candidate, resolved });
    }
  }
  return conflicts;
}

function ensureUserWritable(installRoot) {
  mkdirp(installRoot);
  const probe = path.join(installRoot, `.write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (error) {
    throw new Error(`Install root is not writable: ${installRoot}. ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stableLauncherSource() {
  return path.join(repoRoot, 'scripts', 'distribution', 'launcher', STABLE_LAUNCHER_NAME);
}

function writeStableLauncher(installRoot) {
  const source = stableLauncherSource();
  const target = path.join(installRoot, 'bin', STABLE_LAUNCHER_NAME);
  mkdirp(path.dirname(target));
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  return target;
}

function activateVersion(installRoot, version, stagedVersionRoot) {
  const versionsRoot = path.join(installRoot, 'versions');
  const liveVersionRoot = path.join(versionsRoot, version);
  mkdirp(versionsRoot);
  rmrf(liveVersionRoot);
  fs.renameSync(stagedVersionRoot, liveVersionRoot);

  const currentLink = path.join(installRoot, 'current');
  const nextLink = path.join(installRoot, `.current-next-${process.pid}`);
  try { fs.unlinkSync(nextLink); } catch {}
  fs.symlinkSync(path.join('versions', version), nextLink, 'dir');
  fs.renameSync(nextLink, currentLink);
  return liveVersionRoot;
}

export function installRuntime(rawOptions) {
  const opts = { ...parseArgs([]), ...rawOptions };
  if (!opts.archive) throw new Error('Missing required --archive <path>');
  const archivePath = path.resolve(opts.archive);
  if (!fs.existsSync(archivePath)) throw new Error(`Archive not found: ${archivePath}`);

  ensureUserWritable(opts.installRoot);
  const archiveSha = verifyArchiveChecksum(archivePath, opts);
  const extractedRoot = extractArchive(archivePath, opts.tempRoot);
  const { manifestPath, manifest } = validateManifest(extractedRoot);
  const version = manifest?.product?.version;
  if (!version) throw new Error(`Manifest missing product.version: ${manifestPath}`);

  const stagedVersionRoot = path.join(opts.installRoot, 'versions', `.staging-${version}-${process.pid}`);
  rmrf(stagedVersionRoot);
  mkdirp(path.dirname(stagedVersionRoot));
  fs.renameSync(extractedRoot, stagedVersionRoot);

  const versionOut = smokeTest(stagedVersionRoot);
  const liveVersionRoot = activateVersion(opts.installRoot, version, stagedVersionRoot);
  const launcherPath = writeStableLauncher(opts.installRoot);
  const conflicts = opts.skipPathCheck ? [] : detectPathConflicts(opts.installRoot);

  return {
    installRoot: opts.installRoot,
    version,
    archivePath,
    archiveSha,
    manifestPath: path.join(liveVersionRoot, 'runtime-manifest.json'),
    liveVersionRoot,
    launcherPath,
    versionOutput: versionOut,
    pathConflicts: conflicts,
  };
}

function main(argv) {
  const result = installRuntime(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === __filename) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
