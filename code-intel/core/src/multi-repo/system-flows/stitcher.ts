/**
 * stitcher.ts
 *
 * Pure, deterministic system-flow stitching.
 *
 * Indexes (built once, O(flows x steps + boundaries)):
 * - per repository: canonical symbol -> local flows that *start* at it, and
 *   -> local flows that *contain* it;
 * - (repository, canonical symbol) -> outgoing contract boundary edges.
 *
 * Walk: from each root local flow, for each step symbol look up outgoing
 * boundaries (one index probe per step), and continue only through an exact
 * boundary — exact certainty, non-name evidence, both endpoint symbols
 * resolved, both repositories with complete coverage — into the consumer
 * side's local flow (one starting at the entered symbol, else one containing
 * it; a symbol in no flow becomes a terminal entry-only segment). Anything
 * else becomes a candidate continuation, never an exact edge. Repository
 * cycles, hop/segment caps, partial coverage and unresolved endpoints stop a
 * chain with an explicit boundary.
 *
 * There is no nested scan over all flows x all contracts x all repositories.
 */

import type { AnalysisCertainty } from '../../shared/index.js';
import { systemFlowIdentity } from './identity.js';
import {
  DEFAULT_STITCH_LIMITS,
  STITCHER_VERSION,
  SYSTEM_FLOW_VERSION,
  type CandidateContinuation,
  type ContractBoundaryEdge,
  type LocalFlowRecord,
  type StitchCounters,
  type StitchInput,
  type StitchLimits,
  type StitchResult,
  type SystemFlow,
  type SystemFlowSegment,
  type SystemFlowStitchBoundary,
} from './types.js';

function key(repositoryId: string, symbolId: string): string {
  return `${repositoryId}\u0000${symbolId}`;
}

function pushIndex<T>(index: Map<string, T[]>, k: string, value: T): void {
  const list = index.get(k);
  if (list) list.push(value);
  else index.set(k, [value]);
}

function byFlowId(a: LocalFlowRecord, b: LocalFlowRecord): number {
  return a.repositoryId.localeCompare(b.repositoryId) || a.flowId.localeCompare(b.flowId);
}

function boundaryOrder(a: ContractBoundaryEdge, b: ContractBoundaryEdge): number {
  return a.contractId.localeCompare(b.contractId)
    || a.toRepositoryId.localeCompare(b.toRepositoryId)
    || (a.toSymbolId ?? '').localeCompare(b.toSymbolId ?? '')
    || a.consumerId.localeCompare(b.consumerId);
}

/** Why a boundary may not be stitched exactly, or undefined when it may. */
export function inexactReason(edge: ContractBoundaryEdge, coverage: ReadonlyMap<string, boolean>): string | undefined {
  if (edge.evidence === 'name-match') return 'name-only contract match is never an exact continuation';
  if (edge.certainty !== 'exact') return `contract link certainty is ${edge.certainty}`;
  if (!edge.fromSymbolId || !edge.toSymbolId) return edge.unresolvedReason ?? 'boundary endpoint symbol is unresolved';
  if (coverage.get(edge.fromRepositoryId) !== true) return `repository ${edge.fromRepositoryId} has partial/unknown coverage`;
  if (coverage.get(edge.toRepositoryId) !== true) return `repository ${edge.toRepositoryId} has partial/unknown coverage`;
  return undefined;
}

