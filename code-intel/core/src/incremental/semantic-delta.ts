/**
 * semantic-delta.ts
 *
 * Diffs freshly parsed facts for changed/deleted files against the published
 * SemanticSnapshot, distinguishing body-only edits (no declaration/import/
 * type/registration identity changed) from shape changes that require
 * dependency-closure re-resolution of unchanged consumer facts elsewhere.
 */
import type { PublishedNameFact, SemanticFact } from '../semantic/facts.js';
import {
  LOCAL_ONLY_FACT_KINDS,
  RELATIONSHIP_FACT_KINDS,
  classifySemanticFact,
  factIdentityFingerprint,
  getSnapshotFile,
  isCompatibleSnapshot,
  type SemanticFactKind,
  type SemanticSnapshot,
  type SemanticSnapshotCompatibility,
} from './semantic-snapshot.js';
import {
  producedKeysForDeclaration,
  producedKeysForPublishedName,
  type DependencyKey,
  type ReverseDependencyEntry,
  type ReverseDependencyIndex,
} from './reverse-dependency-index.js';
import {
  computeInvalidationClosure,
  DEFAULT_INVALIDATION_CLOSURE_LIMITS,
  type InvalidationClosureLimits,
} from './invalidation-closure.js';

export type AffectedArtifact = 'graph' | 'bm25' | 'vector' | 'evidence' | 'flows' | 'clusters' | 'program-analysis';

export interface SemanticDelta {
  changedFiles: readonly string[];
  deletedFiles: readonly string[];
  addedFacts: readonly string[];
  removedFacts: readonly string[];
  changedFacts: readonly string[];
  /** Files with no producer-fact identity change — safe to re-resolve without dependency closure. */
  bodyOnlyFiles: readonly string[];
  invalidatedReferences: readonly string[];
  invalidatedCallSites: readonly string[];
  invalidatedSymbols: readonly string[];
  affectedArtifacts: ReadonlySet<AffectedArtifact>;
  requiresFullResolution: boolean;
  reason?: string;
}

const ALL_ARTIFACTS: readonly AffectedArtifact[] = ['graph', 'bm25', 'vector', 'evidence', 'flows', 'clusters', 'program-analysis'];

function fullFallbackDelta(
  changedFiles: readonly string[],
  deletedFiles: readonly string[],
  reason: string,
): SemanticDelta {
  return {
    changedFiles,
    deletedFiles,
    addedFacts: [],
    removedFacts: [],
    changedFacts: [],
    bodyOnlyFiles: [],
    invalidatedReferences: [],
    invalidatedCallSites: [],
    invalidatedSymbols: [],
    affectedArtifacts: new Set(ALL_ARTIFACTS),
    requiresFullResolution: true,
    reason,
  };
}

function producedKeysFor(fact: SemanticFact): DependencyKey[] {
  const kind = classifySemanticFact(fact);
  if (kind === 'declaration') return producedKeysForDeclaration(fact as import('../semantic/facts.js').DeclarationFact);
  if (kind === 'published-name') return producedKeysForPublishedName(fact as import('../semantic/facts.js').PublishedNameFact);
  return [];
}

/**
 * A declaration's own produced keys are name/qualifiedName based and don't
 * carry a module specifier. Importers reach a declaration only through a
 * PublishedNameFact whose `sourceRef` names it, so a declaration change must
 * also seed that published name's module key — otherwise an aliased import
 * (`import { Widget as W }`) of a changed declaration would never be found.
 */
function linkedPublishedNameKeys(declarationFactId: string, candidateFiles: readonly (readonly SemanticFact[])[]): DependencyKey[] {
  const keys: DependencyKey[] = [];
  for (const facts of candidateFiles) {
    for (const fact of facts) {
      if (classifySemanticFact(fact) !== 'published-name') continue;
      const publishedName = fact as PublishedNameFact;
      if (publishedName.sourceRef === declarationFactId) keys.push(...producedKeysForPublishedName(publishedName));
    }
  }
  return keys;
}

