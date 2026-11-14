/**
 * Runtime authenticity: Sigstore attestation verification against the pinned
 * Code Intel release identity, per-version trust receipts, and the offline
 * network guard.
 *
 * Verification is fully offline. Trust material comes from a Sigstore trusted
 * root pinned inside the running runtime (or an operator-supplied file), never
 * implicitly from the bundle being installed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { bundleFromJSON } from '@sigstore/bundle';
import { TrustedRoot } from '@sigstore/protobuf-specs';
import { Verifier, toSignedEntity, toTrustMaterial } from '@sigstore/verify';
import {
  RUNTIME_INDEX_LIMITS,
  RUNTIME_VERIFICATION_SCHEME,
  RuntimeTrustError,
  sha256Hex,
  type RuntimeBundleIndex,
} from './runtime-bundle-index.js';

export type RuntimeAuthenticity = 'verified' | 'legacy-checksum' | 'unverified' | 'invalid';
export type TrustRootSource = 'pinned' | 'operator';

export const TRUST_RECEIPT_FILENAME = 'trust-receipt.json';
export const PINNED_TRUSTED_ROOT_RELPATH = path.join('trust', 'sigstore-trusted-root.json');
const MAX_TRUSTED_ROOT_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES = 16 * 1024;

export interface RuntimeTrustReceipt {
  schemaVersion: 1;
  version: string;
  target: string;
  artifactSha256: string;
  authenticity: RuntimeAuthenticity;
  signerScheme?: string;
  repository?: string;
  workflowIdentity?: string;
  verifiedAt?: string;
  policyVersion?: number;
  indexSha256?: string;
  trustRootSource?: TrustRootSource;
}

/**
 * Versioned release identity. Changing the repository, workflow path or issuer
 * requires a new policy version and an explicit release-policy update.
 */
export interface RuntimeIdentityPolicy {
  policyVersion: number;
  repository: string;
  workflow: string;
  issuer: string;
}