export function stitchSystemFlows(input: StitchInput): StitchResult {
  const limits: StitchLimits = { ...DEFAULT_STITCH_LIMITS, ...(input.limits ?? {}) };
  const counters: StitchCounters = { localFlows: 0, boundaryEdges: input.boundaries.length, boundaryLookups: 0, segments: 0, repositoryHops: 0, candidates: 0, capHits: 0 };
  const groupBoundaries: SystemFlowStitchBoundary[] = [];
  const coverage = new Map<string, boolean>();
  const startsAt = new Map<string, LocalFlowRecord[]>();
  const contains = new Map<string, LocalFlowRecord[]>();
  const flowsInOrder: LocalFlowRecord[] = [];

  for (const repo of [...input.repositories].sort((a, b) => a.repositoryId.localeCompare(b.repositoryId))) {
    coverage.set(repo.repositoryId, repo.coverageComplete);
    if (!repo.coverageComplete) {
      groupBoundaries.push({ kind: 'partial-coverage', repositoryId: repo.repositoryId, message: repo.incompleteReason ?? `repository ${repo.repositoryId} has partial coverage` });
    }
    for (const flow of [...repo.flows].sort(byFlowId)) {
      counters.localFlows += 1;
      flowsInOrder.push(flow);
      pushIndex(startsAt, key(flow.repositoryId, flow.entrySymbolId), flow);
      for (const step of new Set(flow.stepSymbolIds)) pushIndex(contains, key(flow.repositoryId, step), flow);
    }
  }

  const outgoing = new Map<string, ContractBoundaryEdge[]>();
  for (const edge of [...input.boundaries].sort(boundaryOrder)) {
    if (!edge.fromSymbolId) continue;
    pushIndex(outgoing, key(edge.fromRepositoryId, edge.fromSymbolId), edge);
  }
  const unresolvedFrom = input.boundaries.filter((edge) => !edge.fromSymbolId);
  for (const edge of unresolvedFrom) {
    groupBoundaries.push({ kind: 'unresolved-endpoint', repositoryId: edge.fromRepositoryId, message: `contract ${edge.contractId}: ${edge.unresolvedReason ?? 'source symbol unresolved'}` });
  }

  /** Flows an exact boundary continues into: those starting at the symbol, else those containing it. */
  const continuationFlows = (repositoryId: string, symbolId: string): LocalFlowRecord[] => {
    const starting = startsAt.get(key(repositoryId, symbolId));
    if (starting && starting.length > 0) return starting;
    return contains.get(key(repositoryId, symbolId)) ?? [];
  };

  const candidates = new Map<string, CandidateContinuation>();
  const addCandidate = (flow: LocalFlowRecord, edge: ContractBoundaryEdge, reason: string) => {
    const k = `${flow.flowId}\u0000${edge.contractId}\u0000${edge.toRepositoryId}\u0000${edge.toSymbolId ?? ''}\u0000${edge.consumerId}`;
    if (candidates.has(k)) return;
    if (candidates.size >= limits.maxCandidates) {
      counters.capHits += 1;
      return;
    }
    candidates.set(k, {
      fromRepositoryId: flow.repositoryId,
      fromFlowId: flow.flowId,
      fromSymbolId: edge.fromSymbolId,
      toRepositoryId: edge.toRepositoryId,
      toSymbolId: edge.toSymbolId,
      contractId: edge.contractId,
      kind: edge.kind,
      certainty: edge.certainty,
      evidence: edge.evidence,
      reason,
    });
  };

  // Exact outgoing edges per flow, and the set of flows reached by any exact edge (non-roots).
  const exactEdgesOf = (flow: LocalFlowRecord): Array<{ step: string; edge: ContractBoundaryEdge }> => {
    const out: Array<{ step: string; edge: ContractBoundaryEdge }> = [];
    for (const step of flow.stepSymbolIds) {
      counters.boundaryLookups += 1;
      for (const edge of outgoing.get(key(flow.repositoryId, step)) ?? []) {
        const reason = inexactReason(edge, coverage);
        if (reason) addCandidate(flow, edge, reason);
        else out.push({ step, edge });
      }
    }
    return out;
  };
  const exactByFlow = new Map<LocalFlowRecord, Array<{ step: string; edge: ContractBoundaryEdge }>>();
  const reached = new Set<LocalFlowRecord>();
  for (const flow of flowsInOrder) {
    const edges = exactEdgesOf(flow);
    if (edges.length === 0) continue;
    exactByFlow.set(flow, edges);
    for (const { edge } of edges) for (const target of continuationFlows(edge.toRepositoryId, edge.toSymbolId!)) reached.add(target);
  }

  const flows = new Map<string, SystemFlow>();
  const coveredByChain = new Set<LocalFlowRecord>();
  let systemFlowCapHit = false;

  const emit = (segments: SystemFlowSegment[], stop: SystemFlowStitchBoundary | undefined) => {
    if (segments.length < 2) return;
    const { id, fingerprint } = systemFlowIdentity(segments);
    if (flows.has(id)) return;
    if (flows.size >= limits.maxSystemFlows) {
      systemFlowCapHit = true;
      counters.capHits += 1;
      return;
    }
    const boundaries = stop && stop.kind !== 'end' ? [stop] : [];
    const missingLocal = segments.some((segment) => !segment.localFlowId);
    const truncatedStop = stop?.kind === 'hop-cap' || stop?.kind === 'segment-cap';
    const certainty: AnalysisCertainty = truncatedStop ? 'truncated' : missingLocal ? 'lower-bound' : 'exact';
    counters.segments += segments.length;
    counters.repositoryHops += segments.length - 1;
    flows.set(id, {
      id,
      fingerprint,
      algorithmVersion: SYSTEM_FLOW_VERSION,
      segments,
      certainty,
      coverage: {
        complete: !truncatedStop && !missingLocal,
        examinedCount: segments.length,
        incompleteReasons: [
          ...(missingLocal ? ['continuation entered a symbol with no stable local flow'] : []),
          ...(truncatedStop ? [stop!.message] : []),
        ],
      },
      boundaries,
    });
  };

  const segmentFor = (flow: LocalFlowRecord): SystemFlowSegment => ({
    repositoryId: flow.repositoryId,
    localFlowId: flow.flowId,
    localFlowFingerprint: flow.flowFingerprint,
    entrySymbolId: flow.entrySymbolId,
    stepSymbolIds: [...flow.stepSymbolIds],
  });

  const walk = (flow: LocalFlowRecord, chain: SystemFlowSegment[], repos: Set<string>, hops: number) => {
    coveredByChain.add(flow);
    if (systemFlowCapHit) return; // bounded work once the output cap is reached
    const edges = exactByFlow.get(flow) ?? [];
    if (edges.length === 0) {
      emit(chain, { kind: 'end', message: 'no further exact contract boundary' });
      return;
    }
    for (const { step, edge } of edges) {
      const last = chain[chain.length - 1]!;
      const boundary = {
        contractId: edge.contractId,
        kind: edge.kind,
        providerRepositoryId: edge.providerRepositoryId,
        consumerRepositoryId: edge.consumerRepositoryId,
        consumerId: edge.consumerId,
        certainty: 'exact' as const,
        evidence: edge.evidence,
      };
      const withExit: SystemFlowSegment = { ...last, exitSymbolId: step, boundaryToNext: boundary };
      const prefix = [...chain.slice(0, -1), withExit];
      if (repos.has(edge.toRepositoryId)) {
        emit(chain, { kind: 'cycle', repositoryId: edge.toRepositoryId, message: `repository cycle back into ${edge.toRepositoryId} via ${edge.contractId}` });
        continue;
      }
      if (hops + 1 > limits.maxHops || chain.length + 1 > limits.maxSegments) {
        counters.capHits += 1;
        emit(chain, { kind: hops + 1 > limits.maxHops ? 'hop-cap' : 'segment-cap', message: `stopped at ${hops} hop(s) / ${chain.length} segment(s) (caps ${limits.maxHops}/${limits.maxSegments})` });
        continue;
      }
      const targets = continuationFlows(edge.toRepositoryId, edge.toSymbolId!);
      if (targets.length === 0) {
        emit([...prefix, { repositoryId: edge.toRepositoryId, entrySymbolId: edge.toSymbolId!, stepSymbolIds: [edge.toSymbolId!] }], {
          kind: 'missing-local-flow',
          repositoryId: edge.toRepositoryId,
          message: `consumer symbol ${edge.toSymbolId} is in no stable local flow`,
        });
        continue;
      }
      for (const target of targets) {
        walk(target, [...prefix, segmentFor(target)], new Set([...repos, edge.toRepositoryId]), hops + 1);
      }
    }
  };

  // Roots first (flows with exact outgoing edges that no exact edge reaches), then any
  // remaining flow with outgoing edges (e.g. members of a repository cycle).
  const withEdges = flowsInOrder.filter((flow) => exactByFlow.has(flow));
  for (const flow of withEdges.filter((f) => !reached.has(f))) walk(flow, [segmentFor(flow)], new Set([flow.repositoryId]), 0);
  for (const flow of withEdges) {
    if (!coveredByChain.has(flow)) walk(flow, [segmentFor(flow)], new Set([flow.repositoryId]), 0);
  }

  counters.candidates = candidates.size;
  if (systemFlowCapHit) groupBoundaries.push({ kind: 'system-flow-cap', message: `system-flow cap ${limits.maxSystemFlows} reached; results are a lower bound` });
  if (counters.candidates >= limits.maxCandidates) groupBoundaries.push({ kind: 'candidate-cap', message: `candidate cap ${limits.maxCandidates} reached` });
  const partial = [...coverage.values()].some((complete) => !complete);
  const incompleteReasons = groupBoundaries.map((b) => b.message);

  return {
    stitcherVersion: STITCHER_VERSION,
    flows: [...flows.values()].sort((a, b) => a.id.localeCompare(b.id)),
    candidates: [...candidates.values()].sort((a, b) => a.fromFlowId.localeCompare(b.fromFlowId) || a.contractId.localeCompare(b.contractId) || a.toRepositoryId.localeCompare(b.toRepositoryId) || (a.toSymbolId ?? '').localeCompare(b.toSymbolId ?? '')),
    counters,
    coverage: {
      complete: !partial && !systemFlowCapHit && unresolvedFrom.length === 0 && counters.capHits === 0,
      examinedCount: counters.localFlows,
      incompleteReasons: [...new Set(incompleteReasons)].sort(),
    },
    boundaries: groupBoundaries.sort((a, b) => a.kind.localeCompare(b.kind) || a.message.localeCompare(b.message)),
  };
}