function byFactId(facts: readonly SemanticFact[]): Map<string, SemanticFact> {
  return new Map(facts.map((fact) => [fact.factId, fact]));
}

function seedKeysForShapeFact(fact: SemanticFact, kind: SemanticFactKind, candidateFiles: readonly (readonly SemanticFact[])[]): DependencyKey[] {
  const keys = producedKeysFor(fact);
  return kind === 'declaration' ? [...keys, ...linkedPublishedNameKeys(fact.factId, candidateFiles)] : keys;
}

interface FileDiffResult {
  addedFacts: string[];
  removedFacts: string[];
  changedFacts: string[];
  seedKeys: DependencyKey[];
  isBodyOnly: boolean;
}

/** Diffs one file's old vs freshly parsed facts, matched by factId. */
function diffChangedFile(oldFileFacts: readonly SemanticFact[], newFileFacts: readonly SemanticFact[]): FileDiffResult {
  const oldFacts = byFactId(oldFileFacts);
  const newFacts = byFactId(newFileFacts);
  const candidateFiles = [oldFileFacts, newFileFacts];
  const result: FileDiffResult = { addedFacts: [], removedFacts: [], changedFacts: [], seedKeys: [], isBodyOnly: true };

  for (const [factId, fact] of newFacts) {
    if (oldFacts.has(factId)) continue;
    result.addedFacts.push(factId);
    const kind = classifySemanticFact(fact);
    if (LOCAL_ONLY_FACT_KINDS.has(kind)) continue;
    result.isBodyOnly = false;
    result.seedKeys.push(...seedKeysForShapeFact(fact, kind, candidateFiles));
  }

  for (const [factId, fact] of oldFacts) {
    const stillPresent = newFacts.get(factId);
    const kind = classifySemanticFact(fact);
    if (!stillPresent) {
      result.removedFacts.push(factId);
      if (!LOCAL_ONLY_FACT_KINDS.has(kind)) {
        result.isBodyOnly = false;
        result.seedKeys.push(...seedKeysForShapeFact(fact, kind, candidateFiles));
      }
      continue;
    }
    if (factIdentityFingerprint(fact) === factIdentityFingerprint(stillPresent)) continue;
    result.changedFacts.push(factId);
    if (LOCAL_ONLY_FACT_KINDS.has(kind)) continue;
    result.isBodyOnly = false;
    result.seedKeys.push(...seedKeysForShapeFact(fact, kind, candidateFiles), ...seedKeysForShapeFact(stillPresent, kind, candidateFiles));
  }

  return result;
}

/**
 * Expand the closure's directly key-matched consumer facts to every
 * relationship fact in each affected file. A single matched name (e.g. a
 * call site using the original export name) proves the file is affected;
 * re-resolving only that one fact would miss sibling facts in the same file
 * that reach the same declaration through a local alias the name-keyed index
 * cannot see. Safe to over-invalidate within one already-affected file.
 */
function expandClosureToFiles(files: ReadonlySet<string>, snapshot: SemanticSnapshot): ReverseDependencyEntry[] {
  const expanded: ReverseDependencyEntry[] = [];
  for (const filePath of files) {
    const file = getSnapshotFile(snapshot, filePath);
    for (const fact of file?.facts ?? []) {
      const factKind = classifySemanticFact(fact);
      if (RELATIONSHIP_FACT_KINDS.has(factKind)) expanded.push({ factId: fact.factId, filePath, factKind });
    }
  }
  return expanded;
}

