import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { CURRENT_SCHEMA_VERSION } from '../migrations/migration-runner.js';
import { loadBundledRuntimeMetadata } from './runtime-metadata.js';
import { preflightRuntimeArchive } from './runtime-archive-preflight.js';
import {
  RUNTIME_INDEX_ATTESTATION_FILENAME,
  RUNTIME_INDEX_FILENAME,
  RUNTIME_INDEX_LIMITS,
  RuntimeTrustError,
  compareRuntimeVersions,
  parseRuntimeBundleIndex,
  selectRuntimeIndexTarget,
  sha256Hex,
  type RuntimeIndexFile,
} from './runtime-bundle-index.js';
import {
  PINNED_TRUSTED_ROOT_RELPATH,
  buildChecksumReceipt,
  buildVerifiedReceipt,
  inspectRuntimeTrust,
  runWithNetworkDenied,
  verifyRuntimeIndexAttestation,
  writeTrustReceipt,
  type RuntimeAuthenticity,
  type RuntimeIndexAttestationVerifier,
  type RuntimeTrustReceipt,
  type TrustRootSource,
  type VerifiedRuntimeRelease,
} from './runtime-trust.js';

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
  authenticity?: RuntimeAuthenticity;
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
  authenticity: RuntimeAuthenticity;
}

export interface RuntimeBundleUpgradeOptions {
  bundleDir: string;
  offline?: boolean;
  target?: string;
  /** Operator-supplied Sigstore trusted root; default is the root pinned in the running runtime. */
  trustedRoot?: string;
  installRoot?: string;
  tempRoot?: string;
  skipPathCheck?: boolean;
  scriptPath?: string;
  /** Version of the running installer, checked against the index's minimumInstallerVersion. */
  installerVersion?: string;
  /** Test seam; production always uses the pinned Sigstore verifier. */
  attestationVerifier?: RuntimeIndexAttestationVerifier;
}

