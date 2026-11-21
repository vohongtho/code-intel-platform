/**
 * taint/interprocedural.ts
 *
 * Opt-in bounded interprocedural taint over the persisted semantic graph.
 *
 * The semantic graph is the only source of call targets: this module reads
 * `calls` edges (and their certainty/ambiguity) that the resolver —
 * including receiver dispatch (resolution/dispatch.ts) — already
 * materialized. It never runs a dispatch resolver of its own.
 *
 * A value crosses a call boundary only when:
 *  - `gateInterproceduralAnalysis` authorizes the graph (a stale, corrupt,
 *    legacy or missing index fails closed: intraprocedural results are
 *    still returned, with a `gated:` boundary);
 *  - the edge is `exact` or `candidate` certainty (heuristic name-fallback
 *    and legacy edges without certainty are not followed — boundary);
 *  - the argument-to-parameter mapping is known (else boundary);
 *  - the callee's taint summary transfers it;
 *  - depth/function-count/time budgets are not exhausted (else truncated).
 *
 * Every crossed hop bounds the path certainty by the edge certainty, so a
 * path through a candidate dispatch is never exact. Callee summaries are
 * computed bottom-up, transitively (a callee's summary already includes
 * its own callees), and memoized per request; leaf summaries are also
 * cached by content/model fingerprint in the shared program-analysis cache.
 */
import path from 'node:path';
import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import type { CodeEdge, CodeNode } from '../../shared/index.js';
import type { ResolutionCertainty } from '../../resolution/contracts.js';
import { RESOLVER_VERSION } from '../../resolution/contracts.js';
import { detectLanguage } from '../../shared/detection.js';
import { gateInterproceduralAnalysis, type InterproceduralGateResult } from '../semantic-graph-gate.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, isDeadlineExceeded, startDeadline, type ProgramAnalysisLimits } from '../limits.js';
import { analyzeFunctionTaint, analyzeFunctionTaintSummary, type FunctionTaintRequest } from '../pipeline.js';
import type { TaintAnalysisResult, TaintCallee, TaintCallResolver, TaintFunctionSummary } from './contracts.js';
import type { TaintModelRegistry } from './model-registry.js';
import type { TaintFunctionContext } from './matching.js';
import { calleePath } from './matching.js';

export const INTERPROCEDURAL_TAINT_VERSION = 'interprocedural-taint-v1';

const FUNCTION_KINDS = new Set(['function', 'method', 'constructor']);

export interface InterproceduralTaintInput {
  repoDir: string;
  graph: KnowledgeGraph;
  rootNodeId: string;
  registry: TaintModelRegistry;
  limits?: ProgramAnalysisLimits;
  /** Injected gate result (tests); defaults to `gateInterproceduralAnalysis(repoDir)`. */
  gate?: InterproceduralGateResult;
  /** Defaults to `true`. False analyzes the root intraprocedurally only. */
  interprocedural?: boolean;
}

export interface InterproceduralTaintResult {
  version: string;
  capability: 'supported' | 'unsupported';
  reason?: string;
  rootNodeId: string;
  result?: TaintAnalysisResult;
  interprocedural: { requested: boolean; allowed: boolean; reason?: string };
  analyzedFunctionCount: number;
  maxDepthReached: number;
  truncated: boolean;
  truncationReasons: readonly string[];
  boundaries: readonly string[];
}

/** Maps a persisted relationship certainty onto the resolver certainty scale. */
export function edgeCertainty(edge: CodeEdge): ResolutionCertainty | undefined {
  switch (edge.certainty) {
    case 'exact': return 'exact';
    case 'candidate': return 'candidate-set';
    case 'heuristic': return 'heuristic';
    default: return undefined;
  }
}

