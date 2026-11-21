/**
 * query/taint-trace.ts
 *
 * Read-only taint trace service behind CLI `taint-trace`, MCP `taint_trace`
 * and `GET /api/v1/taint-trace`. It loads the merged taint model registry
 * (built-in + framework adapters + `.code-intel/taint-models.json`), checks
 * per-language capability, runs the cached program-analysis taint engine —
 * interprocedurally through persisted call edges when the semantic graph
 * is trusted — and returns compact findings with explicit coverage.
 *
 * "No finding" is never reported as "safe": the `verdict` is
 * `no-findings-complete` only when every analyzed function ran under
 * supported language capability, with no truncation, no unevaluated
 * matchers and no gate/boundary; otherwise it is
 * `no-findings-partial-coverage` and `coverage.notes` say why. Even a
 * complete no-finding result is scoped to the active models, not a proof
 * of the absence of vulnerabilities.
 */
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode } from '../shared/index.js';
import type { CapabilityState } from '../languages/capability-types.js';
import { detectLanguage } from '../shared/detection.js';
import { resolveSymbolTarget, formatSymbolTarget } from '../cli/symbol-target.js';
import { getProgramAnalysisCapability } from '../program-analysis/languages/capability-registry.js';
import { loadTaintModelRegistry } from '../program-analysis/taint/model-loader.js';
import type { TaintModelRegistry } from '../program-analysis/taint/model-registry.js';
import type { TaintModelDiagnostic } from '../program-analysis/taint/model-schema.js';
import type { TaintCallHop, TaintFinding } from '../program-analysis/taint/contracts.js';
import { traceInterproceduralTaint } from '../program-analysis/taint/interprocedural.js';
import type { InterproceduralGateResult } from '../program-analysis/semantic-graph-gate.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, isDeadlineExceeded, startDeadline, type ProgramAnalysisLimits } from '../program-analysis/limits.js';

export const TAINT_TRACE_VERSION = 'taint-trace-v1';
const DEFAULT_MAX_FINDINGS = 50;
const DEFAULT_MAX_FUNCTIONS = 200;
// Caller-supplied limits are clamped so one request cannot opt out of the bounds.
const MAX_FINDINGS_CAP = 500;
const MAX_FUNCTIONS_CAP = 1000;
const FUNCTION_KINDS = new Set(['function', 'method', 'constructor']);

export interface TaintTraceRequest {
  repoDir: string;
  graph: KnowledgeGraph;
  /** Function/method selector (name or qualified `kind:name@file:line`). Without it, a bounded scan of function nodes runs. */
  symbol?: string;
  /** Filter: source matcher ref (`model/matcher`), matcher id, or model id. */
  source?: string;
  /** Filter: sink matcher ref, matcher id, model id, or category (`sql`, `command`, ...). */
  sink?: string;
  /** Follow persisted call edges (default: true with `symbol`, false for a scan). */
  interprocedural?: boolean;
  maxFindings?: number;
  /** Scan mode only: maximum function nodes analyzed (default 200). */
  maxFunctions?: number;
  /** Include propagation statement ids and line lists. */
  verbose?: boolean;
  /** Injected for tests; normally loaded from built-ins + adapters + project file. */
  registry?: TaintModelRegistry;
  gate?: InterproceduralGateResult;
  limits?: ProgramAnalysisLimits;
}

export interface TaintTraceFindingView {
  id: string;
  functionId: string;
  function: string;
  certainty: string;
  interprocedural: boolean;
  source: { modelId?: string; matcherId: string; strength?: string; filePath: string; line?: number; functionId?: string };
  sink: { modelId?: string; matcherId: string; category?: string; strength?: string; filePath: string; line?: number; functionId?: string };
  variable: string;
  sanitizers: { siblingStatementIds: readonly string[]; note?: string };
  path: { lines: readonly number[]; statementIds?: readonly string[]; hops: readonly TaintCallHop[] };
}

export type TaintTraceVerdict = 'findings' | 'no-findings-complete' | 'no-findings-partial-coverage' | 'unsupported' | 'not-found' | 'ambiguous' | 'model-error';