export function computeSemanticDelta(args: {
  changedFiles: readonly string[];
  deletedFiles: readonly string[];
  previousSnapshot: SemanticSnapshot | null;
  /** Freshly parsed facts for each entry of `changedFiles` only. */
  newFactsByFile: ReadonlyMap<string, readonly SemanticFact[]>;
  /** Reverse dependency index built from the full pre-change fact corpus (previousSnapshot). */
  reverseIndex: ReverseDependencyIndex | null;
  compatibility: SemanticSnapshotCompatibility;
  limits?: InvalidationClosureLimits;
}): SemanticDelta {
  const { changedFiles, deletedFiles, previousSnapshot, newFactsByFile, reverseIndex, compatibility } = args;
  const limits = args.limits ?? DEFAULT_INVALIDATION_CLOSURE_LIMITS;

  if (!isCompatibleSnapshot(previousSnapshot, compatibility)) {
    return fullFallbackDelta(changedFiles, deletedFiles, 'previous semantic snapshot missing or incompatible');
  }
  const snapshot = previousSnapshot as SemanticSnapshot;

  const addedFacts: string[] = [];
  const removedFacts: string[] = [];
  const changedFacts: string[] = [];
  const bodyOnlyFiles: string[] = [];
  const seedKeys: DependencyKey[] = [];

  for (const filePath of changedFiles) {
    const oldFileFacts = getSnapshotFile(snapshot, filePath)?.facts ?? [];
    const newFileFacts = newFactsByFile.get(filePath) ?? [];
    const diff = diffChangedFile(oldFileFacts, newFileFacts);
    addedFacts.push(...diff.addedFacts);
    removedFacts.push(...diff.removedFacts);
    changedFacts.push(...diff.changedFacts);
    seedKeys.push(...diff.seedKeys);
    if (diff.isBodyOnly) bodyOnlyFiles.push(filePath);
  }

  for (const filePath of deletedFiles) {
    const oldFileFacts = getSnapshotFile(snapshot, filePath)?.facts ?? [];
    for (const fact of oldFileFacts) {
      removedFacts.push(fact.factId);
      const kind = classifySemanticFact(fact);
      seedKeys.push(...seedKeysForShapeFact(fact, kind, [oldFileFacts]));
    }
  }

  const excludeFiles = new Set([...changedFiles, ...deletedFiles]);
  const closure = computeInvalidationClosure({ seedKeys, index: reverseIndex, excludeFiles, limits });
  if (closure.truncated) {
    return fullFallbackDelta(changedFiles, deletedFiles, closure.reason ?? 'invalidation closure could not be proven complete');
  }

  const expanded = expandClosureToFiles(closure.invalidatedFiles, snapshot);
  const invalidatedReferences = expanded.filter((f) => f.factKind === 'reference').map((f) => f.factId);
  const invalidatedCallSites = expanded.filter((f) => f.factKind === 'call-site').map((f) => f.factId);
  const invalidatedSymbols = expanded
    .filter((f) => f.factKind !== 'reference' && f.factKind !== 'call-site')
    .map((f) => f.factId);

  const anySemanticChange = addedFacts.length > 0 || removedFacts.length > 0 || changedFacts.length > 0 || expanded.length > 0;
  const affectedArtifacts = new Set<AffectedArtifact>();
  if (anySemanticChange) {
    affectedArtifacts.add('graph');
    affectedArtifacts.add('bm25');
    affectedArtifacts.add('evidence');
    if (changedFiles.length > 0 || deletedFiles.length > 0) affectedArtifacts.add('vector');
    if (closure.invalidatedFiles.size > 0 || bodyOnlyFiles.length < changedFiles.length) {
      affectedArtifacts.add('flows');
      affectedArtifacts.add('clusters');
      affectedArtifacts.add('program-analysis');
    }
  }

  return {
    changedFiles,
    deletedFiles,
    addedFacts: addedFacts.sort(),
    removedFacts: removedFacts.sort(),
    changedFacts: changedFacts.sort(),
    bodyOnlyFiles: bodyOnlyFiles.sort(),
    invalidatedReferences: invalidatedReferences.sort(),
    invalidatedCallSites: invalidatedCallSites.sort(),
    invalidatedSymbols: invalidatedSymbols.sort(),
    affectedArtifacts,
    requiresFullResolution: false,
  };
}