function lastSegment(text: string): string {
  const cleaned = text.trim().replace(/[()<>].*$/, '');
  return cleaned.split(/[:.#/\\]/).filter(Boolean).pop() ?? cleaned;
}

/** Function context for a graph node: parameters from parse metadata, frameworks from route `handles` edges. */
export function taintContextForNode(graph: KnowledgeGraph, node: CodeNode): TaintFunctionContext {
  const rawParameters = Array.isArray(node.metadata?.parameters) ? (node.metadata.parameters as Array<{ name?: unknown }>) : [];
  const parameterNames = rawParameters.map((item) => (typeof item?.name === 'string' ? item.name : '')).filter(Boolean);
  const frameworks = new Set<string>();
  for (const edge of graph.findEdgesTo(node.id)) {
    if (edge.kind !== 'handles') continue;
    const route = graph.getNode(edge.source);
    const semantic = route?.metadata?.semantic as { framework?: unknown; frameworkEvidence?: { frameworkId?: unknown } } | undefined;
    for (const value of [semantic?.framework, semantic?.frameworkEvidence?.frameworkId]) if (typeof value === 'string') frameworks.add(value);
  }
  return { parameterNames, routeHandlerFrameworks: [...frameworks].sort() };
}

export function functionTaintRequest(repoDir: string, node: CodeNode, registry: TaintModelRegistry, context: TaintFunctionContext): FunctionTaintRequest | { unsupported: string } {
  if (!FUNCTION_KINDS.has(node.kind)) return { unsupported: `node kind '${node.kind}' is not a function` };
  if (!node.startLine) return { unsupported: 'node has no source range' };
  const language = detectLanguage(node.filePath);
  if (!language) return { unsupported: `no language detected for ${node.filePath}` };
  return {
    language,
    filePath: path.isAbsolute(node.filePath) ? node.filePath : path.join(path.resolve(repoDir), node.filePath),
    startLine: node.startLine,
    canonicalFunctionId: node.identityId ?? node.id,
    parameterNames: context.parameterNames ?? [],
    resolverVersion: RESOLVER_VERSION,
    registry,
    context,
  };
}

interface DriverState {
  input: InterproceduralTaintInput;
  limits: ProgramAnalysisLimits;
  deadline: ReturnType<typeof startDeadline>;
  summaries: Map<string, Promise<TaintCallee['summary'] | { boundary: string }>>;
  analyzed: number;
  maxDepthReached: number;
  truncationReasons: Set<string>;
  boundaries: Set<string>;
  outgoing: Map<string, CodeEdge[]>;
}

function outgoingCalls(state: DriverState, nodeId: string): CodeEdge[] {
  const cached = state.outgoing.get(nodeId);
  if (cached) return cached;
  const calls = [...state.input.graph.findEdgesFrom(nodeId)].filter((edge) => edge.kind === 'calls').sort((a, b) => a.id.localeCompare(b.id));
  state.outgoing.set(nodeId, calls);
  return calls;
}

/**
 * Callees per call text for `nodeId`, each with a transitively computed
 * summary (or a boundary). Only `exact`/`candidate` edges to function
 * nodes are followed.
 */
async function calleeTable(state: DriverState, nodeId: string, depth: number, stack: readonly string[]): Promise<Map<string, TaintCallee[]>> {
  const table = new Map<string, TaintCallee[]>();
  for (const edge of outgoingCalls(state, nodeId)) {
    const key = lastSegment(edge.label ?? '');
    if (!key) continue;
    const certainty = edgeCertainty(edge);
    const target = state.input.graph.getNode(edge.target);
    let callee: TaintCallee;
    if (!certainty) {
      callee = { functionId: edge.target, certainty: 'unresolved', complete: false, boundary: `legacy-call-edge-without-certainty:${edge.target}` };
    } else if (certainty === 'heuristic') {
      callee = { functionId: edge.target, certainty, complete: false, boundary: `heuristic-call-edge-not-followed:${edge.target}` };
    } else if (!target || !FUNCTION_KINDS.has(target.kind)) {
      callee = { functionId: edge.target, certainty, complete: false, boundary: `non-function-call-target:${edge.target}` };
    } else {
      const summary = await summaryFor(state, target, depth + 1, stack);
      callee = {
        functionId: target.identityId ?? target.id,
        certainty,
        complete: !edge.ambiguous,
        ...(edge.strategy ? { strategy: edge.strategy } : {}),
        ...('boundary' in (summary ?? {}) ? { boundary: (summary as { boundary: string }).boundary } : { summary: summary as TaintFunctionSummary }),
      };
    }
    const bucket = table.get(key) ?? [];
    bucket.push(callee);
    table.set(key, bucket);
  }
  return table;
}

function resolverFor(table: Map<string, TaintCallee[]>): TaintCallResolver {
  return ({ callText }) => {
    const pathText = calleePath(callText);
    if (!pathText) return { callees: [], boundary: 'unparseable-call' };
    const callees = table.get(lastSegment(pathText)) ?? [];
    return callees.length > 0 ? { callees } : { callees: [], boundary: `no-persisted-call-edge:${lastSegment(pathText)}` };
  };
}

async function summaryFor(state: DriverState, node: CodeNode, depth: number, stack: readonly string[]): Promise<TaintFunctionSummary | { boundary: string }> {
  if (stack.includes(node.id)) return { boundary: `recursive-call:${node.id}` };
  if (depth > state.limits.maxCallSummaryDepth) {
    state.truncationReasons.add(`maxCallSummaryDepth (${state.limits.maxCallSummaryDepth})`);
    return { boundary: `call-depth-limit:${node.id}` };
  }
  if (isDeadlineExceeded(state.deadline)) {
    state.truncationReasons.add(`maxAnalysisTimeMsPerRequest (${state.limits.maxAnalysisTimeMsPerRequest}ms)`);
    return { boundary: `time-limit:${node.id}` };
  }
  const memoKey = node.id;
  const existing = state.summaries.get(memoKey);
  if (existing) return (await existing) as TaintFunctionSummary | { boundary: string };
  if (state.analyzed >= state.limits.maxAnalyzedFunctionsPerRequest) {
    state.truncationReasons.add(`maxAnalyzedFunctionsPerRequest (${state.limits.maxAnalyzedFunctionsPerRequest})`);
    return { boundary: `function-count-limit:${node.id}` };
  }
  state.analyzed += 1;
  state.maxDepthReached = Math.max(state.maxDepthReached, depth);

  const promise = (async (): Promise<TaintFunctionSummary | { boundary: string }> => {
    const context = taintContextForNode(state.input.graph, node);
    const request = functionTaintRequest(state.input.repoDir, node, state.input.registry, context);
    if ('unsupported' in request) return { boundary: `callee-unsupported:${node.id}:${request.unsupported}` };
    const table = await calleeTable(state, node.id, depth, [...stack, node.id]);
    const summarized = await analyzeFunctionTaintSummary({ ...request, limits: state.limits, ...(table.size > 0 ? { callResolver: resolverFor(table) } : {}) });
    if (summarized.capability !== 'supported' || !summarized.summary) return { boundary: `callee-unsupported:${node.id}:${summarized.reason ?? summarized.capability}` };
    if (summarized.summary.truncated) state.truncationReasons.add(`callee summary truncated: ${node.id}`);
    for (const boundary of summarized.summary.boundaries) state.boundaries.add(boundary);
    return summarized.summary;
  })();
  state.summaries.set(memoKey, promise as Promise<TaintFunctionSummary | { boundary: string }>);
  return promise;
}

export async function traceInterproceduralTaint(input: InterproceduralTaintInput): Promise<InterproceduralTaintResult> {
  const limits = input.limits ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS;
  const requested = input.interprocedural !== false;
  const root = input.graph.getNode(input.rootNodeId);
  const base = { version: INTERPROCEDURAL_TAINT_VERSION, rootNodeId: input.rootNodeId, analyzedFunctionCount: 0, maxDepthReached: 0 };
  if (!root) {
    return { ...base, capability: 'unsupported', reason: 'root node not found', interprocedural: { requested, allowed: false }, truncated: false, truncationReasons: [], boundaries: [] };
  }

  const gate = requested ? (input.gate ?? gateInterproceduralAnalysis(input.repoDir)) : undefined;
  const allowed = !!gate?.allowed;
  const state: DriverState = {
    input,
    limits,
    deadline: startDeadline(limits.maxAnalysisTimeMsPerRequest),
    summaries: new Map(),
    analyzed: 1,
    maxDepthReached: 0,
    truncationReasons: new Set(),
    boundaries: new Set(),
    outgoing: new Map(),
  };
  if (requested && !allowed) state.boundaries.add(`gated: ${gate?.reason ?? 'semantic graph is not trusted'}`);

  const context = taintContextForNode(input.graph, root);
  const request = functionTaintRequest(input.repoDir, root, input.registry, context);
  if ('unsupported' in request) {
    return { ...base, capability: 'unsupported', reason: request.unsupported, interprocedural: { requested, allowed, ...(gate?.reason ? { reason: gate.reason } : {}) }, truncated: false, truncationReasons: [], boundaries: [...state.boundaries] };
  }

  const table = allowed ? await calleeTable(state, root.id, 0, [root.id]) : undefined;
  const analyzed = await analyzeFunctionTaint({ ...request, limits, ...(table && table.size > 0 ? { callResolver: resolverFor(table) } : {}) });
  if (analyzed.capability !== 'supported' || !analyzed.result) {
    return { ...base, capability: 'unsupported', reason: analyzed.reason, interprocedural: { requested, allowed }, truncated: false, truncationReasons: [], boundaries: [...state.boundaries] };
  }
  for (const boundary of analyzed.result.boundaries ?? []) state.boundaries.add(boundary);
  if (analyzed.result.truncated) state.truncationReasons.add(analyzed.result.reason ?? 'root analysis truncated');

  return {
    ...base,
    capability: 'supported',
    result: analyzed.result,
    interprocedural: { requested, allowed, ...(gate?.reason ? { reason: gate.reason } : {}) },
    analyzedFunctionCount: state.analyzed,
    maxDepthReached: state.maxDepthReached,
    truncated: state.truncationReasons.size > 0,
    truncationReasons: [...state.truncationReasons].sort(),
    boundaries: [...state.boundaries].sort(),
  };
}