export const RUNTIME_IDENTITY_POLICY: RuntimeIdentityPolicy = {
  policyVersion: 1,
  repository: 'vohongtho/code-intel-platform',
  workflow: '.github/workflows/publish.yml',
  issuer: 'https://token.actions.githubusercontent.com',
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Anchored SAN pattern for GitHub Actions certificates issued to tag builds of the policy workflow. */
export function releaseIdentityPattern(policy: RuntimeIdentityPolicy = RUNTIME_IDENTITY_POLICY): string {
  return `^https://github\\.com/${escapeRegex(policy.repository)}/${escapeRegex(policy.workflow)}@refs/tags/v[0-9][0-9A-Za-z.+-]*$`;
}

export interface SigstoreIdentity {
  subjectAlternativeName: string;
  issuer: string;
}

export interface SigstoreAttestationInput {
  attestation: Buffer;
  subject: Buffer;
  trustedRoot: Buffer;
  /** Regular expression the certificate SAN must match in full. */
  sanPattern: string;
  issuer: string;
}

function attestationError(message: string): RuntimeTrustError {
  return new RuntimeTrustError('ATTESTATION_INVALID', message);
}

function parseJson(bytes: Buffer, max: number, what: string): unknown {
  if (bytes.length > max) throw attestationError(`${what} exceeds ${max} bytes`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw attestationError(`${what} is not valid JSON`);
  }
}

/**
 * Verify a Sigstore bundle (DSSE in-toto statement) fully offline: certificate
 * chain, transparency-log and CT evidence against the trusted root, the signer
 * identity policy, and that the statement names `subject` by digest.
 */
export function verifySigstoreAttestation(input: SigstoreAttestationInput): SigstoreIdentity {
  let bundle: ReturnType<typeof bundleFromJSON>;
  let root: ReturnType<typeof TrustedRoot.fromJSON>;
  try {
    bundle = bundleFromJSON(parseJson(input.attestation, RUNTIME_INDEX_LIMITS.maxAttestationBytes, 'attestation bundle'));
    root = TrustedRoot.fromJSON(parseJson(input.trustedRoot, MAX_TRUSTED_ROOT_BYTES, 'trusted root'));
  } catch (error) {
    if (error instanceof RuntimeTrustError) throw error;
    throw attestationError(`unreadable attestation material: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (bundle.content.$case !== 'dsseEnvelope' || bundle.content.dsseEnvelope.payloadType !== 'application/vnd.in-toto+json') {
    throw attestationError('attestation is not a DSSE in-toto statement');
  }

  let signer: ReturnType<Verifier['verify']>;
  try {
    const verifier = new Verifier(toTrustMaterial(root), { tlogThreshold: 1, ctlogThreshold: 1 });
    signer = verifier.verify(toSignedEntity(bundle), {
      subjectAlternativeName: input.sanPattern,
      extensions: { issuer: input.issuer },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === 'UNTRUSTED_SIGNER_ERROR') throw new RuntimeTrustError('IDENTITY_MISMATCH', message);
    throw attestationError(message);
  }

  let statement: { subject?: Array<{ digest?: Record<string, string> }> };
  try {
    statement = JSON.parse(Buffer.from(bundle.content.dsseEnvelope.payload).toString('utf8'));
  } catch {
    throw attestationError('attested statement is not valid JSON');
  }
  const digests = {
    sha256: crypto.createHash('sha256').update(input.subject).digest('hex'),
    sha512: crypto.createHash('sha512').update(input.subject).digest('hex'),
  };
  const covered = (statement.subject ?? []).some((entry) =>
    entry.digest?.['sha256'] === digests.sha256 || entry.digest?.['sha512'] === digests.sha512);
  if (!covered) throw attestationError('attestation does not cover the supplied subject digest');

  const san = signer.identity?.subjectAlternativeName;
  if (!san) throw new RuntimeTrustError('IDENTITY_MISMATCH', 'certificate carries no subject alternative name');
  return { subjectAlternativeName: san, issuer: signer.identity?.extensions?.issuer ?? input.issuer };
}

export interface VerifiedRuntimeRelease {
  repository: string;
  workflowIdentity: string;
  ref: string;
  policyVersion: number;
}

export interface RuntimeIndexAttestationInput {
  attestation: Buffer;
  indexBytes: Buffer;
  index: RuntimeBundleIndex;
  trustedRoot: Buffer;
  policy?: RuntimeIdentityPolicy;
}

export type RuntimeIndexAttestationVerifier = (input: RuntimeIndexAttestationInput) => VerifiedRuntimeRelease;

/** Verify the release index attestation against the pinned release identity. */
export const verifyRuntimeIndexAttestation: RuntimeIndexAttestationVerifier = (input) => {
  const policy = input.policy ?? RUNTIME_IDENTITY_POLICY;
  if (input.index.identity.repository !== policy.repository || input.index.identity.workflow !== policy.workflow) {
    throw new RuntimeTrustError('IDENTITY_MISMATCH', `index names ${input.index.identity.repository}/${input.index.identity.workflow}; policy v${policy.policyVersion} requires ${policy.repository}/${policy.workflow}`);
  }
  const identity = verifySigstoreAttestation({
    attestation: input.attestation,
    subject: input.indexBytes,
    trustedRoot: input.trustedRoot,
    sanPattern: releaseIdentityPattern(policy),
    issuer: policy.issuer,
  });
  const ref = identity.subjectAlternativeName.slice(identity.subjectAlternativeName.indexOf('@') + 1);
  if (ref !== `refs/tags/${input.index.release.tag}`) {
    throw new RuntimeTrustError('IDENTITY_MISMATCH', `signed by ${ref}, but index declares ${input.index.release.tag}`);
  }
  return { repository: policy.repository, workflowIdentity: identity.subjectAlternativeName, ref, policyVersion: policy.policyVersion };
};

export function buildVerifiedReceipt(args: {
  version: string;
  target: string;
  artifactSha256: string;
  indexBytes: Buffer;
  release: VerifiedRuntimeRelease;
  trustRootSource: TrustRootSource;
  now?: Date;
}): RuntimeTrustReceipt {
  return {
    schemaVersion: 1,
    version: args.version,
    target: args.target,
    artifactSha256: args.artifactSha256,
    authenticity: 'verified',
    signerScheme: RUNTIME_VERIFICATION_SCHEME,
    repository: args.release.repository,
    workflowIdentity: args.release.workflowIdentity,
    verifiedAt: (args.now ?? new Date()).toISOString(),
    policyVersion: args.release.policyVersion,
    indexSha256: sha256Hex(args.indexBytes),
    trustRootSource: args.trustRootSource,
  };
}

export function buildChecksumReceipt(version: string, target: string, artifactSha256: string): RuntimeTrustReceipt {
  return { schemaVersion: 1, version, target, artifactSha256, authenticity: 'legacy-checksum' };
}

export function writeTrustReceipt(versionRoot: string, receipt: RuntimeTrustReceipt): void {
  const filePath = path.join(versionRoot, TRUST_RECEIPT_FILENAME);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

type ReceiptRead = { state: 'missing' } | { state: 'invalid'; reason: string } | { state: 'ok'; receipt: RuntimeTrustReceipt };

const AUTHENTICITY = new Set<RuntimeAuthenticity>(['verified', 'legacy-checksum', 'unverified', 'invalid']);

export function readTrustReceipt(versionRoot: string): ReceiptRead {
  const filePath = path.join(versionRoot, TRUST_RECEIPT_FILENAME);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return { state: 'missing' };
  }
  if (!stat.isFile() || stat.size > MAX_RECEIPT_BYTES) return { state: 'invalid', reason: 'receipt is not a bounded regular file' };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { state: 'invalid', reason: 'receipt is not valid JSON' };
  }
  if (raw['schemaVersion'] !== 1 || typeof raw['version'] !== 'string' || typeof raw['target'] !== 'string'
    || typeof raw['artifactSha256'] !== 'string' || !AUTHENTICITY.has(raw['authenticity'] as RuntimeAuthenticity)) {
    return { state: 'invalid', reason: 'receipt does not match schema v1' };
  }
  return { state: 'ok', receipt: raw as unknown as RuntimeTrustReceipt };
}

export interface RuntimeTrustInspection {
  version: string;
  target: string | null;
  authenticity: RuntimeAuthenticity;
  reason: string;
  digest: { algorithm: 'sha256'; value: string } | null;
  release: { repository: string; workflowIdentity: string; verifiedAt: string | null; policyVersion: number | null; trustRootSource: TrustRootSource | null } | null;
}

/**
 * Report a runtime version's trust state from its own receipt. A receipt is
 * only honored for the version root it sits in, so rollback cannot borrow
 * trust from another archive, and no legacy runtime is ever reported `verified`.
 */
export function inspectRuntimeTrust(versionRoot: string, policy: RuntimeIdentityPolicy = RUNTIME_IDENTITY_POLICY): RuntimeTrustInspection {
  let manifest: { product?: { version?: string }; bundleBuild?: { target?: string } } | null = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(versionRoot, 'runtime-manifest.json'), 'utf8'));
  } catch {
    manifest = null;
  }
  const version = manifest?.product?.version ?? path.basename(versionRoot);
  const target = manifest?.bundleBuild?.target ?? null;
  const base = { version, target, digest: null, release: null };
  const read = readTrustReceipt(versionRoot);

  if (read.state === 'missing') {
    return manifest
      ? { ...base, authenticity: 'legacy-checksum', reason: 'no trust receipt; installed by a checksum-only installer' }
      : { ...base, authenticity: 'unverified', reason: 'no trust receipt and no readable runtime manifest' };
  }
  if (read.state === 'invalid') return { ...base, authenticity: 'invalid', reason: read.reason };

  const receipt = read.receipt;
  const digest = { algorithm: 'sha256' as const, value: receipt.artifactSha256 };
  if (receipt.version !== version || (target && receipt.target !== target)) {
    return { ...base, digest, authenticity: 'invalid', reason: `receipt describes ${receipt.version}/${receipt.target}, not this runtime` };
  }
  if (receipt.authenticity !== 'verified') {
    return { ...base, digest, authenticity: receipt.authenticity, reason: `receipt records ${receipt.authenticity}` };
  }
  if (receipt.signerScheme !== RUNTIME_VERIFICATION_SCHEME || receipt.repository !== policy.repository || !receipt.workflowIdentity
    || !new RegExp(releaseIdentityPattern(policy)).test(receipt.workflowIdentity)) {
    return { ...base, digest, authenticity: 'invalid', reason: 'verified receipt does not match the pinned release identity policy' };
  }
  return {
    ...base,
    digest,
    authenticity: 'verified',
    reason: 'archive authenticated against the pinned release identity',
    release: {
      repository: receipt.repository,
      workflowIdentity: receipt.workflowIdentity,
      verifiedAt: receipt.verifiedAt ?? null,
      policyVersion: receipt.policyVersion ?? null,
      trustRootSource: receipt.trustRootSource ?? null,
    },
  };
}

/**
 * Run `fn` with every outbound network primitive replaced by a thrower, and
 * count attempts. Child processes are not covered; callers keep them offline.
 */
export async function runWithNetworkDenied<T>(fn: () => Promise<T>): Promise<{ result: T; networkAttempts: number }> {
  let networkAttempts = 0;
  const deny = (name: string) => (..._args: unknown[]): never => {
    networkAttempts++;
    throw new Error(`network access blocked in offline mode (${name})`);
  };
  const patches: Array<[Record<string, unknown>, string]> = [
    [globalThis as unknown as Record<string, unknown>, 'fetch'],
    [net as unknown as Record<string, unknown>, 'connect'],
    [net as unknown as Record<string, unknown>, 'createConnection'],
    [tls as unknown as Record<string, unknown>, 'connect'],
    [http as unknown as Record<string, unknown>, 'request'],
    [http as unknown as Record<string, unknown>, 'get'],
    [https as unknown as Record<string, unknown>, 'request'],
    [https as unknown as Record<string, unknown>, 'get'],
    [dns as unknown as Record<string, unknown>, 'lookup'],
    [dns.promises as unknown as Record<string, unknown>, 'lookup'],
  ];
  const saved = patches.map(([owner, key]) => owner[key]);
  patches.forEach(([owner, key]) => { owner[key] = deny(key); });
  syncBuiltinESMExports();
  try {
    const result = await fn();
    return { result, networkAttempts };
  } finally {
    patches.forEach(([owner, key], i) => { owner[key] = saved[i]; });
    syncBuiltinESMExports();
  }
}
