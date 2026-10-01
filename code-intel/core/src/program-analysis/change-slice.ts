import type { ResolutionCertainty } from '../resolution/contracts.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, isDeadlineExceeded, startDeadline, type ProgramAnalysisLimits } from './limits.js';
import type { PdgEdge, PdgEdgeKind, ProgramDependenceGraph } from './pdg/contracts.js';
import { boundCertaintyByCallRelationship, gateInterproceduralAnalysis } from './semantic-graph-gate.js';

export interface SliceNode {
  statementId: string;
  dependencyKind: PdgEdgeKind;
  distance: number;
}

export interface ChangeSlice {
  supported: boolean;
  functionId: string;
  seedStatementIds: string[];
  forward: SliceNode[];
  backward?: SliceNode[];
  dataDependencies: number;
  controlDependencies: number;
  truncated: boolean;
  reason?: string;
  certainty: ResolutionCertainty;
}

export interface SliceCallEdge {
  sourceFunctionId: string;
  targetFunctionId: string;
  certainty: ResolutionCertainty;
  evidenceRef?: string;
}

export interface ProjectedSliceImpact {
  functionId: string;
  certainty: ResolutionCertainty;
  depth: number;
  callPath: string[];
  evidenceRefs: string[];
}

export interface InterproceduralSliceProjection {
  allowed: boolean;
  projected: ProjectedSliceImpact[];
  truncated: boolean;
  reason?: string;
}

interface TraversalResult {
  nodes: SliceNode[];
  dataDependencies: number;
  controlDependencies: number;
  truncated: boolean;
  reason?: string;
}

function traverse(
  pdg: ProgramDependenceGraph,
  seeds: readonly string[],
  direction: 'forward' | 'backward',
  limits: ProgramAnalysisLimits,
): TraversalResult {
  const adjacency = new Map<string, PdgEdge[]>();
  for (const edge of pdg.edges) {
    const key = direction === 'forward' ? edge.fromStatementId : edge.toStatementId;
    const list = adjacency.get(key) ?? [];
    list.push(edge);
    adjacency.set(key, list);
  }
  for (const edges of adjacency.values()) {
    edges.sort((a, b) => (
      a.kind.localeCompare(b.kind)
      || a.fromStatementId.localeCompare(b.fromStatementId)
      || a.toStatementId.localeCompare(b.toStatementId)
    ));
  }

  const deadline = startDeadline(limits.maxAnalysisTimeMsPerFunction);
  const visited = new Set(seeds);
  const queue = seeds.map((statementId) => ({ statementId, distance: 0 }));
  const nodes: SliceNode[] = [];
  let iterations = 0;
  let dataDependencies = 0;
  let controlDependencies = 0;

  while (queue.length > 0) {
    if (iterations >= limits.maxWorklistIterations) {
      return { nodes, dataDependencies, controlDependencies, truncated: true, reason: 'change slice worklist iteration budget exceeded' };
    }
    if (isDeadlineExceeded(deadline)) {
      return { nodes, dataDependencies, controlDependencies, truncated: true, reason: 'change slice analysis time budget exceeded' };
    }
    iterations += 1;

    const current = queue.shift()!;
    for (const edge of adjacency.get(current.statementId) ?? []) {
      const nextId = direction === 'forward' ? edge.toStatementId : edge.fromStatementId;
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      const node = { statementId: nextId, dependencyKind: edge.kind, distance: current.distance + 1 };
      nodes.push(node);
      queue.push({ statementId: nextId, distance: node.distance });
      if (edge.kind === 'data') dataDependencies += 1;
      else controlDependencies += 1;
      if (nodes.length >= limits.maxStatementsPerFunction) {
        return { nodes, dataDependencies, controlDependencies, truncated: true, reason: 'change slice statement budget exceeded' };
      }
    }
  }

  return { nodes, dataDependencies, controlDependencies, truncated: false };
}

