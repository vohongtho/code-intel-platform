import type { DeclarationFact, FactId, HeritageFact, ImportBindingFact, PublishedNameFact, RegistrationFact, SemanticFact, TypeReferenceFact } from '../semantic/facts.js';

export const DEFAULT_DISPATCH_CANDIDATE_LIMIT = 8;

export interface ResolutionInstrumentation {
  indexBuildCount: number;
  fullWorkspaceTraversalCount: number;
}

export interface ResolutionIndexes {
  declarationsByFactId: ReadonlyMap<FactId, DeclarationFact>;
  declarationsByName: ReadonlyMap<string, readonly DeclarationFact[]>;
  declarationsByQualifiedName: ReadonlyMap<string, readonly DeclarationFact[]>;
  declarationsByOwnerRef: ReadonlyMap<string, readonly DeclarationFact[]>;
  declarationsByTypeName: ReadonlyMap<string, readonly DeclarationFact[]>;
  importsByFile: ReadonlyMap<string, readonly ImportBindingFact[]>;
  publishedNamesByModule: ReadonlyMap<string, readonly PublishedNameFact[]>;
  heritageByDeclaration: ReadonlyMap<string, readonly HeritageFact[]>;
  registrationsBySubject: ReadonlyMap<string, readonly RegistrationFact[]>;
  instrumentation: ResolutionInstrumentation;
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function freezeBuckets<K, V>(map: Map<K, V[]>): ReadonlyMap<K, readonly V[]> {
  return new Map(Array.from(map.entries(), ([key, values]) => [key, Object.freeze([...values])]));
}

export function createResolutionInstrumentation(): ResolutionInstrumentation {
  return {
    indexBuildCount: 0,
    fullWorkspaceTraversalCount: 0,
  };
}

function typeNamesOf(type?: TypeReferenceFact): string[] {
  if (!type) return [];
  const names = new Set<string>();
  if (type.name) names.add(type.name);
  if (type.text) names.add(type.text.trim());
  for (const arg of type.arguments ?? []) for (const item of typeNamesOf(arg)) names.add(item);
  if (type.target) for (const item of typeNamesOf(type.target)) names.add(item);
  if (type.returnType) for (const item of typeNamesOf(type.returnType)) names.add(item);
  for (const item of type.parameterTypes ?? []) for (const nested of typeNamesOf(item)) names.add(nested);
  for (const item of type.elements ?? []) for (const nested of typeNamesOf(item)) names.add(nested);
  return [...names];
}

export function buildResolutionIndexes(facts: readonly SemanticFact[], instrumentation = createResolutionInstrumentation()): ResolutionIndexes {
  instrumentation.indexBuildCount += 1;

  const declarationsByFactId = new Map<FactId, DeclarationFact>();
  const declarationsByName = new Map<string, DeclarationFact[]>();
  const declarationsByQualifiedName = new Map<string, DeclarationFact[]>();
  const declarationsByOwnerRef = new Map<string, DeclarationFact[]>();
  const declarationsByTypeName = new Map<string, DeclarationFact[]>();
  const importsByFile = new Map<string, ImportBindingFact[]>();
  const publishedNamesByModule = new Map<string, PublishedNameFact[]>();
  const heritageByDeclaration = new Map<string, HeritageFact[]>();
  const registrationsBySubject = new Map<string, RegistrationFact[]>();

  for (const fact of facts) {
    if ('declarationKind' in fact && 'name' in fact && 'anchors' in fact) {
      declarationsByFactId.set(fact.factId, fact);
      append(declarationsByName, fact.name, fact);
      if (fact.qualifiedName) append(declarationsByQualifiedName, fact.qualifiedName, fact);
      if (fact.ownerRef) append(declarationsByOwnerRef, fact.ownerRef, fact);
      for (const name of typeNamesOf(fact.type)) append(declarationsByTypeName, name, fact);
      continue;
    }
    if ('sourceModule' in fact && 'localName' in fact) {
      append(importsByFile, fact.filePath, fact);
      continue;
    }
    if ('moduleRef' in fact && 'publicName' in fact) {
      append(publishedNamesByModule, fact.moduleRef, fact);
      continue;
    }
    if ('heritageKind' in fact && 'target' in fact) {
      if (fact.declarationRef) append(heritageByDeclaration, fact.declarationRef, fact);
      continue;
    }
    if ('registrationKind' in fact && 'targetText' in fact && !('bindingKind' in fact)) {
      if (fact.subjectRef) append(registrationsBySubject, fact.subjectRef, fact);
    }
  }

  return {
    declarationsByFactId,
    declarationsByName: freezeBuckets(declarationsByName),
    declarationsByQualifiedName: freezeBuckets(declarationsByQualifiedName),
    declarationsByOwnerRef: freezeBuckets(declarationsByOwnerRef),
    declarationsByTypeName: freezeBuckets(declarationsByTypeName),
    importsByFile: freezeBuckets(importsByFile),
    publishedNamesByModule: freezeBuckets(publishedNamesByModule),
    heritageByDeclaration: freezeBuckets(heritageByDeclaration),
    registrationsBySubject: freezeBuckets(registrationsBySubject),
    instrumentation,
  };
}

export function noteFullWorkspaceTraversal(indexes: ResolutionIndexes): void {
  indexes.instrumentation.fullWorkspaceTraversalCount += 1;
}
