import { createResolutionOutcome, type ResolutionCandidate, type ResolutionOutcome } from './contracts.js';
import { DEFAULT_DISPATCH_CANDIDATE_LIMIT, noteFullWorkspaceTraversal, type ResolutionIndexes } from './indexes.js';
import type { DeclarationFact, ImportBindingFact, PublishedNameFact } from '../semantic/facts.js';

export interface ReferenceContext {
  referenceId: string;
  filePath: string;
  name: string;
  ownerRef?: string;
  moduleRef?: string;
  localName?: string;
  receiverType?: DeclarationFact['type'];
  dispatchLimit?: number;
  maxDepth?: number;
}

function candidate(targetId: string, strategy: string, confidence: number, evidenceRefs: readonly string[]): ResolutionCandidate {
  return { targetId, strategy, confidence, evidenceRefs };
}

function uniqueCandidates(candidates: readonly ResolutionCandidate[]): ResolutionCandidate[] {
  const byTarget = new Map<string, ResolutionCandidate>();
  for (const item of candidates) {
    const prev = byTarget.get(item.targetId);
    if (!prev || item.confidence > prev.confidence) {
      byTarget.set(item.targetId, item);
      continue;
    }
    byTarget.set(item.targetId, {
      ...prev,
      evidenceRefs: Array.from(new Set([...prev.evidenceRefs, ...item.evidenceRefs])),
    });
  }
  return [...byTarget.values()];
}

