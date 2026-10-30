/**
 * resolution/dispatch.ts
 *
 * Member-call dispatch over a receiver type set (receiver-types.ts):
 *  1. infer the receiver's static and possible runtime types;
 *  2. for each runtime type, find the member it actually executes — its
 *     own declaration, else the nearest inherited one (bounded walk up the
 *     forward heritage index);
 *  3. keep every distinct target; registration/constructor narrowing has
 *     already happened inside the type set, from exact evidence only;
 *  4. cap the emitted set and record why it is incomplete.
 *
 * Multiple valid targets are never collapsed to the highest-scoring one:
 * the outcome is `candidate-set` (or `truncated` past the cap), and a lone
 * candidate is `exact` only when the type set is complete. The result is a
 * standard `ResolutionOutcome`, so the existing materializer persists it
 * as ordinary `calls` edges with evidence — there is no private dispatch
 * edge store.
 */
import { createResolutionOutcome, type ResolutionCandidate, type ResolutionCertainty, type ResolutionOutcome } from './contracts.js';
import { DEFAULT_DISPATCH_CANDIDATE_LIMIT, noteDispatchIndexLookup, type ResolutionIndexes } from './indexes.js';
import { inferReceiverTypeSet, isOpenTypeDeclaration, typeDeclarations, type ReceiverTypeInput, type ReceiverTypeSet, type TypeCandidate } from './receiver-types.js';
import type { DeclarationFact } from '../semantic/facts.js';

export const DISPATCH_VERSION = 'dispatch-v1';

export interface DispatchCandidate extends ResolutionCandidate {
  runtimeTypeId: string;
  /** True when the runtime type inherits (does not itself declare) the member. */
  inherited: boolean;
}

export interface DispatchResolution {
  callSiteId: string;
  candidates: readonly DispatchCandidate[];
  complete: boolean;
  certainty: ResolutionCertainty;
  strategy: string;
  boundaries: readonly string[];
  totalKnownCandidates: number;
  receiverTypes: ReceiverTypeSet;
  version: string;
}

export interface DispatchInput extends ReceiverTypeInput {
  memberName: string;
  dispatchLimit?: number;
}

const STRATEGY_BY_EVIDENCE: Record<TypeCandidate['evidence'], string> = {
  constructor: 'constructor-dispatch',
  registration: 'registration-dispatch',
  'declared-type': 'receiver-type',
  'local-declaration': 'receiver-type',
  'self-receiver': 'receiver-type',
  'subtype-expansion': 'inheritance-dispatch',
};

const CONFIDENCE_BY_EVIDENCE: Record<TypeCandidate['evidence'], number> = {
  constructor: 0.99,
  registration: 0.97,
  'declared-type': 0.95,
  'local-declaration': 0.93,
  'self-receiver': 0.92,
  'subtype-expansion': 0.88,
};

/** The member a runtime type executes for `memberName`: its own, else the nearest inherited one (breadth-first up the heritage index). */
function memberFor(indexes: ResolutionIndexes, typeDecl: DeclarationFact, memberName: string, maxDepth: number): { member: DeclarationFact; inherited: boolean } | undefined {
  const visited = new Set<string>();
  let frontier: DeclarationFact[] = [typeDecl];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: DeclarationFact[] = [];
    for (const decl of frontier) {
      if (visited.has(decl.factId)) continue;
      visited.add(decl.factId);
      noteDispatchIndexLookup(indexes);
      const own = (indexes.declarationsByOwnerRef.get(decl.factId) ?? []).filter((item) => item.name === memberName).sort((a, b) => a.factId.localeCompare(b.factId))[0];
      if (own) return { member: own, inherited: depth > 0 };
      for (const heritage of indexes.heritageByDeclaration.get(decl.factId) ?? []) {
        const superName = heritage.target.name ?? heritage.target.text.trim();
        next.push(...typeDeclarations(indexes, superName));
      }
    }
    frontier = next;
  }
  return undefined;
}

