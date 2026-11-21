/**
 * resolution/receiver-types.ts
 *
 * Receiver type-set inference for member calls: which static type(s) the
 * receiver expression has, and which runtime types may actually receive
 * the call. Built only on the prepared resolution indexes (indexes.ts) —
 * declaration-by-type-name, ownership, reverse heritage
 * (`subtypesByTypeName`) and DI bindings — so each inference costs a
 * number of lookups proportional to the receiver's own hierarchy, never a
 * workspace scan.
 *
 * Evidence, strongest first:
 *  - `constructor`: the receiver is itself a construction expression
 *    (`new Foo().run()`, Go `Foo{}`/`&Foo{}`, a Python call of an indexed
 *    class) — the runtime type is exactly that class;
 *  - `registration`: one exact, static DI binding maps the static contract
 *    to one implementation;
 *  - `declared-type`: the call fact carries a receiver type annotation;
 *  - `local-declaration`: the receiver names a typed declaration owned by
 *    the caller or by the caller's owner (parameter/local/field);
 *  - `self-receiver`: `this`/`self` inside a method — the owner type, whose
 *    subclasses may override.
 *
 * Completeness is explicit. The set is complete only when every static
 * type was found in the index, hierarchy expansion hit no cap, and the
 * static type is not an open interface. An interface/trait/protocol is
 * always open — other code (or, for structurally-typed languages, any
 * shape-compatible value) may implement it — so a single indexed
 * implementation never becomes a unique runtime type unless constructor
 * or exact registration evidence proves it.
 */
import { Language } from '../shared/languages.js';
import type { DeclarationFact, ReceiverFact, TypeReferenceFact } from '../semantic/facts.js';
import { noteDispatchIndexLookup, type ResolutionIndexes } from './indexes.js';

export const RECEIVER_TYPE_VERSION = 'receiver-types-v1';

export type ReceiverTypeEvidenceKind =
  | 'constructor'
  | 'registration'
  | 'declared-type'
  | 'local-declaration'
  | 'self-receiver'
  | 'subtype-expansion';

export interface TypeCandidate {
  typeName: string;
  /** Indexed declarations of this type (empty: not in the workspace index). */
  declarationIds: readonly string[];
  evidence: ReceiverTypeEvidenceKind;
  /** True when this exact type (not a subtype) is proven to be the runtime type. */
  exact: boolean;
  /** Fact ids backing the evidence. */
  evidenceRefs: readonly string[];
}

export interface ReceiverTypeSet {
  callSiteId: string;
  staticTypes: readonly TypeCandidate[];
  possibleRuntimeTypes: readonly TypeCandidate[];
  complete: boolean;
  boundaries: readonly string[];
  /** Strongest evidence kind that determined the static type, or `none`. */
  strategy: ReceiverTypeEvidenceKind | 'none';
  version: string;
}

export interface ReceiverTypeLimits {
  maxRuntimeTypes: number;
  maxHierarchyDepth: number;
}

export const DEFAULT_RECEIVER_TYPE_LIMITS: ReceiverTypeLimits = { maxRuntimeTypes: 32, maxHierarchyDepth: 6 };

/**
 * Per-language receiver semantics. Only languages whose dispatch rules are
 * modeled here get one; any other language still uses declared-type
 * evidence but every result carries a `dispatch-adapter-unavailable`
 * boundary and is never complete.
 */
export interface ReceiverTypeLanguageAdapter {
  language: Language;
  selfReceivers: readonly string[];
  constructorSyntax: 'new' | 'class-call' | 'composite-literal' | 'none';
  /** Interfaces are satisfied without a declared heritage edge (TS structural typing, Go implicit interfaces). */
  structuralInterfaces: boolean;
  registrationNarrowing: boolean;
  boundaries: readonly string[];
}

