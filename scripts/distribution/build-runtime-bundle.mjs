#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildRuntimeManifest, validateRuntimeManifest } from './runtime-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const DEFAULT_ARCHIVE_MTIME = '2024-01-01T00:00:00.000Z';

const TARGETS = {
  'linux-x64': {
    platform: 'linux',
    arch: 'x64',
    extension: 'tar.gz',
    nodeArchive: ({ version }) => `node-v${version}-linux-x64.tar.gz`,
    nodeUrl: ({ version }) => `https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.gz`,
    nodeSubdir: ({ version }) => `node-v${version}-linux-x64`,
    nodeBinary: ['bin', 'node'],
    ladybugPackages: ['@ladybugdb/core', '@ladybugdb/core-linux-x64'],
    onnxDir: path.join('node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'linux', 'x64'),
  },
  'linux-arm64': {
    platform: 'linux',
    arch: 'arm64',
    extension: 'tar.gz',
    nodeArchive: ({ version }) => `node-v${version}-linux-arm64.tar.gz`,
    nodeUrl: ({ version }) => `https://nodejs.org/dist/v${version}/node-v${version}-linux-arm64.tar.gz`,
    nodeSubdir: ({ version }) => `node-v${version}-linux-arm64`,
    nodeBinary: ['bin', 'node'],
    ladybugPackages: ['@ladybugdb/core-linux-arm64'],
    onnxDir: path.join('node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'linux', 'arm64'),
  },
  'darwin-x64': {
    platform: 'darwin',
    arch: 'x64',
    extension: 'tar.gz',
    nodeArchive: ({ version }) => `node-v${version}-darwin-x64.tar.gz`,
    nodeUrl: ({ version }) => `https://nodejs.org/dist/v${version}/node-v${version}-darwin-x64.tar.gz`,
    nodeSubdir: ({ version }) => `node-v${version}-darwin-x64`,
    nodeBinary: ['bin', 'node'],
    ladybugPackages: ['@ladybugdb/core-darwin-x64'],
    onnxDir: null,
  },
  'darwin-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    extension: 'tar.gz',
    nodeArchive: ({ version }) => `node-v${version}-darwin-arm64.tar.gz`,
    nodeUrl: ({ version }) => `https://nodejs.org/dist/v${version}/node-v${version}-darwin-arm64.tar.gz`,
    nodeSubdir: ({ version }) => `node-v${version}-darwin-arm64`,
    nodeBinary: ['bin', 'node'],
    ladybugPackages: ['@ladybugdb/core-darwin-arm64'],
    onnxDir: path.join('node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'darwin', 'arm64'),
  },
};

function parseArgs(argv) {
  const read = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    target: read('--target') || `${process.platform}-${process.arch}`,
    outDir: path.resolve(repoRoot, read('--out-dir') || path.join('dist', 'runtime-bundles')),
    archiveMtime: read('--archive-mtime') || DEFAULT_ARCHIVE_MTIME,
    writeManifestOnly: argv.includes('--write-manifest-only'),
    skipArchive: argv.includes('--skip-archive'),
    skipNodeDownload: argv.includes('--skip-node-download'),
    nodeRuntimeDir: read('--node-runtime-dir'),
    smokeTest: argv.includes('--smoke-test'),
    json: argv.includes('--json'),
  };
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function mkdirp(target) {
  fs.mkdirSync(target, { recursive: true });
}

function copyFileWithDirs(source, target) {
  mkdirp(path.dirname(target));
  fs.copyFileSync(source, target);
}

function copyDir(source, target) {
  mkdirp(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dst = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dst);
    } else if (entry.isFile()) {
      copyFileWithDirs(src, dst);
    }
  }
}

function copyFiles(relPaths, destinationRoot) {
  for (const relPath of relPaths) {
    copyFileWithDirs(path.join(repoRoot, relPath), path.join(destinationRoot, relPath));
  }
}

