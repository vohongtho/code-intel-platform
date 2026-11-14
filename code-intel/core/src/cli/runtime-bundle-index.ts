/**
 * Runtime release index (`code-intel-runtime-index-v1.json`).
 *
 * The index is the single attested subject of a runtime release: it names every
 * per-target archive and sidecar by file name, size and SHA-256. Index bytes come
 * from a release download or an offline bundle directory, so parsing is strict
 * and bounded and never trusts a value it has not checked.
 *
 * `scripts/distribution/build-runtime-index.mjs` produces this format; keep both
 * in sync.
 */
import crypto from 'node:crypto';

export const RUNTIME_INDEX_FILENAME = 'code-intel-runtime-index-v1.json';
export const RUNTIME_INDEX_ATTESTATION_FILENAME = 'code-intel-runtime-index-v1.sigstore.json';
export const RUNTIME_INDEX_SCHEMA = 'code-intel-runtime-index';
export const RUNTIME_INDEX_SCHEMA_VERSION = 1;
export const RUNTIME_VERIFICATION_SCHEME = 'sigstore-github-attestation-v1';

export const RUNTIME_INDEX_LIMITS = {
  maxIndexBytes: 256 * 1024,
  maxAttestationBytes: 1024 * 1024,
  maxTargets: 16,
  maxFileNameLength: 200,
  maxArtifactBytes: 4 * 1024 * 1024 * 1024,
} as const;

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1_OR_SHA256 = /^[a-f0-9]{40}([a-f0-9]{24})?$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SEMVER_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TARGET = /^(linux|darwin)-(x64|arm64)$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;

export type RuntimeTrustErrorCode =
  | 'INDEX_TOO_LARGE'
  | 'INDEX_MALFORMED'
  | 'INDEX_UNSUPPORTED_SCHEMA'
  | 'INDEX_UNSUPPORTED_SCHEME'
  | 'TARGET_NOT_FOUND'
  | 'INSTALLER_TOO_OLD'
  | 'DOWNGRADE_REFUSED'
  | 'ARTIFACT_MISSING'
  | 'ARTIFACT_MISMATCH'
  | 'ATTESTATION_MISSING'
  | 'ATTESTATION_INVALID'
  | 'IDENTITY_MISMATCH'
  | 'TRUST_ROOT_MISSING'
  | 'ARCHIVE_UNSAFE';

export class RuntimeTrustError extends Error {
  constructor(readonly code: RuntimeTrustErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RuntimeTrustError';
  }
}

export interface RuntimeIndexFile {
  name: string;
  size: number;
  sha256: string;
}

export interface RuntimeIndexTarget {
  target: string;
  archive: RuntimeIndexFile;
  checksum: RuntimeIndexFile;
  sbom: RuntimeIndexFile;
  provenance: RuntimeIndexFile;
}

export interface RuntimeBundleIndex {
  schema: typeof RUNTIME_INDEX_SCHEMA;
  schemaVersion: typeof RUNTIME_INDEX_SCHEMA_VERSION;
  verificationScheme: typeof RUNTIME_VERIFICATION_SCHEME;
  release: { version: string; tag: string; commit: string };
  identity: { repository: string; workflow: string };
  minimumInstallerVersion: string;
  targets: RuntimeIndexTarget[];
}

function malformed(message: string): never {
  throw new RuntimeTrustError('INDEX_MALFORMED', message);
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) malformed(`${at} must be an object`);
  return value as Record<string, unknown>;
}

function matching(value: unknown, pattern: RegExp, at: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.length > maxLength || !pattern.test(value)) malformed(`${at} is invalid`);
  return value;
}

function parseFile(value: unknown, at: string): RuntimeIndexFile {
  const raw = record(value, at);
  const size = raw['size'];
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > RUNTIME_INDEX_LIMITS.maxArtifactBytes) {
    malformed(`${at}.size is invalid`);
  }
  return {
    name: matching(raw['name'], FILE_NAME, `${at}.name`, RUNTIME_INDEX_LIMITS.maxFileNameLength),
    size,
    sha256: matching(raw['sha256'], SHA256, `${at}.sha256`),
  };
}