export const RECEIVER_TYPE_LANGUAGE_ADAPTERS: Partial<Record<Language, ReceiverTypeLanguageAdapter>> = {
  [Language.TypeScript]: { language: Language.TypeScript, selfReceivers: ['this'], constructorSyntax: 'new', structuralInterfaces: true, registrationNarrowing: true, boundaries: ['structural interface satisfaction', 'prototype mutation'] },
  [Language.JavaScript]: { language: Language.JavaScript, selfReceivers: ['this'], constructorSyntax: 'new', structuralInterfaces: true, registrationNarrowing: false, boundaries: ['prototype mutation', 'dynamic property assignment'] },
  [Language.Python]: { language: Language.Python, selfReceivers: ['self', 'cls'], constructorSyntax: 'class-call', structuralInterfaces: true, registrationNarrowing: false, boundaries: ['monkey patching', 'duck typing'] },
  [Language.Java]: { language: Language.Java, selfReceivers: ['this'], constructorSyntax: 'new', structuralInterfaces: false, registrationNarrowing: true, boundaries: ['reflection', 'runtime proxies'] },
  [Language.CSharp]: { language: Language.CSharp, selfReceivers: ['this'], constructorSyntax: 'new', structuralInterfaces: false, registrationNarrowing: true, boundaries: ['reflection', 'dynamic keyword'] },
  [Language.Go]: { language: Language.Go, selfReceivers: [], constructorSyntax: 'composite-literal', structuralInterfaces: true, registrationNarrowing: false, boundaries: ['implicit interface satisfaction'] },
  [Language.Rust]: { language: Language.Rust, selfReceivers: ['self'], constructorSyntax: 'none', structuralInterfaces: false, registrationNarrowing: false, boundaries: ['trait objects from external crates', 'macro-generated impls'] },
};

const TYPE_DECLARATION_KINDS = new Set(['class', 'interface', 'struct', 'trait', 'enum', 'protocol', 'record', 'type', 'object', 'abstract-class']);
const OPEN_TYPE_KINDS = new Set(['interface', 'trait', 'protocol']);

export interface ReceiverTypeInput {
  callSiteId: string;
  language?: Language;
  receiver?: ReceiverFact;
  /** Declaration fact id of the calling function/method. */
  callerRef?: string;
  limits?: ReceiverTypeLimits;
}

function typeNames(type: TypeReferenceFact | undefined): string[] {
  if (!type) return [];
  if (type.kind === 'union' && type.elements?.length) return type.elements.flatMap(typeNames);
  if ((type.kind === 'pointer' || type.kind === 'reference') && type.target) return typeNames(type.target);
  const names = new Set<string>();
  if (type.name) names.add(type.name);
  else if (type.text) names.add(type.text.trim().replace(/^[*&]+/, '').replace(/<.*$/, ''));
  return [...names].filter(Boolean);
}

/** Declarations that define type `name` (by declared type name, or by being a type-kind declaration with that name). */
export function typeDeclarations(indexes: ResolutionIndexes, name: string): DeclarationFact[] {
  noteDispatchIndexLookup(indexes, 2);
  const byId = new Map<string, DeclarationFact>();
  for (const decl of indexes.declarationsByTypeName.get(name) ?? []) {
    if (decl.type?.name === name || decl.type?.text.trim() === name || TYPE_DECLARATION_KINDS.has(decl.declarationKind)) byId.set(decl.factId, decl);
  }
  for (const decl of indexes.declarationsByName.get(name) ?? []) {
    if (TYPE_DECLARATION_KINDS.has(decl.declarationKind) || decl.traits?.nominalType) byId.set(decl.factId, decl);
  }
  return [...byId.values()].sort((a, b) => a.factId.localeCompare(b.factId));
}

export function isOpenTypeDeclaration(decl: DeclarationFact): boolean {
  return OPEN_TYPE_KINDS.has(decl.declarationKind);
}

function candidate(typeName: string, declarations: readonly DeclarationFact[], evidence: ReceiverTypeEvidenceKind, exact: boolean, evidenceRefs: readonly string[]): TypeCandidate {
  return { typeName, declarationIds: declarations.map((decl) => decl.factId), evidence, exact, evidenceRefs: [...new Set(evidenceRefs)].sort() };
}

