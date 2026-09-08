import crypto from 'node:crypto';
import { getAllLanguageModules } from '../languages/registry.js';
import { FACT_SCHEMA_VERSION } from '../semantic/fact-bundle.js';
import { LANGUAGE_FACT_ADAPTERS } from '../semantic/adapters/registry.js';
import { RESOLUTION_LANGUAGE_STRATEGIES } from '../resolution/languages.js';
import { RESOLVER_VERSION } from '../resolution/contracts.js';
import { EVIDENCE_SCHEMA_VERSION } from '../evidence/store.js';
import { API_CONTRACT_SCHEMA_VERSION } from '../semantic/api-contracts/types.js';
import { getSchemaDdlFingerprint } from '../storage/schema.js';
import type { AnalyzerCompatibilityReceipt } from '../storage/index-generation.js';
import type { EmbeddingMetadata, IndexMetadata } from '../storage/metadata.js';

/** Identity fingerprint for the currently-implemented Symbol Identity scheme. */
export const CURRENT_IDENTITY_FINGERPRINT = 'symbol-identity-v2';

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Fingerprint of the specific framework adapters that fired for this repo,
 * keyed by (frameworkId, adapterVersion) — not just frameworkId. A repo whose
 * detected frameworks are unchanged but whose adapter implementation was
 * upgraded (a different `adapterVersion`) MUST produce a different
 * fingerprint, so stale framework-derived facts are never silently reused
 * merely because the same frameworks are still detected.
 *
 * Scoped to detected frameworks (not the whole adapter registry) to match
 * `frameworkDetections`' existing per-repo semantics — repos that don't use a
 * given framework are unaffected when that framework's adapter changes.
 */
export function buildFrameworkFingerprint(
  detections: readonly { frameworkId: string; adapterVersion: string }[],
  factSchemaVersion: string | undefined,
): string | undefined {
  if (detections.length === 0) return undefined;
  const versions = detections
    .map((item) => ({ frameworkId: item.frameworkId, adapterVersion: item.adapterVersion }))
    .sort((a, b) => a.frameworkId.localeCompare(b.frameworkId));
  return sha256({ frameworks: versions, factSchemaVersion });
}

/**
 * Fingerprint of the tree-sitter query/grammar registry currently installed —
 * language, query text, and file extensions for every language module. This
 * is the "parser/grammar identity" fingerprint (task 9.1): a query-file
 * change (e.g. a bug fix to a `.scm` query) changes this even when
 * `FACT_SCHEMA_VERSION` isn't manually bumped for it.
 */
export function buildLanguageRegistryFingerprint(): string {
  return sha256(
    getAllLanguageModules().map((mod) => ({
      language: mod.lang,
      query: mod.queries,
      extensions: [...mod.fileExtensions].sort(),
    })),
  );
}

export function buildAnalyzerCompatibilityReceipt(args: {
  parser: 'tree-sitter' | 'regex';
  factSchemaVersion?: string;
  identityFingerprint: string;
  resolverFingerprint?: string;
  embeddingMetadata?: Pick<EmbeddingMetadata, 'provider' | 'model' | 'dimension'>;
}): AnalyzerCompatibilityReceipt {
  const languageRegistryFingerprint = buildLanguageRegistryFingerprint();
  const analyzerFingerprint = sha256({
    parser: args.parser,
    factSchemaVersion: args.factSchemaVersion ?? FACT_SCHEMA_VERSION,
    languageRegistryFingerprint,
    languageFactAdapters: Object.entries(LANGUAGE_FACT_ADAPTERS)
      .map(([language, adapter]) => ({ language, adapterId: adapter.adapterId }))
      .sort((a, b) => a.language.localeCompare(b.language)),
    resolutionLanguages: Object.keys(RESOLUTION_LANGUAGE_STRATEGIES).sort(),
  });
  return {
    ddlFingerprint: getSchemaDdlFingerprint(),
    analyzerFingerprint,
    languageRegistryFingerprint,
    factSchemaFingerprint: sha256({ version: args.factSchemaVersion ?? FACT_SCHEMA_VERSION, parser: args.parser }),
    identityFingerprint: args.identityFingerprint,
    resolverFingerprint: args.resolverFingerprint ?? sha256({ resolverVersion: RESOLVER_VERSION, factSchemaVersion: args.factSchemaVersion ?? FACT_SCHEMA_VERSION, identityFingerprint: args.identityFingerprint }),
    evidenceFingerprint: sha256({ evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION, resolverVersion: RESOLVER_VERSION }),
    embeddingFingerprint: args.embeddingMetadata ? sha256(args.embeddingMetadata) : undefined,
    apiContractFingerprint: sha256({ apiContractSchemaVersion: API_CONTRACT_SCHEMA_VERSION }),
  };
}