export function resolveDispatch(indexes: ResolutionIndexes, input: DispatchInput): DispatchResolution | null {
  const receiverTypes = inferReceiverTypeSet(indexes, input);
  if (receiverTypes.staticTypes.length === 0) return null;
  const limit = input.dispatchLimit ?? DEFAULT_DISPATCH_CANDIDATE_LIMIT;
  const maxDepth = (input.limits?.maxHierarchyDepth ?? 6);
  const boundaries = new Set(receiverTypes.boundaries);

  const byTarget = new Map<string, DispatchCandidate>();
  for (const runtimeType of receiverTypes.possibleRuntimeTypes) {
    for (const typeId of runtimeType.declarationIds) {
      const typeDecl = indexes.declarationsByFactId.get(typeId);
      if (!typeDecl) continue;
      const found = memberFor(indexes, typeDecl, input.memberName, maxDepth);
      if (!found || byTarget.has(found.member.factId)) continue;
      // An abstract interface member is not something a runtime type executes.
      const owner = found.member.ownerRef ? indexes.declarationsByFactId.get(found.member.ownerRef) : undefined;
      if (found.inherited && owner && isOpenTypeDeclaration(owner)) continue;
      byTarget.set(found.member.factId, {
        targetId: found.member.factId,
        strategy: STRATEGY_BY_EVIDENCE[runtimeType.evidence],
        confidence: CONFIDENCE_BY_EVIDENCE[runtimeType.evidence],
        evidenceRefs: [...runtimeType.evidenceRefs, typeId, found.member.factId],
        runtimeTypeId: typeId,
        inherited: found.inherited,
      });
    }
  }

  let complete = receiverTypes.complete;
  if (byTarget.size === 0) {
    // No runtime type executes a known member: fall back to the static declaration(s), never claiming completeness.
    for (const staticType of receiverTypes.staticTypes) {
      for (const typeId of staticType.declarationIds) {
        const typeDecl = indexes.declarationsByFactId.get(typeId);
        const found = typeDecl ? memberFor(indexes, typeDecl, input.memberName, maxDepth) : undefined;
        if (!found || byTarget.has(found.member.factId)) continue;
        byTarget.set(found.member.factId, {
          targetId: found.member.factId,
          strategy: 'receiver-type',
          confidence: 0.85,
          evidenceRefs: [...staticType.evidenceRefs, typeId, found.member.factId],
          runtimeTypeId: typeId,
          inherited: found.inherited,
        });
      }
    }
    if (byTarget.size === 0) return null;
    boundaries.add('no-indexed-implementation');
    complete = false;
  }

  const all = [...byTarget.values()].sort((a, b) => a.targetId.localeCompare(b.targetId));
  const truncated = all.length > limit;
  if (truncated) boundaries.add('dispatch-candidate-limit');
  const candidates = truncated ? all.slice(0, limit) : all;
  const certainty: ResolutionCertainty = truncated ? 'truncated' : candidates.length === 1 && complete ? 'exact' : 'candidate-set';
  const strategies = [...new Set(candidates.map((item) => item.strategy))].sort();
  return {
    callSiteId: input.callSiteId,
    candidates,
    complete: complete && !truncated,
    certainty,
    strategy: strategies.join('|'),
    boundaries: [...boundaries].sort(),
    totalKnownCandidates: all.length,
    receiverTypes,
    version: DISPATCH_VERSION,
  };
}

/** The standard resolver outcome the materializer persists (calls edges + evidence). */
export function dispatchToResolutionOutcome(dispatch: DispatchResolution): ResolutionOutcome {
  return createResolutionOutcome({
    referenceId: dispatch.callSiteId,
    certainty: dispatch.certainty,
    candidates: dispatch.candidates.map(({ targetId, strategy, confidence, evidenceRefs }) => ({ targetId, strategy, confidence, evidenceRefs })),
    coverage: {
      complete: dispatch.complete,
      totalKnownCandidates: dispatch.totalKnownCandidates,
      emittedCandidates: dispatch.candidates.length,
      incompleteReasons: dispatch.complete ? [] : dispatch.boundaries,
    },
    ...(dispatch.boundaries.length > 0 ? { boundary: dispatch.boundaries.join(',') } : {}),
    resolverVersion: '',
  });
}
