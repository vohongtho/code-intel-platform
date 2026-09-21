import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { CURRENT_SCHEMA_VERSION } from '../migrations/migration-runner.js';
import { loadBundledRuntimeMetadata } from './runtime-metadata.js';

const DEFAULT_INSTALL_ROOT = process.env['CODE_INTEL_INSTALL_ROOT']?.trim() || path.join(os.homedir(), '.local', 'share', 'code-intel');
const DEFAULT_DATA_ROOT = process.env['CODE_INTEL_GLOBAL_DIR']?.trim() || path.join(os.homedir(), '.code-intel');
const STABLE_LAUNCHER_NAME = process.platform === 'win32' ? 'code-intel.cmd' : 'code-intel';
const INSTALL_MARKER_BASENAME = 'install-owner.json';
const DATA_MARKER_BASENAME = 'runtime-owner.json';

export interface InstalledRuntimeVersion {
  version: string;
  current: boolean;
  pinned: boolean;
  path: string;
  manifestPath: string;
  target?: string;
  appVersion?: string;
  commitSha?: string;
  schemaVersion?: number | null;
}

export interface RuntimeInstallState {
  installRoot: string;
  versionsRoot: string;
  currentPath: string;
  pinFile: string;
  launcherPath: string;
  installMarkerPath: string;
  dataRoot: string;
  dataMarkerPath: string;
}

interface RuntimeInstallMarker {
  version: 1;
  installRoot: string;
  versionsRoot: string;
  currentPath: string;
  pinFile: string;
  launcherPath: string;
  dataRoot: string;
  dataMarkerPath: string;
  managedPaths: string[];
}

export interface RuntimeUpgradeOptions {
  archive: string;
  checksum?: string;
  checksumFile?: string;
  installRoot?: string;
  tempRoot?: string;
  expectedVersion?: string;
  skipPathCheck?: boolean;
  scriptPath?: string;
}

export interface RuntimeUpgradeResult {
  installRoot: string;
  version: string;
  archivePath: string;
  archiveSha: string;
  manifestPath: string;
  liveVersionRoot: string;
  launcherPath: string;
  versionOutput: string;
  pathConflicts: Array<{ path: string; resolved: string }>;
  cleanedVersions: string[];
}

export interface RuntimeUninstallOptions {
  purgeData?: boolean;
  dataRoot?: string;
  scriptPath?: string;
}

export interface RuntimeUninstallPreview {
  installRoot: string;
  managedPaths: string[];
  dataRoot: string;
  dataInventory: string[];
}

export interface RuntimeUninstallResult extends RuntimeUninstallPreview {
  purgedData: boolean;
  removedPaths: string[];
}

function resolveDefaultInstallRoot(scriptPath = process.argv[1] ?? ''): string {
  const runtime = loadBundledRuntimeMetadata(scriptPath);
  const currentRoot = runtime.currentRoot ? path.resolve(runtime.currentRoot) : path.resolve(process.env['CODE_INTEL_BUNDLED_CURRENT_ROOT'] || path.join(DEFAULT_INSTALL_ROOT, 'current'));
  return path.resolve(path.dirname(currentRoot));
}

export function resolveRuntimeInstallState(scriptPath = process.argv[1] ?? '', installRoot?: string): RuntimeInstallState {
  const root = path.resolve(installRoot || resolveDefaultInstallRoot(scriptPath));
  const dataRoot = path.resolve(DEFAULT_DATA_ROOT);
  return {
    installRoot: root,
    versionsRoot: path.join(root, 'versions'),
    currentPath: path.join(root, 'current'),
    pinFile: path.join(root, 'pinned-version.json'),
    launcherPath: path.join(root, 'bin', STABLE_LAUNCHER_NAME),
    installMarkerPath: path.join(root, INSTALL_MARKER_BASENAME),
    dataRoot,
    dataMarkerPath: path.join(dataRoot, DATA_MARKER_BASENAME),
  };
}

function mkdirp(target: string): void {
  fs.mkdirSync(target, { recursive: true });
}