function constructorTypeName(text: string, adapter: ReceiverTypeLanguageAdapter | undefined, indexes: ResolutionIndexes): string | undefined {
  const trimmed = text.trim().replace(/^\(+|\)+$/g, '');
  const syntax = adapter?.constructorSyntax;
  if (syntax === 'new') return /^new\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/.exec(trimmed)?.[1];
  if (syntax === 'composite-literal') return /^&?([A-Za-z_]\w*)\s*\{/.exec(trimmed)?.[1];
  if (syntax === 'class-call') {
    const name = /^([A-Za-z_]\w*)\s*\(/.exec(trimmed)?.[1];
    return name && (indexes.declarationsByName.get(name) ?? []).some((decl) => decl.declarationKind === 'class') ? name : undefined;
  }
  return undefined;
}

/** Static types from the strongest available evidence. */
function staticTypesFor(indexes: ResolutionIndexes, input: ReceiverTypeInput, adapter: ReceiverTypeLanguageAdapter | undefined): TypeCandidate[] {
  const receiver = input.receiver;
  if (!receiver) return [];

  const constructed = constructorTypeName(receiver.text, adapter, indexes);
  if (constructed) return [candidate(constructed, typeDeclarations(indexes, constructed), 'constructor', true, [])];

  const declared = typeNames(receiver.type);
  if (declared.length > 0) return declared.map((name) => candidate(name, typeDeclarations(indexes, name), 'declared-type', false, []));

  const caller = input.callerRef ? indexes.declarationsByFactId.get(input.callerRef) : undefined;
  noteDispatchIndexLookup(indexes);
  const receiverName = receiver.text.trim();
  if (adapter?.selfReceivers.includes(receiverName)) {
    const owner = caller?.ownerRef ? indexes.declarationsByFactId.get(caller.ownerRef) : undefined;
    if (!owner) return [];
    const ownerTypeName = owner.type?.name ?? owner.name;
    return [{ ...candidate(ownerTypeName, [owner], 'self-receiver', false, [owner.factId]) }];
  }

  if (/^[A-Za-z_$][\w$]*$/.test(receiverName) && caller) {
    // A typed parameter/local owned by the caller, else a typed field owned by the caller's owner.
    for (const scopeRef of [caller.factId, caller.ownerRef].filter((item): item is string => !!item)) {
      noteDispatchIndexLookup(indexes);
      const local = (indexes.declarationsByOwnerRef.get(scopeRef) ?? []).find((decl) => decl.name === receiverName && decl.type);
      if (local) return typeNames(local.type).map((name) => candidate(name, typeDeclarations(indexes, name), 'local-declaration', false, [local.factId]));
    }
    const parameter = caller.signature?.parameters.find((item) => item.name === receiverName && item.type);
    if (parameter) return typeNames(parameter.type).map((name) => candidate(name, typeDeclarations(indexes, name), 'local-declaration', false, [caller.factId]));
  }
  return [];
}

interface Expansion {
  runtime: TypeCandidate[];
  boundaries: string[];
  complete: boolean;
}

/** Transitive subtypes through the reverse-heritage index, bounded by depth and count. */
function expandSubtypes(indexes: ResolutionIndexes, root: TypeCandidate, limits: ReceiverTypeLimits): Expansion {
  const seen = new Set<string>(root.declarationIds);
  const runtime: TypeCandidate[] = [];
  const boundaries: string[] = [];
  let complete = true;
  let frontier: Array<{ name: string; ids: readonly string[] }> = [{ name: root.typeName, ids: root.declarationIds }];
  for (let depth = 0; frontier.length > 0; depth += 1) {
    if (depth >= limits.maxHierarchyDepth) {
      boundaries.push(`hierarchy-depth-cap:${limits.maxHierarchyDepth}`);
      complete = false;
      break;
    }
    const next: Array<{ name: string; ids: readonly string[] }> = [];
    for (const type of frontier) {
      noteDispatchIndexLookup(indexes);
      const heritage = [...(indexes.subtypesByTypeName.get(type.name) ?? [])].sort((a, b) => a.factId.localeCompare(b.factId));
      for (const fact of heritage) {
        const subtype = fact.declarationRef ? indexes.declarationsByFactId.get(fact.declarationRef) : undefined;
        if (!subtype || seen.has(subtype.factId)) continue;
        seen.add(subtype.factId);
        if (runtime.length >= limits.maxRuntimeTypes) {
          boundaries.push(`runtime-type-cap:${limits.maxRuntimeTypes}`);
          return { runtime, boundaries, complete: false };
        }
        const name = subtype.type?.name ?? subtype.name;
        runtime.push(candidate(name, [subtype], 'subtype-expansion', false, [fact.factId]));
        next.push({ name, ids: [subtype.factId] });
      }
    }
    frontier = next;
  }
  return { runtime, boundaries, complete };
}

function registrationNarrowing(indexes: ResolutionIndexes, typeName: string): { candidate?: TypeCandidate; boundary?: string } {
  noteDispatchIndexLookup(indexes);
  const bindings = (indexes.dependencyBindingsByContract.get(typeName) ?? []).filter((binding) => binding.implementationRef);
  if (bindings.length === 0) return {};
  const exact = bindings.filter((binding) => binding.frameworkEvidence?.exact && !binding.dynamic);
  const implementations = [...new Set(exact.map((binding) => binding.implementationRef!))];
  if (exact.length !== bindings.length || implementations.length !== 1) return { boundary: `registration-not-unique:${typeName}` };
  const implementation = implementations[0]!;
  return { candidate: candidate(implementation, typeDeclarations(indexes, implementation), 'registration', true, exact.map((binding) => binding.factId)) };
}

const cacheByIndexes = new WeakMap<ResolutionIndexes, Map<string, ReceiverTypeSet>>();

export function inferReceiverTypeSet(indexes: ResolutionIndexes, input: ReceiverTypeInput): ReceiverTypeSet {
  const cacheKey = JSON.stringify([RECEIVER_TYPE_VERSION, input.callSiteId, input.language ?? null, input.receiver ?? null, input.callerRef ?? null, input.limits ?? null]);
  let cache = cacheByIndexes.get(indexes);
  if (!cache) {
    cache = new Map();
    cacheByIndexes.set(indexes, cache);
  }
  const cached = cache.get(cacheKey);
  if (cached) {
    indexes.instrumentation.receiverTypeCacheHitCount = (indexes.instrumentation.receiverTypeCacheHitCount ?? 0) + 1;
    return cached;
  }
  indexes.instrumentation.receiverTypeInferenceCount = (indexes.instrumentation.receiverTypeInferenceCount ?? 0) + 1;
  const result = computeReceiverTypeSet(indexes, input);
  cache.set(cacheKey, result);
  return result;
}

function computeReceiverTypeSet(indexes: ResolutionIndexes, input: ReceiverTypeInput): ReceiverTypeSet {
  const limits = input.limits ?? DEFAULT_RECEIVER_TYPE_LIMITS;
  const adapter = input.language ? RECEIVER_TYPE_LANGUAGE_ADAPTERS[input.language] : undefined;
  const boundaries = new Set<string>();
  let complete = true;
  if (input.language && !adapter) {
    boundaries.add(`dispatch-adapter-unavailable:${input.language}`);
    complete = false;
  }

  const staticTypes = staticTypesFor(indexes, input, adapter);
  if (staticTypes.length === 0) {
    boundaries.add('unresolved-receiver-type');
    return { callSiteId: input.callSiteId, staticTypes, possibleRuntimeTypes: [], complete: false, boundaries: [...boundaries].sort(), strategy: 'none', version: RECEIVER_TYPE_VERSION };
  }

  const runtime = new Map<string, TypeCandidate>();
  const add = (item: TypeCandidate) => {
    const key = item.declarationIds.join('|') || `unindexed:${item.typeName}`;
    if (!runtime.has(key)) runtime.set(key, item);
  };

  for (const staticType of staticTypes) {
    const declarations = staticType.declarationIds.map((id) => indexes.declarationsByFactId.get(id)).filter((decl): decl is DeclarationFact => !!decl);
    if (declarations.length === 0) {
      boundaries.add(`unindexed-type:${staticType.typeName}`);
      complete = false;
      add(staticType);
      continue;
    }
    if (staticType.exact) {
      add(staticType);
      continue;
    }
    const open = declarations.some(isOpenTypeDeclaration);
    if (open && (adapter?.registrationNarrowing ?? true)) {
      const narrowed = registrationNarrowing(indexes, staticType.typeName);
      if (narrowed.boundary) boundaries.add(narrowed.boundary);
      if (narrowed.candidate && narrowed.candidate.declarationIds.length > 0) {
        add(narrowed.candidate);
        continue;
      }
    }
    if (!open) add(staticType);
    if (open) {
      boundaries.add(`open-interface-implementations:${staticType.typeName}`);
      complete = false;
    }
    const expansion = expandSubtypes(indexes, staticType, limits);
    for (const item of expansion.runtime) add(item);
    for (const item of expansion.boundaries) boundaries.add(item);
    if (!expansion.complete) complete = false;
  }

  const strengthOrder: ReceiverTypeEvidenceKind[] = ['constructor', 'registration', 'declared-type', 'local-declaration', 'self-receiver', 'subtype-expansion'];
  const strategy = strengthOrder.find((kind) => staticTypes.some((item) => item.evidence === kind)) ?? 'none';
  return {
    callSiteId: input.callSiteId,
    staticTypes,
    possibleRuntimeTypes: [...runtime.values()],
    complete,
    boundaries: [...boundaries].sort(),
    strategy,
    version: RECEIVER_TYPE_VERSION,
  };
}