export interface TaintTraceResult {
  version: string;
  verdict: TaintTraceVerdict;
  summary: string;
  target?: { selector: string; filePath: string; line?: number; language?: string };
  candidates?: readonly string[];
  models: {
    fingerprint?: string;
    ids: readonly string[];
    projectModels: { status: string; path: string };
    diagnostics: readonly TaintModelDiagnostic[];
  };
  findings: readonly TaintTraceFindingView[];
  totalFindings: number;
  truncated: boolean;
  truncationReasons: readonly string[];
  coverage: {
    complete: boolean;
    analyzedFunctions: number;
    skippedFunctions: number;
    languages: Readonly<Record<string, CapabilityState>>;
    interprocedural: { requested: boolean; allowed: boolean; reason?: string };
    unevaluatedMatchers: readonly string[];
    boundaries: readonly string[];
    notes: readonly string[];
  };
}

function matchesSelector(selector: string | undefined, values: readonly (string | undefined)[]): boolean {
  if (!selector) return true;
  return values.some((value) => value === selector);
}

function filterFinding(finding: TaintFinding, request: TaintTraceRequest): boolean {
  return matchesSelector(request.source, [finding.sourceMatcherId, finding.sourceModelId, `${finding.sourceModelId}/${finding.sourceMatcherId}`])
    && matchesSelector(request.sink, [finding.sinkMatcherId, finding.sinkModelId, `${finding.sinkModelId}/${finding.sinkMatcherId}`, finding.sinkCategory]);
}

function nodeFilePath(graph: KnowledgeGraph, functionId: string | undefined, fallback: CodeNode): string {
  if (!functionId) return fallback.filePath;
  const node = graph.getNode(functionId) ?? [...graph.allNodes()].find((item) => item.identityId === functionId);
  return node?.filePath ?? fallback.filePath;
}

function view(graph: KnowledgeGraph, node: CodeNode, finding: TaintFinding, verbose: boolean): TaintTraceFindingView {
  return {
    id: finding.id,
    functionId: node.identityId ?? node.id,
    function: formatSymbolTarget(node),
    certainty: finding.certainty,
    interprocedural: (finding.hops?.length ?? 0) > 0,
    source: {
      ...(finding.sourceModelId ? { modelId: finding.sourceModelId } : {}),
      matcherId: finding.sourceMatcherId,
      ...(finding.sourceMatchStrength ? { strength: finding.sourceMatchStrength } : {}),
      filePath: nodeFilePath(graph, finding.sourceFunctionId, node),
      ...(finding.sourceLine !== undefined ? { line: finding.sourceLine } : {}),
      ...(finding.sourceFunctionId ? { functionId: finding.sourceFunctionId } : {}),
    },
    sink: {
      ...(finding.sinkModelId ? { modelId: finding.sinkModelId } : {}),
      matcherId: finding.sinkMatcherId,
      ...(finding.sinkCategory ? { category: finding.sinkCategory } : {}),
      ...(finding.sinkMatchStrength ? { strength: finding.sinkMatchStrength } : {}),
      filePath: nodeFilePath(graph, finding.sinkFunctionId, node),
      ...(finding.sinkLine !== undefined ? { line: finding.sinkLine } : {}),
      ...(finding.sinkFunctionId ? { functionId: finding.sinkFunctionId } : {}),
    },
    variable: finding.variableName,
    sanitizers: {
      siblingStatementIds: finding.sanitizedByStatementIds,
      ...(finding.sanitizedByStatementIds.length > 0 ? { note: 'a sanitizer cleans a different reaching path to this sink; this path is not sanitized' } : {}),
    },
    path: {
      lines: finding.propagationLines ?? [],
      ...(verbose ? { statementIds: finding.propagationStatementIds } : {}),
      hops: finding.hops ?? [],
    },
  };
}

function emptyResult(verdict: TaintTraceVerdict, summary: string, extra: Partial<TaintTraceResult> = {}): TaintTraceResult {
  return {
    version: TAINT_TRACE_VERSION,
    verdict,
    summary,
    models: { ids: [], projectModels: { status: 'absent', path: '.code-intel/taint-models.json' }, diagnostics: [] },
    findings: [],
    totalFindings: 0,
    truncated: false,
    truncationReasons: [],
    coverage: {
      complete: false,
      analyzedFunctions: 0,
      skippedFunctions: 0,
      languages: {},
      interprocedural: { requested: false, allowed: false },
      unevaluatedMatchers: [],
      boundaries: [],
      notes: [],
    },
    ...extra,
  };
}

