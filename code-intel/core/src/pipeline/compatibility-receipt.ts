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
import type { EmbeddingMetadata } from '../storage/metadata.js';

/** Identity fingerprint for the currently-implemented Symbol Identity scheme. */
export const CURRENT_IDENTITY_FINGERPRINT = 'symbol-identity-v2';

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Computes the compatibility receipt describing the analyzer/schema versions a
 * generation was (or would be) built with. Every field here is derived from the
 * currently-installed code, not from repository content, so it can be computed
 * both after a real analysis run (to publish alongside a generation) and ahead of
 * one (to key a cache lookup) and the two must always agree bit-for-bit.
 */
export function buildAnalyzerCompatibilityReceipt(args: {
  parser: 'tree-sitter' | 'regex';
  factSchemaVersion?: string;
  identityFingerprint: string;
  resolverFingerprint?: string;
  embeddingMetadata?: Pick<EmbeddingMetadata, 'provider' | 'model' | 'dimension'>;
}): AnalyzerCompatibilityReceipt {
  const languageRegistryFingerprint = sha256(
    getAllLanguageModules().map((mod) => ({
      language: mod.lang,
      query: mod.queries,
      extensions: [...mod.fileExtensions].sort(),
    })),
  );
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