export function resolveLexicalDeclarations(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionCandidate[] {
  const scoped = indexes.declarationsByOwnerRef.get(input.ownerRef ?? '') ?? [];
  return scoped
    .filter((item) => item.name === input.name)
    .map((item) => candidate(item.factId, 'lexical-scope', 0.98, [item.factId, input.ownerRef ?? '']));
}

function publicationMatches(indexes: ResolutionIndexes, publication: PublishedNameFact): readonly DeclarationFact[] {
  const exact = indexes.declarationsByFactId.get(publication.sourceRef);
  if (exact) return [exact];
  return indexes.declarationsByQualifiedName.get(publication.sourceRef) ?? [];
}

function walkPublishedName(
  indexes: ResolutionIndexes,
  moduleRef: string,
  publicName: string,
  maxDepth: number,
  visited: Set<string>,
): ResolutionCandidate[] {
  const visitKey = `${moduleRef}:${publicName}`;
  if (visited.has(visitKey) || maxDepth < 0) return [];
  visited.add(visitKey);

  const published = indexes.publishedNamesByModule.get(moduleRef) ?? [];
  const matches = published.filter((item) => item.publicName === publicName);
  if (matches.length === 0) return [];

  const results: ResolutionCandidate[] = [];
  for (const item of matches) {
    if (item.publicationKind === 'reexport') {
      results.push(...walkPublishedName(indexes, item.sourceRef, publicName, maxDepth - 1, visited).map((entry) => ({
        ...entry,
        confidence: Math.min(entry.confidence, 0.9),
        evidenceRefs: [item.factId, ...entry.evidenceRefs],
      })));
      continue;
    }
    for (const decl of publicationMatches(indexes, item)) {
      results.push(candidate(decl.factId, 'public-surface', item.publicationKind === 'definition' ? 0.95 : 0.85, [item.factId, decl.factId]));
    }
  }
  return results;
}

export function resolvePublicSurface(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionCandidate[] {
  if (!input.moduleRef) return [];
  return walkPublishedName(indexes, input.moduleRef, input.name, input.maxDepth ?? 8, new Set());
}

export function resolveImportBinding(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionCandidate[] {
  const bindings = indexes.importsByFile.get(input.filePath) ?? [];
  const binding = bindings.find((item) => item.localName === (input.localName ?? input.name));
  if (!binding) return [];
  return resolveImportBindingTarget(indexes, binding, input.maxDepth ?? 8);
}

function resolveImportBindingTarget(indexes: ResolutionIndexes, binding: ImportBindingFact, maxDepth: number): ResolutionCandidate[] {
  const importedName = binding.importedName ?? binding.localName;
  const direct = resolvePublicSurface(indexes, {
    referenceId: binding.factId,
    filePath: binding.filePath,
    name: importedName,
    moduleRef: binding.sourceModule,
    maxDepth,
  });
  if (direct.length > 0) {
    return direct.map((item) => ({ ...item, strategy: 'import-binding', confidence: Math.min(item.confidence, 0.96), evidenceRefs: [binding.factId, ...item.evidenceRefs] }));
  }
  return (indexes.declarationsByName.get(importedName) ?? []).map((decl) => candidate(decl.factId, 'import-binding', 0.6, [binding.factId, decl.factId]));
}

export function resolveQualifiedOwner(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionCandidate[] {
  if (!input.ownerRef) return [];
  const owned = indexes.declarationsByOwnerRef.get(input.ownerRef) ?? [];
  return owned
    .filter((item) => item.name === input.name)
    .map((item) => candidate(item.factId, 'qualified-owner', 0.97, [input.ownerRef!, item.factId]));
}

export function resolveReceiverType(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionCandidate[] {
  const names = new Set<string>();
  if (input.receiverType?.name) names.add(input.receiverType.name);
  if (input.receiverType?.text) names.add(input.receiverType.text.trim());
  const results: ResolutionCandidate[] = [];
  for (const typeName of names) {
    for (const owner of indexes.declarationsByTypeName.get(typeName) ?? []) {
      for (const member of indexes.declarationsByOwnerRef.get(owner.factId) ?? []) {
        if (member.name !== input.name) continue;
        results.push(candidate(member.factId, 'receiver-type', 0.99, [owner.factId, member.factId, typeName]));
      }
    }
  }
  return uniqueCandidates(results);
}

export function resolveInheritanceDispatch(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionOutcome | null {
  const limit = input.dispatchLimit ?? DEFAULT_DISPATCH_CANDIDATE_LIMIT;
  const typeNames = new Set<string>();
  if (input.receiverType?.name) typeNames.add(input.receiverType.name);
  if (input.receiverType?.text) typeNames.add(input.receiverType.text.trim());

  const ownerIds = new Set<string>();
  for (const typeName of typeNames) {
    for (const decl of indexes.declarationsByTypeName.get(typeName) ?? []) ownerIds.add(decl.factId);
    for (const [declId, heritageFacts] of indexes.heritageByDeclaration.entries()) {
      if (heritageFacts.some((fact) => fact.target.name === typeName || fact.target.text === typeName)) ownerIds.add(declId);
    }
  }

  const allCandidates: ResolutionCandidate[] = [];
  for (const ownerId of ownerIds) {
    for (const member of indexes.declarationsByOwnerRef.get(ownerId) ?? []) {
      if (member.name !== input.name) continue;
      allCandidates.push(candidate(member.factId, 'inheritance-dispatch', 0.88, [ownerId, member.factId]));
    }
  }
  const unique = uniqueCandidates(allCandidates);
  if (unique.length === 0) return null;

  const truncated = unique.length > limit;
  const candidates = truncated ? unique.slice(0, limit) : unique;
  return createResolutionOutcome({
    referenceId: input.referenceId,
    certainty: truncated ? 'truncated' : candidates.length === 1 ? 'exact' : 'candidate-set',
    candidates,
    coverage: {
      complete: !truncated,
      totalKnownCandidates: unique.length,
      emittedCandidates: candidates.length,
      incompleteReasons: truncated ? ['dispatch-candidate-limit'] : [],
    },
    resolverVersion: '',
  });
}

export function resolveRegistrationDispatch(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionCandidate[] {
  const results: ResolutionCandidate[] = [];
  for (const [subjectRef, registrations] of indexes.registrationsBySubject.entries()) {
    if (!registrations.some((item) => item.targetText === input.name || item.registrationKind === input.name)) continue;
    results.push(candidate(subjectRef, 'registration-dispatch', 0.8, registrations.map((item) => item.factId)));
  }
  return results;
}

export function resolveReference(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionOutcome {
  const dispatchOutcome = resolveInheritanceDispatch(indexes, input);
  const candidates = uniqueCandidates([
    ...resolveLexicalDeclarations(indexes, input),
    ...resolveReceiverType(indexes, input),
    ...resolveQualifiedOwner(indexes, input),
    ...resolveImportBinding(indexes, input),
    ...resolvePublicSurface(indexes, input),
    ...resolveRegistrationDispatch(indexes, input),
    ...(dispatchOutcome?.candidates ?? []),
  ]);

  if (candidates.length === 0) {
    noteFullWorkspaceTraversal(indexes);
    const fallback = (indexes.declarationsByName.get(input.name) ?? [])
      .map((decl) => candidate(decl.factId, 'name-fallback', 0.4, [decl.factId]));
    return createResolutionOutcome({
      referenceId: input.referenceId,
      certainty: fallback.length > 0 ? 'heuristic' : 'unresolved',
      candidates: fallback,
      coverage: {
        complete: fallback.length === 0,
        totalKnownCandidates: fallback.length || undefined,
        emittedCandidates: fallback.length,
        incompleteReasons: fallback.length > 0 ? ['global-name-fallback'] : [],
      },
      resolverVersion: '',
    });
  }

  return createResolutionOutcome({
    referenceId: input.referenceId,
    certainty: dispatchOutcome?.certainty === 'truncated' ? 'truncated' : candidates.length === 1 ? 'exact' : 'candidate-set',
    candidates,
    coverage: {
      complete: dispatchOutcome ? dispatchOutcome.coverage.complete : true,
      totalKnownCandidates: dispatchOutcome?.coverage.totalKnownCandidates ?? candidates.length,
      emittedCandidates: candidates.length,
      incompleteReasons: dispatchOutcome?.coverage.incompleteReasons ?? [],
    },
    resolverVersion: '',
  });
}