function targetNodes(request: TaintTraceRequest): { nodes: CodeNode[]; error?: TaintTraceResult; omitted: number } {
  if (request.symbol) {
    const resolution = resolveSymbolTarget(request.graph, request.symbol);
    if (resolution.status === 'not-found') return { nodes: [], omitted: 0, error: emptyResult('not-found', `Symbol "${request.symbol}" not found.`) };
    if (resolution.status === 'ambiguous') {
      return { nodes: [], omitted: 0, error: emptyResult('ambiguous', `Symbol "${request.symbol}" is ambiguous; pass a qualified selector.`, { candidates: resolution.candidates.slice(0, 20).map(formatSymbolTarget) }) };
    }
    if (!FUNCTION_KINDS.has(resolution.node.kind)) {
      return { nodes: [], omitted: 0, error: emptyResult('unsupported', `"${request.symbol}" is a ${resolution.node.kind}; taint-trace analyzes functions and methods.`) };
    }
    return { nodes: [resolution.node], omitted: 0 };
  }
  const all = [...request.graph.allNodes()]
    .filter((node) => FUNCTION_KINDS.has(node.kind) && node.startLine !== undefined)
    .sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.startLine ?? 0) - (b.startLine ?? 0) || a.id.localeCompare(b.id));
  const max = Math.min(request.maxFunctions ?? DEFAULT_MAX_FUNCTIONS, MAX_FUNCTIONS_CAP);
  return { nodes: all.slice(0, max), omitted: Math.max(0, all.length - max) };
}