/**
 * The single source of truth for "is this persisted metadata's semantic
 * producer identity incompatible with the currently-installed code" — shared
 * by `pipeline/analysis-plan.ts` (decides whether `analyze` must do a full
 * rebuild) and `storage/index-trust.ts` (decides whether `index-status`/
 * `doctor` report the CURRENTLY persisted index as trusted). Having two
 * independent reimplementations of this comparison was itself the bug: prior
 * to this function existing, `index-trust.ts` had no fingerprint check at
 * all, so `index-status`/`doctor` reported a real published `1.0.10` index as
 * `trusted: true` even though `analyze` itself would have forced a full
 * rebuild — verified against the actual published 1.0.10 npm package via
 * `scripts/verify-upgrade-from-1.0.10.mjs`.
 *
 * A field is only compared when present on the persisted side — a field
 * simply being absent (an older schema that never had it) is not itself a
 * mismatch, EXCEPT for `compatibilityReceipt` being entirely absent, which
 * means the generation predates the whole compatibility-receipt system and
 * its true compatibility is unknown; that fails closed.
 */
export function isSemanticProducerIncompatible(metadata: IndexMetadata): boolean {
  const parser = metadata.parser ?? 'regex';
  const currentFactSchemaFingerprint = sha256({ version: FACT_SCHEMA_VERSION, parser });
  const currentResolverFingerprint = sha256({
    resolverVersion: RESOLVER_VERSION,
    factSchemaVersion: FACT_SCHEMA_VERSION,
    identityFingerprint: CURRENT_IDENTITY_FINGERPRINT,
  });
  const currentEvidenceFingerprint = sha256({
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    resolverVersion: RESOLVER_VERSION,
  });
  const currentApiContractFingerprint = sha256({ apiContractSchemaVersion: API_CONTRACT_SCHEMA_VERSION });
  const persistedLanguageRegistryFingerprint = metadata.compatibilityReceipt?.languageRegistryFingerprint;
  const languageRegistryMismatch = Boolean(
    persistedLanguageRegistryFingerprint && persistedLanguageRegistryFingerprint !== buildLanguageRegistryFingerprint(),
  );
  const fieldMismatch = Boolean(
    (metadata.factSchemaVersion && metadata.factSchemaVersion !== FACT_SCHEMA_VERSION)
    || (metadata.factSchemaFingerprint && metadata.factSchemaFingerprint !== currentFactSchemaFingerprint)
    || (metadata.identityFingerprint && metadata.identityFingerprint !== CURRENT_IDENTITY_FINGERPRINT)
    || (metadata.resolverVersion && metadata.resolverVersion !== RESOLVER_VERSION)
    || (metadata.resolverFingerprint && metadata.resolverFingerprint !== currentResolverFingerprint)
    || (metadata.evidenceSchemaVersion !== undefined && metadata.evidenceSchemaVersion !== EVIDENCE_SCHEMA_VERSION)
    || (metadata.evidenceSchemaFingerprint && metadata.evidenceSchemaFingerprint !== currentEvidenceFingerprint)
    || (metadata.apiContractSchemaVersion && metadata.apiContractSchemaVersion !== API_CONTRACT_SCHEMA_VERSION)
    || (metadata.apiContractFingerprint && metadata.apiContractFingerprint !== currentApiContractFingerprint)
    || languageRegistryMismatch,
  );
  return fieldMismatch || !metadata.compatibilityReceipt;
}
