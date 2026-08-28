import crypto from 'node:crypto';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { RESOLVER_VERSION } from '../../resolution/contracts.js';
import { buildResolutionIndexes, createResolutionInstrumentation } from '../../resolution/indexes.js';
import { RESOLUTION_LANGUAGE_STRATEGIES } from '../../resolution/languages.js';
import { materializeSemanticRelationships } from '../../resolution/materialize-relationships.js';
import { createEvidenceStore, EVIDENCE_SCHEMA_VERSION } from '../../evidence/store.js';
import { getSchemaDdlFingerprint } from '../../storage/schema.js';
import { getAllLanguageModules } from '../../languages/registry.js';

export const resolvePhase: Phase = {
  name: 'resolve',
  dependencies: ['parse'],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();

    const instrumentation = createResolutionInstrumentation();
    const indexes = buildResolutionIndexes(context.semanticFacts ?? [], instrumentation);
    context.resolutionIndexes = indexes;
    context.resolutionInstrumentation = instrumentation;
    context.resolverVersion = RESOLVER_VERSION;
    context.resolverFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({
        resolverVersion: RESOLVER_VERSION,
        factSchemaVersion: context.factSchemaVersion ?? null,
        identityFingerprint: context.identityFingerprint ?? null,
      }))
      .digest('hex');
    context.evidenceSchemaVersion = EVIDENCE_SCHEMA_VERSION;
    context.evidenceSchemaFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({
        evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
        resolverVersion: RESOLVER_VERSION,
      }))
      .digest('hex');
    context.compatibilityReceipt = {
      ddlFingerprint: getSchemaDdlFingerprint(),
      analyzerFingerprint: crypto.createHash('sha256')
        .update(JSON.stringify({
          parser: context.parserUsed ?? 'regex',
          factSchemaVersion: context.factSchemaVersion ?? null,
          languages: getAllLanguageModules().map((mod) => ({ language: mod.lang, query: mod.queries, extensions: [...mod.fileExtensions].sort() })),
        }))
        .digest('hex'),
      languageRegistryFingerprint: crypto.createHash('sha256')
        .update(JSON.stringify(getAllLanguageModules().map((mod) => ({ language: mod.lang, query: mod.queries, extensions: [...mod.fileExtensions].sort() }))))
        .digest('hex'),
      factSchemaFingerprint: crypto.createHash('sha256')
        .update(JSON.stringify({ version: context.factSchemaVersion ?? null, parser: context.parserUsed ?? 'regex' }))
        .digest('hex'),
      identityFingerprint: context.identityFingerprint ?? 'symbol-identity-v2',
      resolverFingerprint: context.resolverFingerprint,
      evidenceFingerprint: context.evidenceSchemaFingerprint,
    };

    const evidenceStore = createEvidenceStore(context.workspaceRoot);
    const materialized = materializeSemanticRelationships({
      graph: context.graph,
      facts: context.semanticFacts ?? [],
      indexes,
      evidenceStore,
      resolverVersion: RESOLVER_VERSION,
    });
    evidenceStore.close();
    context.evolutionAction ??= 'full-reanalysis';
    context.evidenceVerification = materialized.evidenceCount > 0
      ? {
          status: 'verified',
          producedCount: materialized.evidenceCount,
          persistedCount: materialized.evidenceCount,
          contentFingerprint: context.evidenceSchemaFingerprint,
        }
      : {
          status: 'unavailable',
          producedCount: 0,
          persistedCount: 0,
          reason: 'no evidence records materialized',
          contentFingerprint: context.evidenceSchemaFingerprint,
        };

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: [
        `Semantic resolver prepared ${indexes.declarationsByFactId.size} declarations`,
        `${indexes.importsByFile.size} import scopes`,
        `${indexes.heritageByDeclaration.size} heritage scopes`,
        `languages=${Object.keys(RESOLUTION_LANGUAGE_STRATEGIES).length}`,
        `index-builds=${instrumentation.indexBuildCount}`,
        `workspace-traversals=${instrumentation.fullWorkspaceTraversalCount}`,
        `materialized-edges=${materialized.edgeCount}`,
        `evidence-records=${materialized.evidenceCount}`,
        `unresolved=${materialized.unresolvedCount}`,
        `truncated=${materialized.truncatedCount}`,
      ].join(', '),
    };
  },
};