export async function traceTaint(request: TaintTraceRequest): Promise<TaintTraceResult> {
  const loaded = request.registry
    ? { registry: request.registry, projectModels: { status: 'injected', path: '.code-intel/taint-models.json' }, diagnostics: [] as TaintModelDiagnostic[] }
    : await loadTaintModelRegistry(request.repoDir);
  const projectModels = { status: loaded.projectModels.status, path: loaded.projectModels.path };
  if (!loaded.registry) {
    return emptyResult('model-error', 'Taint models failed validation; fix the diagnostics and retry. Built-in models are not substituted for an invalid project model.', {
      models: { ids: [], projectModels, diagnostics: loaded.diagnostics },
    });
  }
  const registry = loaded.registry;
  const models = { fingerprint: registry.fingerprint, ids: registry.models.map((model) => `${model.id}@${model.version}`), projectModels, diagnostics: [] };

  const { nodes, error, omitted } = targetNodes(request);
  if (error) return { ...error, models };

  const interproceduralRequested = request.interprocedural ?? !!request.symbol;
  const languages: Record<string, CapabilityState> = {};
  const notes = new Set<string>();
  const boundaries = new Set<string>();
  const unevaluated = new Set<string>();
  const truncationReasons = new Set<string>();
  let analyzedFunctions = 0;
  let skippedFunctions = 0;
  let interproceduralAllowed = interproceduralRequested;
  let gateReason: string | undefined;
  const views: TaintTraceFindingView[] = [];
  if (omitted > 0) truncationReasons.add(`scan limited to ${nodes.length} functions (${omitted} more not analyzed; raise maxFunctions or pass a symbol)`);

  // Each root gets its own per-request budget, so the scan as a whole shares one deadline.
  const limits = request.limits ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS;
  const scanDeadline = startDeadline(limits.maxAnalysisTimeMsPerRequest);
  for (const [index, node] of nodes.entries()) {
    if (index > 0 && isDeadlineExceeded(scanDeadline)) {
      truncationReasons.add(`maxAnalysisTimeMsPerRequest (${limits.maxAnalysisTimeMsPerRequest}ms) reached; ${nodes.length - index} functions not analyzed`);
      break;
    }
    const language = detectLanguage(node.filePath);
    const capability: CapabilityState = language ? getProgramAnalysisCapability(language).capabilities.taint : 'unsupported';
    languages[language ?? 'unknown'] = capability;
    if (capability === 'unsupported' || capability === 'not-applicable') {
      skippedFunctions += 1;
      notes.add(`taint analysis is ${capability} for ${language ?? `file ${node.filePath}`}`);
      continue;
    }
    if (capability === 'partial') notes.add(`taint analysis is partial for ${language} (lowering not integration-tested)`);

    const traced = await traceInterproceduralTaint({
      repoDir: request.repoDir,
      graph: request.graph,
      rootNodeId: node.id,
      registry,
      interprocedural: interproceduralRequested,
      ...(request.gate ? { gate: request.gate } : {}),
      limits,
    });
    if (traced.capability !== 'supported' || !traced.result) {
      skippedFunctions += 1;
      notes.add(`could not analyze ${formatSymbolTarget(node)}: ${traced.reason ?? 'unsupported'}`);
      continue;
    }
    analyzedFunctions += 1;
    if (interproceduralRequested && !traced.interprocedural.allowed) {
      interproceduralAllowed = false;
      gateReason = traced.interprocedural.reason;
    }
    for (const item of traced.boundaries) boundaries.add(item);
    for (const item of traced.truncationReasons) truncationReasons.add(item);
    for (const item of traced.result.unevaluatedMatcherRefs ?? []) unevaluated.add(item);
    for (const finding of traced.result.findings) if (filterFinding(finding, request)) views.push(view(request.graph, node, finding, !!request.verbose));
  }

  views.sort((a, b) => a.sink.filePath.localeCompare(b.sink.filePath) || (a.sink.line ?? 0) - (b.sink.line ?? 0) || a.id.localeCompare(b.id));
  const maxFindings = Math.min(request.maxFindings ?? DEFAULT_MAX_FINDINGS, MAX_FINDINGS_CAP);
  if (views.length > maxFindings) truncationReasons.add(`findings limited to ${maxFindings} of ${views.length}`);
  if (!interproceduralRequested) notes.add('interprocedural propagation not requested: taint crossing call boundaries is not traced');
  if (unevaluated.size > 0) notes.add('some context-dependent matchers (framework inputs/annotations) could not be evaluated for the analyzed functions');

  const complete = skippedFunctions === 0
    && analyzedFunctions > 0
    && truncationReasons.size === 0
    && unevaluated.size === 0
    && boundaries.size === 0
    && interproceduralRequested
    && interproceduralAllowed
    && Object.values(languages).every((state) => state === 'supported');

  let verdict: TaintTraceVerdict;
  let summary: string;
  if (views.length > 0) {
    verdict = 'findings';
    summary = `${views.length} candidate taint path(s) found. Findings are heuristic static evidence under the listed models, not confirmed exploitability.`;
  } else if (analyzedFunctions === 0) {
    verdict = 'unsupported';
    summary = 'No function could be analyzed (unsupported language or capability); this says nothing about taint safety.';
  } else if (complete) {
    verdict = 'no-findings-complete';
    summary = 'No taint path found under the active models with complete coverage for the analyzed scope. This is not a proof that the code is free of injection vulnerabilities — only the listed sources/sinks were checked.';
  } else {
    verdict = 'no-findings-partial-coverage';
    summary = 'No taint path found, but coverage is partial (see coverage.notes/boundaries); this must not be read as the code being safe.';
  }

  return {
    version: TAINT_TRACE_VERSION,
    verdict,
    summary,
    ...(request.symbol && nodes[0]
      ? { target: { selector: formatSymbolTarget(nodes[0]), filePath: nodes[0].filePath, ...(nodes[0].startLine ? { line: nodes[0].startLine } : {}), ...(detectLanguage(nodes[0].filePath) ? { language: detectLanguage(nodes[0].filePath)! } : {}) } }
      : {}),
    models,
    findings: views.slice(0, maxFindings),
    totalFindings: views.length,
    truncated: truncationReasons.size > 0,
    truncationReasons: [...truncationReasons].sort(),
    coverage: {
      complete,
      analyzedFunctions,
      skippedFunctions,
      languages,
      interprocedural: { requested: interproceduralRequested, allowed: interproceduralRequested && interproceduralAllowed, ...(gateReason ? { reason: gateReason } : {}) },
      unevaluatedMatchers: [...unevaluated].sort(),
      boundaries: [...boundaries].sort().slice(0, 50),
      notes: [...notes].sort(),
    },
  };
}