function rel(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function archiveFileName(productVersion, targetKey, extension) {
  return `code-intel-runtime-v${productVersion}-${targetKey}.${extension}`;
}

function copyCurrentSelector(installRoot, version) {
  const currentPath = path.join(installRoot, 'current');
  try { fs.unlinkSync(currentPath); } catch {}
  fs.symlinkSync(path.join('versions', version), currentPath, 'dir');
}

function listRequiredNativeRelPaths(target) {
  const relPaths = [];
  for (const packageName of target.ladybugPackages) {
    const dir = path.join('node_modules', packageName);
    if (!fs.existsSync(path.join(repoRoot, dir))) {
      throw new Error(`Missing required native package for ${target.platform}-${target.arch}: ${dir}`);
    }
    for (const file of fs.readdirSync(path.join(repoRoot, dir))) {
      const full = path.join(repoRoot, dir, file);
      if (fs.statSync(full).isFile()) relPaths.push(path.join(dir, file));
    }
  }
  if (target.onnxDir) {
    if (!fs.existsSync(path.join(repoRoot, target.onnxDir))) {
      throw new Error(`Missing required ONNX runtime directory for ${target.platform}-${target.arch}: ${target.onnxDir}`);
    }
    for (const file of fs.readdirSync(path.join(repoRoot, target.onnxDir))) {
      const full = path.join(repoRoot, target.onnxDir, file);
      if (fs.statSync(full).isFile()) relPaths.push(path.join(target.onnxDir, file));
    }
  }
  return relPaths.sort();
}

function downloadFile(url, destination) {
  mkdirp(path.dirname(destination));
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        response.resume();
        return;
      }
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function ensureNodeRuntime(targetKey, target, nodeVersion, options) {
  if (options.nodeRuntimeDir) return path.resolve(options.nodeRuntimeDir);
  if (options.skipNodeDownload) throw new Error('Missing --node-runtime-dir while --skip-node-download is set');

  const cacheRoot = path.join(os.homedir(), '.cache', 'code-intel', 'node-runtimes');
  const archiveName = target.nodeArchive({ version: nodeVersion });
  const archivePath = path.join(cacheRoot, archiveName);
  const extractRoot = path.join(cacheRoot, `${targetKey}-${nodeVersion}`);
  const extractedDir = path.join(extractRoot, target.nodeSubdir({ version: nodeVersion }));
  const nodeBinary = path.join(extractedDir, ...target.nodeBinary);

  if (fs.existsSync(nodeBinary)) return extractedDir;
  if (!fs.existsSync(archivePath)) {
    await downloadFile(target.nodeUrl({ version: nodeVersion }), archivePath);
  }

  rmrf(extractRoot);
  mkdirp(extractRoot);
  execFileSync('tar', ['-xzf', archivePath, '-C', extractRoot], { stdio: 'inherit' });
  if (!fs.existsSync(nodeBinary)) {
    throw new Error(`Downloaded Node runtime missing binary: ${nodeBinary}`);
  }
  return extractedDir;
}

function createArchive(versionRoot, archivePath, archiveMtime) {
  mkdirp(path.dirname(archivePath));
  const parent = path.dirname(versionRoot);
  const name = path.basename(versionRoot);
  execFileSync('tar', [
    '--sort=name',
    '--mtime', archiveMtime,
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-czf', archivePath,
    '-C', parent,
    name,
  ], { stdio: 'inherit' });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function writeChecksums(targetPaths, outputPath) {
  const lines = targetPaths
    .filter(Boolean)
    .map((filePath) => `${sha256File(filePath)}  ${path.basename(filePath)}`)
    .sort();
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function collectSbomComponents() {
  const packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const packages = Object.entries(packageLock.packages || {})
    .filter(([key, value]) => key && value && typeof value === 'object')
    .map(([key, value]) => ({
      type: 'library',
      name: key.replace(/^node_modules\//, ''),
      version: value.version || null,
      license: value.license || null,
      optional: Boolean(value.optional),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return packages;
}

function writeSbom(runtimeManifest, outputPath) {
  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      timestamp: DEFAULT_ARCHIVE_MTIME,
      component: {
        type: 'application',
        name: 'code-intel-runtime',
        version: runtimeManifest.product.version,
        purl: `pkg:generic/code-intel-runtime@${runtimeManifest.product.version}`,
      },
      properties: [
        { name: 'code-intel:commitSha', value: runtimeManifest.product.commitSha || '' },
        { name: 'code-intel:target', value: runtimeManifest.bundleBuild.target },
      ],
    },
    components: collectSbomComponents(),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
}

function writeProvenance(runtimeManifest, outputPath, subjects) {
  const provenance = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: subjects.map((filePath) => ({ name: path.basename(filePath), digest: { sha256: sha256File(filePath) } })),
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://github.com/vohongtho/code-intel-platform/scripts/distribution/build-runtime-bundle.mjs',
        externalParameters: {
          version: runtimeManifest.product.version,
          commitSha: runtimeManifest.product.commitSha || '',
          target: runtimeManifest.bundleBuild.target,
          nodeVersion: runtimeManifest.bundledNode.pinnedVersion,
        },
      },
      runDetails: {
        builder: { id: 'local-build-runtime-bundle' },
      },
    },
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
}

function bundleManifestForTarget(manifest, targetKey, nativeRelPaths) {
  return {
    ...manifest,
    bundleBuild: {
      target: targetKey,
      archive: archiveFileName(manifest.product.version, targetKey, TARGETS[targetKey].extension),
      nativeRelPaths,
    },
  };
}

function runSmokeTest(versionRoot, manifest) {
  const bundleRoot = path.join(versionRoot, 'app');
  const cli = path.join(bundleRoot, 'code-intel/core/dist/cli/main.js');
  const versionOut = execFileSync(process.execPath, [cli, '--version'], {
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-bundle-smoke-')),
    encoding: 'utf8',
    env: {
      ...process.env,
      CODE_INTEL_GLOBAL_DIR: path.join(os.tmpdir(), 'code-intel-bundle-smoke-global'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (versionOut !== manifest.product.version) {
    throw new Error(`Bundle smoke test version mismatch: expected ${manifest.product.version}, got ${versionOut}`);
  }
}

export async function buildRuntimeBundle(rawOptions = {}) {
  const options = { ...parseArgs([]), ...rawOptions };
  const targetKey = options.target;
  const target = TARGETS[targetKey];
  if (!target) throw new Error(`Unsupported target: ${targetKey}`);

  const manifest = buildRuntimeManifest();
  validateRuntimeManifest(manifest);
  const nodeVersion = String(manifest.bundledNode.pinnedVersion).replace(/^v/, '');
  const nativeRelPaths = listRequiredNativeRelPaths(target);
  const runtimeManifest = bundleManifestForTarget(manifest, targetKey, nativeRelPaths);
  const nodeRuntimeDir = await ensureNodeRuntime(targetKey, target, nodeVersion, options);

  const versionRoot = path.join(options.outDir, 'versions', runtimeManifest.product.version, targetKey);
  const installRoot = path.join(options.outDir, 'install-root', targetKey);
  const installedVersionRoot = path.join(installRoot, 'versions', runtimeManifest.product.version);
  const runtimeRoot = path.join(versionRoot, 'runtime');
  const appRoot = path.join(versionRoot, 'app');
  const manifestPath = path.join(versionRoot, 'runtime-manifest.json');
  const archivePath = path.join(options.outDir, archiveFileName(runtimeManifest.product.version, targetKey, target.extension));
  const checksumPath = path.join(options.outDir, `${archiveFileName(runtimeManifest.product.version, targetKey, target.extension)}.sha256`);
  const sbomPath = path.join(options.outDir, `${archiveFileName(runtimeManifest.product.version, targetKey, target.extension)}.sbom.cdx.json`);
  const provenancePath = path.join(options.outDir, `${archiveFileName(runtimeManifest.product.version, targetKey, target.extension)}.provenance.json`);

  rmrf(versionRoot);
  rmrf(installedVersionRoot);
  mkdirp(versionRoot);
  copyDir(nodeRuntimeDir, runtimeRoot);
  copyFiles(runtimeManifest.bundleInputs.files, appRoot);
  fs.writeFileSync(manifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');

  mkdirp(path.join(installRoot, 'versions'));
  copyDir(versionRoot, installedVersionRoot);
  copyCurrentSelector(installRoot, runtimeManifest.product.version);

  if (!options.writeManifestOnly && options.smokeTest) runSmokeTest(versionRoot, runtimeManifest);
  if (!options.writeManifestOnly && !options.skipArchive) createArchive(versionRoot, archivePath, options.archiveMtime);
  writeSbom(runtimeManifest, sbomPath);
  writeProvenance(runtimeManifest, provenancePath, [manifestPath, ...(options.skipArchive ? [] : [archivePath]), sbomPath]);
  writeChecksums([manifestPath, options.skipArchive ? null : archivePath, sbomPath, provenancePath], checksumPath);

  return {
    target: targetKey,
    versionRoot,
    installRoot,
    runtimeManifestPath: manifestPath,
    archivePath: options.skipArchive ? null : archivePath,
    checksumPath,
    sbomPath,
    provenancePath,
    nodeRuntimeDir,
    copiedFiles: runtimeManifest.bundleInputs.files.length,
    nativeFiles: nativeRelPaths.length,
  };
}

async function main(argv) {
  const result = await buildRuntimeBundle(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === __filename) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
