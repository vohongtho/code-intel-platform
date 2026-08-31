/**
 * semantic-snapshot.ts
 *
 * Versioned, serializable snapshot of the semantic fact corpus (per file) plus
 * the fact/identity/resolver/evidence compatibility fingerprints that must
 * match before an incremental delta can be trusted against it.
 *
 * A snapshot stores full SemanticFact objects (not just fingerprints) so that
 * unchanged-file facts can be replayed through resolution again without
 * re-parsing their source file.
 */
import type {
  CallSiteFact,
  DeclarationFact,
  DeclarationFragmentFact,
  DependencyBindingFact,
  EmbeddedRegionFact,
  HeritageFact,
  ImportBindingFact,
  PublishedNameFact,
  ReferenceFact,
  RegistrationFact,
  RouteFact,
  SemanticFact,
} from '../semantic/facts.js';
import { FACT_SCHEMA_VERSION } from '../semantic/fact-bundle.js';
import { RESOLVER_VERSION } from '../resolution/contracts.js';
import { EVIDENCE_SCHEMA_VERSION } from '../evidence/store.js';
import { hashIdentityPayload, normalizeRepoRelativePath } from '../identity/normalization.js';

export const SEMANTIC_SNAPSHOT_VERSION = 1;
export const SEMANTIC_INDEX_IDENTITY_FINGERPRINT = 'symbol-identity-v2';

export type SemanticFactKind =
  | 'declaration'
  | 'declaration-fragment'
  | 'import'
  | 'published-name'
  | 'call-site'
  | 'reference'
  | 'heritage'
  | 'registration'
  | 'dependency-binding'
  | 'route'
  | 'embedded-region';

/** Fact kinds whose identity, when changed, can only affect resolution local to their own file. */
export const LOCAL_ONLY_FACT_KINDS: ReadonlySet<SemanticFactKind> = new Set([
  'declaration-fragment',
  'call-site',
  'reference',
]);

/** Fact kinds that can be consumed by facts in other files (module/type/heritage/call-site/registration/route domains). */
export const RELATIONSHIP_FACT_KINDS: ReadonlySet<SemanticFactKind> = new Set([
  'import',
  'call-site',
  'reference',
  'heritage',
  'registration',
  'dependency-binding',
  'route',
]);

export function classifySemanticFact(fact: SemanticFact): SemanticFactKind {
  if ('declarationRef' in fact && 'fragmentId' in fact) return 'declaration-fragment';
  if ('declarationKind' in fact && 'anchors' in fact) return 'declaration';
  if ('sourceModule' in fact && 'localName' in fact) return 'import';
  if ('moduleRef' in fact && 'publicName' in fact) return 'published-name';
  if ('calleeText' in fact) return 'call-site';
  if ('operation' in fact && 'targetText' in fact) return 'reference';
  if ('heritageKind' in fact && 'target' in fact) return 'heritage';
  if ('bindingKind' in fact && ('contractRef' in fact || 'implementationRef' in fact || 'tokenText' in fact)) return 'dependency-binding';
  if ('registrationKind' in fact) return 'registration';
  if ('routeKind' in fact) return 'route';
  return 'embedded-region';
}

/** Fields that define what a fact *is* to consumers/producers, independent of source position. */
function identityPayload(fact: SemanticFact, kind: SemanticFactKind): unknown {
  switch (kind) {
    case 'declaration': {
      const f = fact as DeclarationFact;
      return {
        declarationKind: f.declarationKind, name: f.name, qualifiedName: f.qualifiedName,
        ownerRef: f.ownerRef, signature: f.signature, visibility: f.visibility,
        type: f.type, traits: f.traits,
      };
    }
    case 'declaration-fragment': {
      const f = fact as DeclarationFragmentFact;
      return { declarationRef: f.declarationRef, partial: f.partial, hasBody: f.hasBody };
    }
    case 'import': {
      const f = fact as ImportBindingFact;
      return {
        sourceModule: f.sourceModule, importedName: f.importedName,
        localName: f.localName, bindingKind: f.bindingKind, scopeRef: f.scopeRef,
      };
    }
    case 'published-name': {
      const f = fact as PublishedNameFact;
      return { moduleRef: f.moduleRef, publicName: f.publicName, sourceRef: f.sourceRef, publicationKind: f.publicationKind };
    }
    case 'call-site': {
      const f = fact as CallSiteFact;
      return { callerRef: f.callerRef, calleeText: f.calleeText, receiver: f.receiver, arguments: f.arguments };
    }
    case 'reference': {
      const f = fact as ReferenceFact;
      return { operation: f.operation, targetText: f.targetText, receiver: f.receiver };
    }
    case 'heritage': {
      const f = fact as HeritageFact;
      return { declarationRef: f.declarationRef, heritageKind: f.heritageKind, target: f.target };
    }
    case 'registration': {
      const f = fact as RegistrationFact;
      return { registrationKind: f.registrationKind, subjectRef: f.subjectRef, targetText: f.targetText, framework: f.framework };
    }
    case 'dependency-binding': {
      const f = fact as DependencyBindingFact;
      return {
        bindingKind: f.bindingKind, contractRef: f.contractRef, implementationRef: f.implementationRef,
        tokenText: f.tokenText, lifetime: f.lifetime, dynamic: f.dynamic, framework: f.framework,
      };
    }
    case 'route': {
      const f = fact as RouteFact;
      return { routeKind: f.routeKind, path: f.path, method: f.method, handlerRef: f.handlerRef, framework: f.framework };
    }
    case 'embedded-region': {
      const f = fact as EmbeddedRegionFact;
      return { embeddedLanguage: f.embeddedLanguage, hostLanguage: f.hostLanguage, extractionKind: f.extractionKind };
    }
  }
}