function rmrf(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readChecksumFile(checksumFile: string, expectedName: string): string | null {
  const lines = fs.readFileSync(checksumFile, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (!match) continue;
    if (path.basename(match[2]) === expectedName) return match[1].toLowerCase();
  }
  return null;
}

function verifyArchiveChecksum(archivePath: string, opts: RuntimeUpgradeOptions): string {
  const actual = sha256File(archivePath);
  const expected = opts.checksum?.toLowerCase() || (opts.checksumFile ? readChecksumFile(opts.checksumFile, path.basename(archivePath)) : null);
  if (!expected) throw new Error('Missing archive checksum. Provide --checksum or --checksum-file.');
  if (actual !== expected) throw new Error(`Checksum mismatch for ${archivePath}. expected ${expected}, got ${actual}`);
  return actual;
}

function extractArchive(archivePath: string, tempRoot: string): string {
  const extractDir = fs.mkdtempSync(path.join(tempRoot, 'code-intel-upgrade-'));
  execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' });
  const entries = fs.readdirSync(extractDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error(`Archive must contain exactly one top-level directory, found ${entries.length}`);
  return path.join(extractDir, entries[0].name);
}

function validateManifest(versionRoot: string): { manifestPath: string; manifest: Record<string, any> } {
  const manifestPath = path.join(versionRoot, 'runtime-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing runtime manifest: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, any>;
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

function readManifest(manifestPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readPinnedVersion(state: RuntimeInstallState): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(state.pinFile, 'utf8')) as { version?: string };
    return parsed.version?.trim() || null;
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function writePinnedVersion(state: RuntimeInstallState, version: string | null): void {
  if (!version) {
    fs.rmSync(state.pinFile, { force: true });
    return;
  }
  atomicWriteJson(state.pinFile, { version });
}

function detectPathConflicts(installRoot: string): Array<{ path: string; resolved: string }> {
  const ownLauncher = path.resolve(installRoot, 'bin', STABLE_LAUNCHER_NAME);
  const conflicts: Array<{ path: string; resolved: string }> = [];
  const segments = (process.env['PATH'] || '').split(path.delimiter).filter(Boolean);
  for (const segment of segments) {
    const candidate = path.join(segment, STABLE_LAUNCHER_NAME);
    if (!fs.existsSync(candidate)) continue;
    const resolved = fs.realpathSync(candidate);
    if (resolved !== ownLauncher) conflicts.push({ path: candidate, resolved });
  }
  return conflicts;
}

function ensureUserWritable(installRoot: string): void {
  mkdirp(installRoot);
  const probe = path.join(installRoot, `.write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (error) {
    throw new Error(`Install root is not writable: ${installRoot}. ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readInstallMarker(state: RuntimeInstallState): RuntimeInstallMarker | null {
  try {
    return JSON.parse(fs.readFileSync(state.installMarkerPath, 'utf8')) as RuntimeInstallMarker;
  } catch {
    return null;
  }
}

function writeOwnershipMarkers(state: RuntimeInstallState): void {
  mkdirp(state.installRoot);
  mkdirp(state.dataRoot);
  const installMarker: RuntimeInstallMarker = {
    version: 1,
    installRoot: state.installRoot,
    versionsRoot: state.versionsRoot,
    currentPath: state.currentPath,
    pinFile: state.pinFile,
    launcherPath: state.launcherPath,
    dataRoot: state.dataRoot,
    dataMarkerPath: state.dataMarkerPath,
    managedPaths: [
      state.currentPath,
      state.versionsRoot,
      state.pinFile,
      state.launcherPath,
      state.installMarkerPath,
    ],
  };
  atomicWriteJson(state.installMarkerPath, installMarker);
  atomicWriteJson(state.dataMarkerPath, {
    version: 1,
    installRoot: state.installRoot,
    dataRoot: state.dataRoot,
  });
}

export function listInstalledRuntimeVersions(scriptPath = process.argv[1] ?? '', installRoot?: string): InstalledRuntimeVersion[] {
  const state = resolveRuntimeInstallState(scriptPath, installRoot);
  const pinned = readPinnedVersion(state);
  const currentReal = fs.existsSync(state.currentPath) ? fs.realpathSync(state.currentPath) : null;
  if (!fs.existsSync(state.versionsRoot)) return [];
  return fs.readdirSync(state.versionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const versionRoot = path.join(state.versionsRoot, entry.name);
      const manifestPath = path.join(versionRoot, 'runtime-manifest.json');
      const manifest = readManifest(manifestPath);
      return {
        version: entry.name,
        current: currentReal === fs.realpathSync(versionRoot),
        pinned: pinned === entry.name,
        path: versionRoot,
        manifestPath,
        target: typeof manifest?.bundleBuild === 'object' && manifest?.bundleBuild && 'target' in manifest.bundleBuild ? String((manifest.bundleBuild as { target?: string }).target) : undefined,
        appVersion: typeof manifest?.product === 'object' && manifest?.product && 'version' in manifest.product ? String((manifest.product as { version?: string }).version) : undefined,
        commitSha: typeof manifest?.product === 'object' && manifest?.product && 'commitSha' in manifest.product ? String((manifest.product as { commitSha?: string }).commitSha) : undefined,
        schemaVersion: typeof manifest?.schemaCompatibility === 'object' && manifest?.schemaCompatibility && 'currentSchemaVersion' in manifest.schemaCompatibility
          ? Number((manifest.schemaCompatibility as { currentSchemaVersion?: number }).currentSchemaVersion ?? null)
          : null,
      } satisfies InstalledRuntimeVersion;
    })
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
}

function switchCurrentVersion(state: RuntimeInstallState, version: string): void {
  const target = path.join(state.versionsRoot, version);
  if (!fs.existsSync(target)) throw new Error(`Installed runtime version not found: ${version}`);
  const nextLink = path.join(state.installRoot, `.current-next-${process.pid}`);
  try { fs.unlinkSync(nextLink); } catch {}
  fs.symlinkSync(path.join('versions', version), nextLink, 'dir');
  fs.renameSync(nextLink, state.currentPath);
}

function checkRollbackCompatibility(version: InstalledRuntimeVersion): void {
  if (version.schemaVersion && version.schemaVersion < CURRENT_SCHEMA_VERSION) {
    throw new Error(`Runtime ${version.version} declares schema v${version.schemaVersion}, current data expects v${CURRENT_SCHEMA_VERSION}. Re-run analyze after rollback.`);
  }
}

function launcherSmoke(version: InstalledRuntimeVersion): string {
  const cli = path.join(version.path, 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
  const child = spawnSync(process.execPath, [cli, '--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.status !== 0) {
    throw new Error(`Runtime ${version.version} failed smoke test: ${child.stderr || child.stdout}`);
  }
  return child.stdout.trim();
}

export function pinRuntimeVersion(version: string, scriptPath = process.argv[1] ?? '', installRoot?: string): InstalledRuntimeVersion {
  const state = resolveRuntimeInstallState(scriptPath, installRoot);
  const versions = listInstalledRuntimeVersions(scriptPath, installRoot);
  const selected = versions.find((entry) => entry.version === version);
  if (!selected) throw new Error(`Installed runtime version not found: ${version}`);
  writePinnedVersion(state, version);
  return selected;
}

export function rollbackRuntimeVersion(version?: string, scriptPath = process.argv[1] ?? '', installRoot?: string): InstalledRuntimeVersion {
  const state = resolveRuntimeInstallState(scriptPath, installRoot);
  const versions = listInstalledRuntimeVersions(scriptPath, installRoot);
  const current = versions.find((entry) => entry.current);
  const selected = version
    ? versions.find((entry) => entry.version === version)
    : versions.filter((entry) => !entry.current).at(-1);
  if (!selected) throw new Error(version ? `Installed runtime version not found: ${version}` : 'No rollback candidate available');
  if (current && current.version === selected.version) return selected;
  checkRollbackCompatibility(selected);
  launcherSmoke(selected);
  switchCurrentVersion(state, selected.version);
  writeOwnershipMarkers(state);
  return selected;
}

export function cleanupRuntimeVersions(scriptPath = process.argv[1] ?? '', installRoot?: string): string[] {
  const state = resolveRuntimeInstallState(scriptPath, installRoot);
  const versions = listInstalledRuntimeVersions(scriptPath, installRoot);
  const pinned = readPinnedVersion(state);
  const current = versions.find((entry) => entry.current)?.version;
  const previous = versions.filter((entry) => entry.version !== current).at(-1)?.version;
  const keep = new Set([current, pinned, previous].filter(Boolean));
  const removed: string[] = [];
  for (const version of versions) {
    if (keep.has(version.version)) continue;
    fs.rmSync(version.path, { recursive: true, force: true });
    removed.push(version.version);
  }
  return removed;
}

export function installRuntimeUpgrade(options: RuntimeUpgradeOptions): RuntimeUpgradeResult {
  const archivePath = path.resolve(options.archive);
  if (!fs.existsSync(archivePath)) throw new Error(`Archive not found: ${archivePath}`);
  const state = resolveRuntimeInstallState(options.scriptPath, options.installRoot);
  ensureUserWritable(state.installRoot);
  if (!fs.existsSync(state.launcherPath)) {
    throw new Error(`Stable launcher not found: ${state.launcherPath}. Reinstall before running bundled upgrade.`);
  }
  const archiveSha = verifyArchiveChecksum(archivePath, options);
  const extractedRoot = extractArchive(archivePath, path.resolve(options.tempRoot || os.tmpdir()));
  const { manifestPath, manifest } = validateManifest(extractedRoot);
  const version = String(manifest?.product?.version || '').trim();
  if (!version) throw new Error(`Manifest missing product.version: ${manifestPath}`);
  if (options.expectedVersion && options.expectedVersion !== version) {
    throw new Error(`Archive version mismatch. expected ${options.expectedVersion}, got ${version}`);
  }
  const stagedVersionRoot = path.join(state.versionsRoot, `.staging-${version}-${process.pid}`);
  rmrf(stagedVersionRoot);
  mkdirp(path.dirname(stagedVersionRoot));
  fs.renameSync(extractedRoot, stagedVersionRoot);
  const smoke = launcherSmoke({ version, current: false, pinned: false, path: stagedVersionRoot, manifestPath });
  const liveVersionRoot = path.join(state.versionsRoot, version);
  rmrf(liveVersionRoot);
  fs.renameSync(stagedVersionRoot, liveVersionRoot);
  switchCurrentVersion(state, version);
  writeOwnershipMarkers(state);
  const cleanedVersions = cleanupRuntimeVersions(options.scriptPath, state.installRoot);
  return {
    installRoot: state.installRoot,
    version,
    archivePath,
    archiveSha,
    manifestPath: path.join(liveVersionRoot, 'runtime-manifest.json'),
    liveVersionRoot,
    launcherPath: state.launcherPath,
    versionOutput: smoke,
    pathConflicts: options.skipPathCheck ? [] : detectPathConflicts(state.installRoot),
    cleanedVersions,
  };
}

function resolveDataRootForPurge(state: RuntimeInstallState, requestedDataRoot?: string): string {
  const marker = readInstallMarker(state);
  const expected = path.resolve(requestedDataRoot || marker?.dataRoot || state.dataRoot);
  const markerDataRoot = marker?.dataRoot ? path.resolve(marker.dataRoot) : null;
  if (!marker || !markerDataRoot || markerDataRoot !== expected) {
    throw new Error(`Refusing to purge data outside owned Code Intel root: ${expected}`);
  }
  const dataMarkerPath = path.join(expected, DATA_MARKER_BASENAME);
  if (!fs.existsSync(dataMarkerPath)) {
    throw new Error(`Missing ownership marker for purge target: ${dataMarkerPath}`);
  }
  return expected;
}

export function previewRuntimeUninstall(options: RuntimeUninstallOptions = {}): RuntimeUninstallPreview {
  const state = resolveRuntimeInstallState(options.scriptPath);
  const marker = readInstallMarker(state);
  const managedPaths = (marker?.managedPaths || [state.currentPath, state.versionsRoot, state.pinFile, state.launcherPath, state.installMarkerPath])
    .map((value) => path.resolve(value))
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort();
  const dataRoot = options.purgeData ? resolveDataRootForPurge(state, options.dataRoot) : path.resolve(options.dataRoot || marker?.dataRoot || state.dataRoot);
  const dataInventory = fs.existsSync(dataRoot) ? fs.readdirSync(dataRoot).sort() : [];
  return {
    installRoot: state.installRoot,
    managedPaths,
    dataRoot,
    dataInventory,
  };
}

function removeIfEmpty(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  if (!fs.statSync(dirPath).isDirectory()) return;
  if (fs.readdirSync(dirPath).length === 0) fs.rmdirSync(dirPath);
}

export function uninstallRuntime(options: RuntimeUninstallOptions = {}): RuntimeUninstallResult {
  const state = resolveRuntimeInstallState(options.scriptPath);
  const preview = previewRuntimeUninstall(options);
  const removedPaths: string[] = [];
  for (const target of preview.managedPaths.sort((a, b) => b.length - a.length)) {
    if (!target.startsWith(`${state.installRoot}${path.sep}`) && target !== state.installMarkerPath) continue;
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removedPaths.push(target);
  }
  removeIfEmpty(path.join(state.installRoot, 'bin'));
  removeIfEmpty(state.installRoot);

  let purgedData = false;
  if (options.purgeData) {
    rmrf(preview.dataRoot);
    purgedData = true;
  }

  return {
    ...preview,
    purgedData,
    removedPaths,
  };
}
