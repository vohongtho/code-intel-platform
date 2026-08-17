#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const SUPPORTED_TARGETS = [
  { platform: 'linux', arch: 'x64', nodeTarget: 'linux-x64' },
  { platform: 'linux', arch: 'arm64', nodeTarget: 'linux-arm64' },
  { platform: 'darwin', arch: 'x64', nodeTarget: 'darwin-x64' },
  { platform: 'darwin', arch: 'arm64', nodeTarget: 'darwin-arm64' },
];

const WINDOWS_LAYOUT = {
  status: 'not-yet-supported',
  currentSelector: '<installRoot>/current.txt',
  launcherPath: '<installRoot>/bin/code-intel.cmd',
  note: 'Use a pointer file or launcher-mediated selection instead of a POSIX symlink until Windows native dependency support lands and CI passes.',
};

function relativeFromRepo(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function maybeReadFile(relPath) {
  try {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  } catch {
    return null;
  }
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) out.push(relativeFromRepo(full));
    }
  }
  return out.sort();
}

function getCurrentCommitSha() {
  const envSha = process.env['GITHUB_SHA']?.trim() || process.env['CODE_INTEL_COMMIT_SHA']?.trim();
  if (envSha) return envSha;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getCurrentSchemaVersion() {
  const source = maybeReadFile('code-intel/core/src/migrations/migration-runner.ts') ?? '';
  const matches = [...source.matchAll(/version:\s*(\d+)/g)].map((match) => Number(match[1]));
  return matches.length > 0 ? Math.max(...matches) : null;
}

function getCoreRuntimePackages(lockfile) {
  const core = lockfile.packages?.['code-intel/core'];
  if (!core) throw new Error('package-lock missing code-intel/core workspace');
  const packageEntries = Object.entries(lockfile.packages ?? {})
    .filter(([name, meta]) => (name.startsWith('node_modules/') || name.startsWith('code-intel/core/node_modules/')) && meta?.dev !== true)
    .map(([name, meta]) => ({
      packageName: name.replace(/^node_modules\//, '').replace(/^code-intel\/core\/node_modules\//, ''),
      relPath: name,
      optional: Boolean(meta?.optional),
      hasInstallScript: Boolean(meta?.hasInstallScript),
      directDependency: Object.hasOwn(core.dependencies ?? {}, name.replace(/^node_modules\//, '').replace(/^code-intel\/core\/node_modules\//, ''))
        || Object.hasOwn(core.optionalDependencies ?? {}, name.replace(/^node_modules\//, '').replace(/^code-intel\/core\/node_modules\//, '')),
    }))
    .filter((pkg) => !pkg.packageName.startsWith('@types/'))
    .sort((a, b) => a.packageName.localeCompare(b.packageName));
  return packageEntries;
}

function collectBundleInputFiles(lockfile) {
  const baseFiles = [
    ...walkFiles(path.join(repoRoot, 'code-intel/core/dist')),
    ...walkFiles(path.join(repoRoot, 'code-intel/shared/dist')),
    'code-intel/core/package.json',
    'code-intel/shared/package.json',
    'code-intel/core/README.md',
    'code-intel/core/LICENSE',
    'code-intel/shared/README.md',
    'code-intel/shared/LICENSE',
  ].filter((value, index, array) => array.indexOf(value) === index);

  const packageDirs = getCoreRuntimePackages(lockfile);
  const runtimePackageFiles = [];
  for (const pkg of packageDirs) {
    runtimePackageFiles.push(...walkFiles(path.join(repoRoot, pkg.relPath)));
  }

  return {
    packageDirs,
    files: [...new Set([...baseFiles, ...runtimePackageFiles])].sort(),
  };
}

function buildPersistentPathAssertions() {
  const versionRoot = path.join('<installRoot>', 'versions', '<version>');
  const assertions = [
    {
      id: 'global-config',
      path: '~/.code-intel/config.json',
      owner: 'user-global',
      reason: 'loadConfig/saveConfig use CODE_INTEL_GLOBAL_DIR or ~/.code-intel/config.json',
      outsideVersionRoot: true,
    },
    {
      id: 'global-logs',
      path: '~/.code-intel/logs/',
      owner: 'user-global',
      reason: 'Logger writes daily-rotating logs under ~/.code-intel/logs',
      outsideVersionRoot: true,
    },
    {
      id: 'repo-index-root',
      path: '<repo>/.code-intel/',
      owner: 'repository-local',
      reason: 'index-generation and metadata resolve published artifacts inside repo-local .code-intel',
      outsideVersionRoot: true,
    },
    {
      id: 'repo-index-generations',
      path: '<repo>/.code-intel/generations/',
      owner: 'repository-local',
      reason: 'Generation V2 stores graph.db, bm25.db, vector.db and meta.json per repository generation',
      outsideVersionRoot: true,
    },
    {
      id: 'repo-index-current',
      path: '<repo>/.code-intel/current.json',
      owner: 'repository-local',
      reason: 'Published generation selector lives under the repo, not the installed runtime tree',
      outsideVersionRoot: true,
    },
    {
      id: 'agent-targets',
      path: '<repo>/.code-intel/agent-targets.json',
      owner: 'repository-local',
      reason: 'analyze/setup persist agent integration state in repo-local metadata',
      outsideVersionRoot: true,
    },
    {
      id: 'model-cache',
      path: '~/.cache or runtime-specific HF/ORT cache outside <installRoot>/versions/<version>',
      owner: 'user-global',
      reason: 'Transformers/ONNX model assets are runtime-downloaded and must stay mutable outside immutable version directories',
      outsideVersionRoot: true,
    },
  ];

  return {
    immutableVersionRoot: versionRoot,
    mutableDataRoot: '<dataRoot>',
    assertions,
  };
}

export function buildRuntimeManifest() {
  const rootPkg = readJson('package.json');
  const corePkg = readJson('code-intel/core/package.json');
  const lockfile = readJson('package-lock.json');
  const bundleInputs = collectBundleInputFiles(lockfile);
  const schemaVersion = getCurrentSchemaVersion();

  return {
    manifestVersion: 1,
    generatedAt: new Date().toISOString(),
    product: {
      name: corePkg.name,
      displayName: 'Code Intelligence Platform',
      version: corePkg.version,
      workspaceVersion: rootPkg.version,
      commitSha: getCurrentCommitSha(),
    },
    bundledNode: {
      requiredRange: corePkg.engines?.node ?? null,
      pinnedVersion: process.env['CODE_INTEL_BUNDLED_NODE_VERSION']?.trim() || process.version,
      targets: SUPPORTED_TARGETS,
    },
    executable: {
      launcher: '<installRoot>/bin/code-intel',
      entrypoint: 'app/code-intel/core/dist/cli/main.js',
      hookEntrypoint: 'app/code-intel/core/dist/cli/hook.js',
    },
    layout: {
      installRoot: '<installRoot>',
      currentSelector: '<installRoot>/current',
      versionsRoot: '<installRoot>/versions',
      versionRoot: '<installRoot>/versions/<version>',
      bundledNodeRoot: '<installRoot>/versions/<version>/runtime',
      bundledAppRoot: '<installRoot>/versions/<version>/app',
      bundledWebRoot: '<installRoot>/versions/<version>/web',
      bundledParserRoot: '<installRoot>/versions/<version>/parsers',
      bundledNativeRoot: '<installRoot>/versions/<version>/native',
      bundledLicenseRoot: '<installRoot>/versions/<version>/licenses',
      manifestPath: '<installRoot>/versions/<version>/runtime-manifest.json',
      dataRoot: '<dataRoot>',
      windows: WINDOWS_LAYOUT,
    },
    schemaCompatibility: {
      indexGenerationManifestVersion: 2,
      currentSchemaVersion: schemaVersion,
      runtimeEntrySchema: 'code-intel/core/src/migrations/migration-runner.ts',
    },
    persistentData: buildPersistentPathAssertions(),
    bundleInputs: {
      summary: {
        totalFiles: bundleInputs.files.length,
        packageDirs: bundleInputs.packageDirs.length,
      },
      packageDirs: bundleInputs.packageDirs,
      files: bundleInputs.files,
    },
    runtimeAssets: {
      coreDist: walkFiles(path.join(repoRoot, 'code-intel/core/dist')),
      webDist: walkFiles(path.join(repoRoot, 'code-intel/web/dist')),
      bundledWebDist: walkFiles(path.join(repoRoot, 'code-intel/core/dist/web')),
      parserWasm: walkFiles(path.join(repoRoot, 'code-intel/core/dist/wasm')),
      ladybugNative: walkFiles(path.join(repoRoot, 'node_modules/@ladybugdb')),
      webTreeSitter: walkFiles(path.join(repoRoot, 'node_modules/web-tree-sitter')),
      transformers: walkFiles(path.join(repoRoot, 'node_modules/@huggingface/transformers/dist')),
      onnxruntime: walkFiles(path.join(repoRoot, 'node_modules/onnxruntime-node/bin')),
    },
    notes: {
      vectorModels: 'Model weights are not committed in-repo; runtime downloads/cache must stay under mutable user data, never under the immutable versioned runtime tree.',
      developerMode: 'Self-contained runtime is additive. Existing npm/developer workflows remain supported.',
    },
  };
}

export function validateRuntimeManifest(manifest = buildRuntimeManifest()) {
  const missing = manifest.bundleInputs.files.filter((relPath) => !fs.existsSync(path.join(repoRoot, relPath)));

  const unexpectedInstallScripts = manifest.bundleInputs.packageDirs.filter((pkg) =>
    pkg.hasInstallScript
    && pkg.directDependency
    && !pkg.optional
    && !['@ladybugdb/core'].includes(pkg.packageName),
  );

  const mutableInsideVersionRoot = manifest.persistentData.assertions.filter((entry) => !entry.outsideVersionRoot);

  const requiredCoreFiles = [
    'code-intel/core/dist/cli/main.js',
    'code-intel/core/dist/cli/app.js',
    'code-intel/core/dist/cli/hook.js',
    'code-intel/core/dist/index.js',
    'code-intel/core/dist/web/index.html',
    'code-intel/core/dist/wasm/tree-sitter-typescript.wasm',
    'code-intel/core/dist/wasm/tree-sitter-javascript.wasm',
    'code-intel/shared/dist/index.js',
    'node_modules/web-tree-sitter/debug/web-tree-sitter.wasm',
    'node_modules/@ladybugdb/core/package.json',
  ].filter((relPath) => !fs.existsSync(path.join(repoRoot, relPath)));

  if (missing.length > 0 || unexpectedInstallScripts.length > 0 || mutableInsideVersionRoot.length > 0 || requiredCoreFiles.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing files (${missing.length})`);
    if (requiredCoreFiles.length > 0) parts.push(`missing required core files (${requiredCoreFiles.length})`);
    if (unexpectedInstallScripts.length > 0) parts.push(`unexpected install scripts (${unexpectedInstallScripts.map((pkg) => pkg.packageName).join(', ')})`);
    if (mutableInsideVersionRoot.length > 0) parts.push(`persistent path invariant failed (${mutableInsideVersionRoot.map((entry) => entry.id).join(', ')})`);
    const error = new Error(`runtime manifest validation failed: ${parts.join('; ')}`);
    error.details = { missing, requiredCoreFiles, unexpectedInstallScripts, mutableInsideVersionRoot };
    throw error;
  }

  return {
    ok: true,
    totalFiles: manifest.bundleInputs.files.length,
    packageDirs: manifest.bundleInputs.packageDirs.length,
  };
}

function parseArgs(argv) {
  const args = new Set(argv);
  const writeIndex = argv.indexOf('--write');
  return {
    validate: args.has('--validate'),
    json: args.has('--json'),
    writePath: writeIndex >= 0 ? argv[writeIndex + 1] : null,
  };
}

function main(argv) {
  const options = parseArgs(argv);
  const manifest = buildRuntimeManifest();

  if (options.validate) validateRuntimeManifest(manifest);

  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  if (options.writePath) {
    const target = path.resolve(repoRoot, options.writePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, 'utf8');
  }

  if (options.json || !options.writePath) process.stdout.write(output);
}

if (process.argv[1] === __filename) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (error && typeof error === 'object' && 'details' in error) {
      process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    }
    process.exit(1);
  }
}