export interface RuntimeBundleUpgradeResult extends RuntimeUpgradeResult {
  offline: boolean;
  networkAttempts: number | null;
  target: string;
  release: VerifiedRuntimeRelease & { trustRootSource: TrustRootSource };
  optionalAssets: Array<{ id: string; status: 'not-bundled'; message: string }>;
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

function verifyArchiveChecksum(archivePath: string, opts: RuntimeUpgradeOptions, archiveName: string): string {
  const actual = sha256File(archivePath);
  const expected = opts.checksum?.toLowerCase() || (opts.checksumFile ? readChecksumFile(opts.checksumFile, archiveName) : null);
  if (!expected) throw new Error('Missing archive checksum. Provide --checksum or --checksum-file.');
  if (actual !== expected) throw new Error(`Checksum mismatch for ${archiveName}. expected ${expected}, got ${actual}`);
  return actual;
}

// Only call after preflightRuntimeArchive() approved this exact file.
function extractArchive(archivePath: string, workDir: string): string {
  const extractDir = path.join(workDir, 'extract');
  mkdirp(extractDir);
  execFileSync('tar', ['-xzf', archivePath, '-C', extractDir, '--no-same-owner'], { stdio: 'inherit' });
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
        authenticity: inspectRuntimeTrust(versionRoot).authenticity,
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

function launcherSmoke(version: InstalledRuntimeVersion, env?: NodeJS.ProcessEnv): string {
  const cli = path.join(version.path, 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
  const child = spawnSync(process.execPath, [cli, '--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
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

interface ActivateArchiveArgs {
  state: RuntimeInstallState;
  archivePath: string;
  privateArchive: string;
  archiveSha: string;
  workDir: string;
  expectedVersion?: string;
  expectedTarget?: string;
  receipt: (version: string, target: string) => RuntimeTrustReceipt;
  skipPathCheck?: boolean;
  scriptPath?: string;
  smokeEnv?: NodeJS.ProcessEnv;
}

/**
 * Shared install transaction. Every check runs against a private copy of the
 * archive; the receipt is written into the staged version only after
 * validation, and any failure removes staging and leaves current/pinned alone.
 */
async function activateRuntimeArchive(args: ActivateArchiveArgs): Promise<RuntimeUpgradeResult> {
  const { state } = args;
  await preflightRuntimeArchive(args.privateArchive);
  const extractedRoot = extractArchive(args.privateArchive, args.workDir);
  const { manifestPath, manifest } = validateManifest(extractedRoot);
  const version = String(manifest?.product?.version || '').trim();
  if (!version) throw new Error(`Manifest missing product.version: ${manifestPath}`);
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) throw new Error(`Manifest product.version is not a safe directory name: ${version}`);
  if (args.expectedVersion && args.expectedVersion !== version) {
    throw new Error(`Archive version mismatch. expected ${args.expectedVersion}, got ${version}`);
  }
  const target = String(manifest?.bundleBuild?.target || '').trim();
  if (args.expectedTarget && args.expectedTarget !== target) {
    throw new Error(`Archive target mismatch. expected ${args.expectedTarget}, got ${target || 'none'}`);
  }
  const receipt = args.receipt(version, target);
  const stagedVersionRoot = path.join(state.versionsRoot, `.staging-${version}-${process.pid}`);
  rmrf(stagedVersionRoot);
  mkdirp(path.dirname(stagedVersionRoot));
  let smoke: string;
  try {
    fs.renameSync(extractedRoot, stagedVersionRoot);
    smoke = launcherSmoke({ version, current: false, pinned: false, path: stagedVersionRoot, manifestPath }, args.smokeEnv);
    writeTrustReceipt(stagedVersionRoot, receipt);
  } catch (error) {
    rmrf(stagedVersionRoot);
    throw error;
  }
  const liveVersionRoot = path.join(state.versionsRoot, version);
  rmrf(liveVersionRoot);
  fs.renameSync(stagedVersionRoot, liveVersionRoot);
  switchCurrentVersion(state, version);
  writeOwnershipMarkers(state);
  const cleanedVersions = cleanupRuntimeVersions(args.scriptPath, state.installRoot);
  return {
    installRoot: state.installRoot,
    version,
    archivePath: args.archivePath,
    archiveSha: args.archiveSha,
    manifestPath: path.join(liveVersionRoot, 'runtime-manifest.json'),
    liveVersionRoot,
    launcherPath: state.launcherPath,
    versionOutput: smoke,
    pathConflicts: args.skipPathCheck ? [] : detectPathConflicts(state.installRoot),
    cleanedVersions,
    authenticity: receipt.authenticity,
  };
}

function prepareInstall(scriptPath: string | undefined, installRoot: string | undefined, tempRoot: string | undefined) {
  const state = resolveRuntimeInstallState(scriptPath, installRoot);
  ensureUserWritable(state.installRoot);
  if (!fs.existsSync(state.launcherPath)) {
    throw new Error(`Stable launcher not found: ${state.launcherPath}. Reinstall before running bundled upgrade.`);
  }
  // mkdtemp creates the directory 0700, so the private archive copy cannot be swapped by other users.
  const workDir = fs.mkdtempSync(path.join(path.resolve(tempRoot || os.tmpdir()), 'code-intel-upgrade-'));
  return { state, workDir };
}

/** Checksum-only upgrade (v1.0.11 contract). Records `legacy-checksum`, never `verified`. */
export async function installRuntimeUpgrade(options: RuntimeUpgradeOptions): Promise<RuntimeUpgradeResult> {
  const archivePath = path.resolve(options.archive);
  if (!fs.existsSync(archivePath)) throw new Error(`Archive not found: ${archivePath}`);
  const { state, workDir } = prepareInstall(options.scriptPath, options.installRoot, options.tempRoot);
  try {
    const privateArchive = path.join(workDir, 'runtime.tar.gz');
    fs.copyFileSync(archivePath, privateArchive);
    const archiveSha = verifyArchiveChecksum(privateArchive, options, path.basename(archivePath));
    return await activateRuntimeArchive({
      state,
      archivePath,
      privateArchive,
      archiveSha,
      workDir,
      expectedVersion: options.expectedVersion,
      receipt: (version, target) => buildChecksumReceipt(version, target, archiveSha),
      skipPathCheck: options.skipPathCheck,
      scriptPath: options.scriptPath,
    });
  } finally {
    rmrf(workDir);
  }
}

/** Read a file named by the bundle index from the bundle directory, refusing links and size drift. */
function readBundleFile(bundleDir: string, name: string, maxBytes: number): Buffer {
  const filePath = path.join(bundleDir, name);
  if (path.dirname(filePath) !== bundleDir) throw new RuntimeTrustError('ARTIFACT_MISMATCH', `refusing nested bundle path ${name}`);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new RuntimeTrustError(name === RUNTIME_INDEX_ATTESTATION_FILENAME ? 'ATTESTATION_MISSING' : 'ARTIFACT_MISSING', `${name} not found in ${bundleDir}`);
  }
  if (!stat.isFile()) throw new RuntimeTrustError('ARTIFACT_MISMATCH', `${name} is not a regular file`);
  if (stat.size > maxBytes) throw new RuntimeTrustError('ARTIFACT_MISMATCH', `${name} exceeds ${maxBytes} bytes`);
  return fs.readFileSync(filePath);
}

function checkIndexedBytes(file: RuntimeIndexFile, bytes: Buffer): void {
  if (bytes.length !== file.size || sha256Hex(bytes) !== file.sha256) {
    throw new RuntimeTrustError('ARTIFACT_MISMATCH', `${file.name} does not match the authenticated release index`);
  }
}

function resolveTrustedRoot(options: RuntimeBundleUpgradeOptions): { bytes: Buffer; source: TrustRootSource } {
  if (options.trustedRoot) {
    const file = path.resolve(options.trustedRoot);
    return { bytes: readBundleFile(path.dirname(file), path.basename(file), 1024 * 1024), source: 'operator' };
  }
  const runtime = loadBundledRuntimeMetadata(options.scriptPath);
  const pinned = runtime.currentRoot ? path.join(runtime.currentRoot, PINNED_TRUSTED_ROOT_RELPATH) : null;
  if (!pinned || !fs.existsSync(pinned)) {
    throw new RuntimeTrustError('TRUST_ROOT_MISSING', 'the running runtime has no pinned Sigstore trusted root; authenticity cannot be established. Pass --trusted-root <file> obtained from a trusted channel.');
  }
  return { bytes: fs.readFileSync(pinned), source: 'pinned' };
}

/**
 * Authenticated upgrade from a release bundle directory (`--bundle-dir`). All
 * material is read from that directory only. With `offline`, every network
 * primitive is denied for the whole transaction and the smoke test runs with
 * update checks disabled.
 */
export async function installRuntimeFromBundle(options: RuntimeBundleUpgradeOptions): Promise<RuntimeBundleUpgradeResult> {
  const run = async (): Promise<Omit<RuntimeBundleUpgradeResult, 'networkAttempts'>> => {
    const bundleDir = path.resolve(options.bundleDir);
    if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) throw new Error(`Bundle directory not found: ${bundleDir}`);
    const indexBytes = readBundleFile(bundleDir, RUNTIME_INDEX_FILENAME, RUNTIME_INDEX_LIMITS.maxIndexBytes);
    const index = parseRuntimeBundleIndex(indexBytes);
    const attestation = readBundleFile(bundleDir, RUNTIME_INDEX_ATTESTATION_FILENAME, RUNTIME_INDEX_LIMITS.maxAttestationBytes);
    const trustedRoot = resolveTrustedRoot(options);
    const release = (options.attestationVerifier ?? verifyRuntimeIndexAttestation)({ attestation, indexBytes, index, trustedRoot: trustedRoot.bytes });

    const installerVersion = options.installerVersion ?? loadBundledRuntimeMetadata(options.scriptPath).manifest?.product?.version;
    if (installerVersion && compareRuntimeVersions(installerVersion, index.minimumInstallerVersion) < 0) {
      throw new RuntimeTrustError('INSTALLER_TOO_OLD', `release ${index.release.tag} requires installer ${index.minimumInstallerVersion}; running ${installerVersion}`);
    }
    const selected = selectRuntimeIndexTarget(index, options.target ?? `${process.platform}-${process.arch}`);

    const sidecarMax = 64 * 1024 * 1024;
    const checksum = readBundleFile(bundleDir, selected.checksum.name, sidecarMax);
    checkIndexedBytes(selected.checksum, checksum);
    checkIndexedBytes(selected.sbom, readBundleFile(bundleDir, selected.sbom.name, sidecarMax));
    const provenance = readBundleFile(bundleDir, selected.provenance.name, sidecarMax);
    checkIndexedBytes(selected.provenance, provenance);
    const listed = checksum.toString('utf8').split(/\r?\n/).some((line) => line === `${selected.archive.sha256}  ${selected.archive.name}`);
    let provenanceSubjects: Array<{ name?: string; digest?: { sha256?: string } }> = [];
    try {
      provenanceSubjects = (JSON.parse(provenance.toString('utf8')) as { subject?: typeof provenanceSubjects }).subject ?? [];
    } catch { /* reported below */ }
    const attested = provenanceSubjects.some((s) => s.name === selected.archive.name && s.digest?.sha256 === selected.archive.sha256);
    if (!listed || !attested) throw new RuntimeTrustError('ARTIFACT_MISMATCH', 'checksum or provenance sidecar disagrees with the release index');

    const archivePath = path.join(bundleDir, selected.archive.name);
    const archiveStat = fs.lstatSync(archivePath, { throwIfNoEntry: false });
    if (!archiveStat) throw new RuntimeTrustError('ARTIFACT_MISSING', `${selected.archive.name} not found in ${bundleDir}`);
    if (!archiveStat.isFile()) throw new RuntimeTrustError('ARTIFACT_MISMATCH', `${selected.archive.name} is not a regular file`);

    const { state, workDir } = prepareInstall(options.scriptPath, options.installRoot, options.tempRoot);
    try {
      const privateArchive = path.join(workDir, 'runtime.tar.gz');
      fs.copyFileSync(archivePath, privateArchive);
      const archiveSha = sha256File(privateArchive);
      if (fs.statSync(privateArchive).size !== selected.archive.size || archiveSha !== selected.archive.sha256) {
        throw new RuntimeTrustError('ARTIFACT_MISMATCH', `${selected.archive.name} does not match the authenticated release index`);
      }
      const result = await activateRuntimeArchive({
        state,
        archivePath,
        privateArchive,
        archiveSha,
        workDir,
        expectedVersion: index.release.version,
        expectedTarget: selected.target,
        receipt: (version, target) => buildVerifiedReceipt({ version, target, artifactSha256: archiveSha, indexBytes, release, trustRootSource: trustedRoot.source }),
        skipPathCheck: options.skipPathCheck,
        scriptPath: options.scriptPath,
        smokeEnv: options.offline ? { ...process.env, UPDATE_CHECK_DISABLED: '1' } : undefined,
      });
      return {
        ...result,
        offline: Boolean(options.offline),
        target: selected.target,
        release: { ...release, trustRootSource: trustedRoot.source },
        optionalAssets: [{
          id: 'embedding-model-cache',
          status: 'not-bundled',
          message: 'Embedding models are not part of the runtime bundle; see `code-intel doctor` (vector-runtime) for readiness.',
        }],
      };
    } finally {
      rmrf(workDir);
    }
  };

  if (!options.offline) return { ...(await run()), networkAttempts: null };
  // Denied calls throw inside the transaction, so a reported count > 0 means a
  // caller swallowed the error; nothing was fetched either way.
  const { result, networkAttempts } = await runWithNetworkDenied(run);
  return { ...result, networkAttempts };
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
