import { createResolutionOutcome, type ResolutionCandidate, type ResolutionOutcome } from './contracts.js';
import { noteFullWorkspaceTraversal, type ResolutionIndexes } from './indexes.js';
import { dispatchToResolutionOutcome, resolveDispatch } from './dispatch.js';
import type { DeclarationFact, ImportBindingFact, PublishedNameFact } from '../semantic/facts.js';
import type { Language } from '../shared/languages.js';

export interface ReferenceContext {
  referenceId: string;
  filePath: string;
  name: string;
  ownerRef?: string;
  moduleRef?: string;
  localName?: string;
  receiverType?: DeclarationFact['type'];
  /** Receiver expression text (`this`, `repo`, `new Foo()`), for receiver type-set inference. */
  receiverText?: string;
  language?: Language;
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

function hasReceiverEvidence(input: ReferenceContext): boolean {
  return !!input.receiverType || !!input.receiverText;
}

/**
 * Receiver dispatch through the shared receiver type-set engine
 * (dispatch.ts): every runtime target the type/hierarchy/registration
 * evidence permits, with explicit completeness. Null when there is no
 * receiver evidence or no member could be found.
 */
export function resolveInheritanceDispatch(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionOutcome | null {
  if (!hasReceiverEvidence(input)) return null;
  const dispatch = resolveDispatch(indexes, {
    callSiteId: input.referenceId,
    language: input.language,
    receiver: { text: input.receiverText ?? input.receiverType?.text ?? '', type: input.receiverType },
    callerRef: input.ownerRef,
    memberName: input.name,
    dispatchLimit: input.dispatchLimit,
  });
  return dispatch ? dispatchToResolutionOutcome(dispatch) : null;
}

export function resolveRegistrationDispatch(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionCandidate[] {
  const bySubject = new Map<string, string[]>();
  for (const registration of indexes.registrationsByTarget.get(input.name) ?? []) {
    if (!registration.subjectRef) continue;
    const refs = bySubject.get(registration.subjectRef) ?? [];
    refs.push(registration.factId);
    bySubject.set(registration.subjectRef, refs);
  }
  return [...bySubject.entries()].map(([subjectRef, refs]) => candidate(subjectRef, 'registration-dispatch', 0.8, [...new Set(refs)].sort()));
}

export function resolveReference(indexes: ResolutionIndexes, input: ReferenceContext): ResolutionOutcome {
  // With receiver evidence, the dispatch engine owns receiver/member targets
  // (static-type members of open interfaces are not runtime targets).
  const dispatchOutcome = resolveInheritanceDispatch(indexes, input);
  const candidates = uniqueCandidates([
    ...resolveLexicalDeclarations(indexes, input),
    ...(dispatchOutcome ? [] : resolveReceiverType(indexes, input)),
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
    certainty: dispatchOutcome?.certainty === 'truncated'
      ? 'truncated'
      : candidates.length === 1 && (dispatchOutcome?.coverage.complete ?? true) ? 'exact' : 'candidate-set',
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
