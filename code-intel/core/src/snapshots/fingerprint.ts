import crypto from 'node:crypto';
import { buildAnalyzerCompatibilityReceipt, CURRENT_IDENTITY_FINGERPRINT } from '../pipeline/compatibility-receipt.js';
import { SNAPSHOT_SCHEMA_VERSION, type SemanticSnapshotDescriptor } from './types.js';

export interface AnalyzerFingerprints {
  parserFingerprint: string;
  factSchemaFingerprint: string;
  identityFingerprint: string;
  resolverFingerprint: string;
  graphSchemaFingerprint: string;
  contractFingerprint: string;
}

/**
 * Analyzer/schema fingerprints derived purely from the currently-installed
 * code-intel version — not from repository content — so they can be computed
 * before an expensive build to key a cache lookup. They intentionally reuse the
 * exact same formula as the post-build `AnalyzerCompatibilityReceipt` written
 * into a real generation's metadata (`buildAnalyzerCompatibilityReceipt`), so a
 * cached snapshot's descriptor can be compared against a freshly-built one's
 * compatibility receipt without drift between two independently-written formulas.
 *
 * `parser` assumes `tree-sitter`, the pipeline's preferred parser. If a build
 * unexpectedly falls back to the regex parser, its actual compatibility receipt
 * will differ from this pre-build fingerprint — the result is a cache miss (an
 * efficiency cost), never a correctness problem, since cache validation always
 * re-derives and compares fingerprints from the real post-build metadata too.
 */
export function computeAnalyzerFingerprints(): AnalyzerFingerprints {
  const receipt = buildAnalyzerCompatibilityReceipt({
    parser: 'tree-sitter',
    identityFingerprint: CURRENT_IDENTITY_FINGERPRINT,
  });
  return {
    parserFingerprint: receipt.analyzerFingerprint,
    factSchemaFingerprint: receipt.factSchemaFingerprint,
    identityFingerprint: receipt.identityFingerprint,
    resolverFingerprint: receipt.resolverFingerprint,
    graphSchemaFingerprint: receipt.ddlFingerprint,
    // apiContractFingerprint is unconditionally computed by buildAnalyzerCompatibilityReceipt;
    // it's typed optional only because the receipt shape is shared with legacy manifests.
    contractFingerprint: receipt.apiContractFingerprint as string,
  };
}

/** Deterministic content/config-derived ID. Excludes `createdAt` by construction. */
export function computeSnapshotId(descriptor: Omit<SemanticSnapshotDescriptor, 'snapshotId' | 'createdAt'>): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    repositoryIdentity: descriptor.repositoryIdentity,
    gitTree: descriptor.gitTree,
    dirtyStateFingerprint: descriptor.dirtyStateFingerprint ?? null,
    parserFingerprint: descriptor.parserFingerprint,
    factSchemaFingerprint: descriptor.factSchemaFingerprint,
    identityFingerprint: descriptor.identityFingerprint,
    resolverFingerprint: descriptor.resolverFingerprint,
    graphSchemaFingerprint: descriptor.graphSchemaFingerprint,
    contractFingerprint: descriptor.contractFingerprint ?? null,
  })).digest('hex');
}

export function buildSnapshotDescriptor(input: {
  repositoryIdentity: string;
  gitTree: string;
  commit?: string;
  dirtyStateFingerprint?: string;
  /** Overrides the derived contract fingerprint; used when API-contract deltas are requested. */
  contractFingerprint?: string;
}): SemanticSnapshotDescriptor {
  const analyzer = computeAnalyzerFingerprints();
  const withoutId: Omit<SemanticSnapshotDescriptor, 'snapshotId' | 'createdAt'> = {
    repositoryIdentity: input.repositoryIdentity,
    gitTree: input.gitTree,
    commit: input.commit,
    dirtyStateFingerprint: input.dirtyStateFingerprint,
    parserFingerprint: analyzer.parserFingerprint,
    factSchemaFingerprint: analyzer.factSchemaFingerprint,
    identityFingerprint: analyzer.identityFingerprint,
    resolverFingerprint: analyzer.resolverFingerprint,
    graphSchemaFingerprint: analyzer.graphSchemaFingerprint,
    contractFingerprint: input.contractFingerprint ?? analyzer.contractFingerprint,
  };
  return {
    ...withoutId,
    snapshotId: computeSnapshotId(withoutId),
    createdAt: new Date().toISOString(),
  };
}

/** True when two descriptors denote the same semantic snapshot, ignoring `createdAt`. */
export function descriptorsMatch(a: SemanticSnapshotDescriptor, b: SemanticSnapshotDescriptor): boolean {
  return a.snapshotId === b.snapshotId;
}