export function parseRuntimeBundleIndex(bytes: Buffer): RuntimeBundleIndex {
  if (bytes.length > RUNTIME_INDEX_LIMITS.maxIndexBytes) {
    throw new RuntimeTrustError('INDEX_TOO_LARGE', `index is ${bytes.length} bytes; limit is ${RUNTIME_INDEX_LIMITS.maxIndexBytes}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    malformed('index is not valid JSON');
  }
  const raw = record(parsed, 'index');
  if (raw['schema'] !== RUNTIME_INDEX_SCHEMA || raw['schemaVersion'] !== RUNTIME_INDEX_SCHEMA_VERSION) {
    throw new RuntimeTrustError('INDEX_UNSUPPORTED_SCHEMA', `expected ${RUNTIME_INDEX_SCHEMA} v${RUNTIME_INDEX_SCHEMA_VERSION}`);
  }
  if (raw['verificationScheme'] !== RUNTIME_VERIFICATION_SCHEME) {
    throw new RuntimeTrustError('INDEX_UNSUPPORTED_SCHEME', `unsupported verification scheme ${JSON.stringify(raw['verificationScheme'])?.slice(0, 80)}`);
  }
  const release = record(raw['release'], 'release');
  const identity = record(raw['identity'], 'identity');
  const targets = raw['targets'];
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > RUNTIME_INDEX_LIMITS.maxTargets) {
    malformed(`targets must contain 1-${RUNTIME_INDEX_LIMITS.maxTargets} entries`);
  }
  const version = matching(release['version'], SEMVER, 'release.version');
  const tag = matching(release['tag'], SEMVER_TAG, 'release.tag');
  if (tag !== `v${version}`) malformed('release.tag must equal v<release.version>');

  const parsedTargets = targets.map((entry, i) => {
    const t = record(entry, `targets[${i}]`);
    return {
      target: matching(t['target'], TARGET, `targets[${i}].target`),
      archive: parseFile(t['archive'], `targets[${i}].archive`),
      checksum: parseFile(t['checksum'], `targets[${i}].checksum`),
      sbom: parseFile(t['sbom'], `targets[${i}].sbom`),
      provenance: parseFile(t['provenance'], `targets[${i}].provenance`),
    };
  });
  const seenTargets = new Set<string>();
  const seenNames = new Set<string>();
  for (const t of parsedTargets) {
    if (seenTargets.has(t.target)) malformed(`duplicate target ${t.target}`);
    seenTargets.add(t.target);
    for (const file of [t.archive, t.checksum, t.sbom, t.provenance]) {
      if (seenNames.has(file.name) || file.name === RUNTIME_INDEX_FILENAME || file.name === RUNTIME_INDEX_ATTESTATION_FILENAME) {
        malformed(`duplicate or reserved file name ${file.name}`);
      }
      seenNames.add(file.name);
    }
  }

  return {
    schema: RUNTIME_INDEX_SCHEMA,
    schemaVersion: RUNTIME_INDEX_SCHEMA_VERSION,
    verificationScheme: RUNTIME_VERIFICATION_SCHEME,
    release: { version, tag, commit: matching(release['commit'], SHA1_OR_SHA256, 'release.commit') },
    identity: {
      repository: matching(identity['repository'], REPOSITORY, 'identity.repository'),
      workflow: matching(identity['workflow'], WORKFLOW, 'identity.workflow'),
    },
    minimumInstallerVersion: matching(raw['minimumInstallerVersion'], SEMVER, 'minimumInstallerVersion'),
    targets: parsedTargets,
  };
}

export function selectRuntimeIndexTarget(index: RuntimeBundleIndex, target: string): RuntimeIndexTarget {
  const selected = index.targets.find((entry) => entry.target === target);
  if (!selected) {
    throw new RuntimeTrustError('TARGET_NOT_FOUND', `release ${index.release.tag} has no ${target} runtime (available: ${index.targets.map((t) => t.target).join(', ')})`);
  }
  return selected;
}

/** Numeric x.y.z comparison; prerelease suffixes sort before the release they precede. */
export function compareRuntimeVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.split('-', 2);
    return { nums: core.split('.').map((n) => Number(n) || 0), pre };
  };
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre);
}

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
