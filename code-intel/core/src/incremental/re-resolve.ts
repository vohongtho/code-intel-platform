/**
 * re-resolve.ts
 *
 * Selects exactly the facts that must be run back through resolution after a
 * SemanticDelta: every relationship fact in a changed file (it was freshly
 * reparsed, so all of its relationship facts need a fresh resolution outcome
 * even if individually unchanged), plus every invalidated fact the closure
 * found in unchanged files. Also builds the merged, up-to-date fact corpus
 * (changed files replaced, deleted files removed) that `resolveReference`
 * needs fresh `ResolutionIndexes` built from.
 */
import type { SemanticFact } from '../semantic/facts.js';
import { RELATIONSHIP_FACT_KINDS, classifySemanticFact, getSnapshotFile, type SemanticSnapshot } from './semantic-snapshot.js';
import { factRef } from './reverse-dependency-index.js';
import type { SemanticDelta } from './semantic-delta.js';

/** The full, current fact corpus: previousSnapshot with changed files replaced and deleted files removed. */
export function mergedFactCorpus(args: {
  previousSnapshot: SemanticSnapshot;
  changedFiles: readonly string[];
  deletedFiles: readonly string[];
  newFactsByFile: ReadonlyMap<string, readonly SemanticFact[]>;
}): SemanticFact[] {
  const { previousSnapshot, changedFiles, deletedFiles, newFactsByFile } = args;
  const replaced = new Set([...changedFiles, ...deletedFiles]);
  const facts: SemanticFact[] = [];
  for (const file of previousSnapshot.files) {
    if (replaced.has(file.filePath)) continue;
    facts.push(...file.facts);
  }
  for (const filePath of changedFiles) facts.push(...(newFactsByFile.get(filePath) ?? []));
  return facts;
}

/**
 * Facts that must be re-run through `resolveReference`/`materializeSemanticRelationships`:
 * every relationship fact in a changed file, plus every fact the invalidation
 * closure found in an unchanged file.
 */
export function selectFactsForReResolution(args: {
  delta: SemanticDelta;
  previousSnapshot: SemanticSnapshot;
  newFactsByFile: ReadonlyMap<string, readonly SemanticFact[]>;
}): SemanticFact[] {
  const { delta, previousSnapshot, newFactsByFile } = args;
  // Keyed by factRef(filePath, factId), not bare factId — see reverse-dependency-index.ts's
  // factRef doc comment for why a bare-factId map can silently drop one side of a
  // cross-file collision (e.g. two changed files both importing the same local name).
  const selected = new Map<string, SemanticFact>();

  for (const filePath of delta.changedFiles) {
    for (const fact of newFactsByFile.get(filePath) ?? []) {
      if (RELATIONSHIP_FACT_KINDS.has(classifySemanticFact(fact))) selected.set(factRef(filePath, fact.factId), fact);
    }
  }

  const invalidatedFactIds = new Set([...delta.invalidatedReferences, ...delta.invalidatedCallSites, ...delta.invalidatedSymbols]);
  if (invalidatedFactIds.size > 0) {
    for (const file of previousSnapshot.files) {
      if (delta.changedFiles.includes(file.filePath) || delta.deletedFiles.includes(file.filePath)) continue;
      for (const fact of file.facts) {
        if (invalidatedFactIds.has(fact.factId)) selected.set(factRef(file.filePath, fact.factId), fact);
      }
    }
  }

  return [...selected.values()].sort((a, b) => a.factId.localeCompare(b.factId));
}

export function factsInInvalidatedFile(previousSnapshot: SemanticSnapshot, filePath: string): readonly SemanticFact[] {
  return getSnapshotFile(previousSnapshot, filePath)?.facts ?? [];
}