export function buildChangeSlice(input: {
  pdg: ProgramDependenceGraph;
  seedStatementIds: readonly string[];
  includeBackward?: boolean;
  limits?: ProgramAnalysisLimits;
}): ChangeSlice {
  const { pdg } = input;
  const knownStatements = new Set(pdg.statementIds);
  const seeds = [...new Set(input.seedStatementIds.filter((id) => knownStatements.has(id)))].sort((a, b) => a.localeCompare(b));
  if (seeds.length === 0) {
    return {
      supported: false,
      functionId: pdg.functionId,
      seedStatementIds: [],
      forward: [],
      dataDependencies: 0,
      controlDependencies: 0,
      truncated: false,
      reason: 'No seed statement belongs to the supplied program dependence graph.',
      certainty: 'unresolved',
    };
  }

  const limits = input.limits ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS;
  const forward = traverse(pdg, seeds, 'forward', limits);
  const backward = input.includeBackward ? traverse(pdg, seeds, 'backward', limits) : undefined;
  const traversalTruncated = forward.truncated || Boolean(backward?.truncated);
  const truncated = pdg.truncated || traversalTruncated;

  return {
    supported: true,
    functionId: pdg.functionId,
    seedStatementIds: seeds,
    forward: forward.nodes,
    backward: backward?.nodes,
    dataDependencies: forward.dataDependencies + (backward?.dataDependencies ?? 0),
    controlDependencies: forward.controlDependencies + (backward?.controlDependencies ?? 0),
    truncated,
    reason: pdg.reason ?? forward.reason ?? backward?.reason,
    certainty: truncated ? 'truncated' : 'exact',
  };
}

/**
 * Projects an intraprocedural slice through supplied semantic call edges only
 * when the repository index passes the existing trust gate. Certainty is
 * reduced at every hop, so a later exact edge cannot strengthen an earlier
 * heuristic or truncated conclusion.
 */
export function projectChangeSliceAcrossCalls(input: {
  repoDir: string;
  slice: ChangeSlice;
  callEdges: readonly SliceCallEdge[];
  limits?: ProgramAnalysisLimits;
}): InterproceduralSliceProjection {
  if (!input.slice.supported) {
    return { allowed: false, projected: [], truncated: false, reason: input.slice.reason ?? 'change slice is unsupported' };
  }

  const gate = gateInterproceduralAnalysis(input.repoDir);
  if (!gate.allowed) return { allowed: false, projected: [], truncated: false, reason: gate.reason };

  const limits = input.limits ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS;
  const edgesBySource = new Map<string, SliceCallEdge[]>();
  for (const edge of input.callEdges) {
    const edges = edgesBySource.get(edge.sourceFunctionId) ?? [];
    edges.push(edge);
    edgesBySource.set(edge.sourceFunctionId, edges);
  }
  for (const edges of edgesBySource.values()) {
    edges.sort((a, b) => (
      a.targetFunctionId.localeCompare(b.targetFunctionId)
      || a.certainty.localeCompare(b.certainty)
      || (a.evidenceRef ?? '').localeCompare(b.evidenceRef ?? '')
    ));
  }

  const visited = new Set([input.slice.functionId]);
  const queue: Array<{
    functionId: string;
    certainty: ResolutionCertainty;
    depth: number;
    callPath: string[];
    evidenceRefs: string[];
  }> = [{
    functionId: input.slice.functionId,
    certainty: input.slice.certainty,
    depth: 0,
    callPath: [input.slice.functionId],
    evidenceRefs: [],
  }];
  const projected: ProjectedSliceImpact[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const outgoing = edgesBySource.get(current.functionId) ?? [];
    if (current.depth >= limits.maxCallSummaryDepth) {
      if (outgoing.some((edge) => !visited.has(edge.targetFunctionId))) {
        return { allowed: true, projected, truncated: true, reason: 'interprocedural projection call-depth budget exceeded' };
      }
      continue;
    }

    for (const edge of outgoing) {
      if (visited.has(edge.targetFunctionId)) continue;
      visited.add(edge.targetFunctionId);
      const impact: ProjectedSliceImpact = {
        functionId: edge.targetFunctionId,
        certainty: boundCertaintyByCallRelationship(current.certainty, edge.certainty),
        depth: current.depth + 1,
        callPath: [...current.callPath, edge.targetFunctionId],
        evidenceRefs: edge.evidenceRef ? [...current.evidenceRefs, edge.evidenceRef] : [...current.evidenceRefs],
      };
      projected.push(impact);
      if (projected.length >= limits.maxAnalyzedFunctionsPerRequest) {
        return { allowed: true, projected, truncated: true, reason: 'interprocedural projection function budget exceeded' };
      }
      queue.push(impact);
    }
  }

  return { allowed: true, projected, truncated: false };
}