/** Deterministic content fingerprint of a fact's identity payload, excluding source position. */
export function factIdentityFingerprint(fact: SemanticFact): string {
  const kind = classifySemanticFact(fact);
  return hashIdentityPayload({ kind, payload: identityPayload(fact, kind), frameworkEvidence: fact.frameworkEvidence });
}

export interface SemanticSnapshotFile {
  filePath: string;
  fileFingerprint: string;
  facts: readonly SemanticFact[];
}

export interface SemanticSnapshotCompatibility {
  factSchemaFingerprint: string;
  identityFingerprint: string;
  resolverFingerprint: string;
  evidenceFingerprint: string;
}

export interface SemanticSnapshot {
  version: typeof SEMANTIC_SNAPSHOT_VERSION;
  compatibility: SemanticSnapshotCompatibility;
  files: readonly SemanticSnapshotFile[];
  fingerprint: string;
}

export function computeSemanticCompatibility(parser: 'tree-sitter' | 'regex' = 'tree-sitter'): SemanticSnapshotCompatibility {
  const identityFingerprint = SEMANTIC_INDEX_IDENTITY_FINGERPRINT;
  const factSchemaFingerprint = hashIdentityPayload({ version: FACT_SCHEMA_VERSION, parser });
  const resolverFingerprint = hashIdentityPayload({
    resolverVersion: RESOLVER_VERSION, factSchemaVersion: FACT_SCHEMA_VERSION, identityFingerprint,
  });
  const evidenceFingerprint = hashIdentityPayload({ evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION, resolverVersion: RESOLVER_VERSION });
  return { factSchemaFingerprint, identityFingerprint, resolverFingerprint, evidenceFingerprint };
}

export function isCompatibleSnapshot(
  snapshot: Pick<SemanticSnapshot, 'version' | 'compatibility'> | null | undefined,
  expected: SemanticSnapshotCompatibility,
): boolean {
  if (!snapshot || snapshot.version !== SEMANTIC_SNAPSHOT_VERSION) return false;
  const c = snapshot.compatibility;
  return c.factSchemaFingerprint === expected.factSchemaFingerprint
    && c.identityFingerprint === expected.identityFingerprint
    && c.resolverFingerprint === expected.resolverFingerprint
    && c.evidenceFingerprint === expected.evidenceFingerprint;
}

function sortedFacts(facts: readonly SemanticFact[]): SemanticFact[] {
  return [...facts].sort((a, b) => a.factId.localeCompare(b.factId));
}

export function buildSemanticSnapshotFile(filePath: string, facts: readonly SemanticFact[]): SemanticSnapshotFile {
  const ordered = sortedFacts(facts);
  return {
    filePath: normalizeRepoRelativePath(filePath),
    fileFingerprint: hashIdentityPayload(ordered.map((fact) => [fact.factId, factIdentityFingerprint(fact)])),
    facts: ordered,
  };
}

export function createSemanticSnapshot(
  factsByFile: ReadonlyMap<string, readonly SemanticFact[]>,
  compatibility: SemanticSnapshotCompatibility,
): SemanticSnapshot {
  const files = [...factsByFile.entries()]
    .map(([filePath, facts]) => buildSemanticSnapshotFile(filePath, facts))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
  return {
    version: SEMANTIC_SNAPSHOT_VERSION,
    compatibility,
    files,
    fingerprint: hashIdentityPayload({ compatibility, files: files.map((f) => [f.filePath, f.fileFingerprint]) }),
  };
}

/**
 * Replace or remove per-file fact sets on top of a base snapshot, recomputing
 * only the touched files' fingerprints and the overall snapshot fingerprint.
 */
export function mergeSemanticSnapshot(
  base: SemanticSnapshot,
  updates: ReadonlyMap<string, readonly SemanticFact[] | null>,
): SemanticSnapshot {
  const byFile = new Map(base.files.map((file) => [file.filePath, file]));
  for (const [rawFilePath, facts] of updates) {
    const filePath = normalizeRepoRelativePath(rawFilePath);
    if (facts === null) byFile.delete(filePath);
    else byFile.set(filePath, buildSemanticSnapshotFile(filePath, facts));
  }
  const files = [...byFile.values()].sort((a, b) => a.filePath.localeCompare(b.filePath));
  return {
    version: SEMANTIC_SNAPSHOT_VERSION,
    compatibility: base.compatibility,
    files,
    fingerprint: hashIdentityPayload({ compatibility: base.compatibility, files: files.map((f) => [f.filePath, f.fileFingerprint]) }),
  };
}

export function getSnapshotFile(snapshot: SemanticSnapshot, filePath: string): SemanticSnapshotFile | undefined {
  const normalized = normalizeRepoRelativePath(filePath);
  return snapshot.files.find((file) => file.filePath === normalized);
}

export function allSnapshotFacts(snapshot: SemanticSnapshot): SemanticFact[] {
  return snapshot.files.flatMap((file) => file.facts);
}

export function serializeSemanticSnapshot(snapshot: SemanticSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseSemanticSnapshot(raw: string): SemanticSnapshot | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== SEMANTIC_SNAPSHOT_VERSION) return null;
    if (!candidate.compatibility || typeof candidate.compatibility !== 'object') return null;
    if (!Array.isArray(candidate.files) || typeof candidate.fingerprint !== 'string') return null;
    return candidate as unknown as SemanticSnapshot;
  } catch {
    return null;
  }
}
