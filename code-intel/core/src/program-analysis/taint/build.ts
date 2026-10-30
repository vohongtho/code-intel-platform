/**
 * taint/build.ts
 *
 * Bounded source-to-sink taint analysis over the same artifacts as
 * function summaries (reaching-definitions/def-use), plus a per-block
 * replay of "which definition of each name reaches this exact statement"
 * so a sink call's individual arguments can be checked, not just its
 * overall call text.
 *
 * Sources, sinks and sanitizers come from a merged model registry
 * (model-registry.ts); a legacy `TaintRuleSet` is adapted into a
 * text-fallback model. A definition is tainted when its value expression
 * matches a source, or its value is computed from a tainted name — a
 * plain name read, or a non-call expression (concatenation, member/index
 * read, cast...) reading one (field-insensitive: a tainted object taints
 * its members). A call's result is tainted only when a source matcher
 * says so or, in interprocedural mode, when the callee's taint summary
 * transfers it; an unmodeled call never silently launders or propagates.
 *
 * Sanitization is path-specific and category-specific: a sanitizer cleans
 * only the vulnerability classes its model declares (`*` = every class,
 * the legacy behavior), only on the path that passes through it. When a
 * sanitized definition and an unsanitized one both reach the same sink,
 * the unsanitized path is still reported and the sanitizer is attached as
 * sibling evidence — it never suppresses the other path.
 */
import type { FunctionIr, IrExpression } from '../ir/contracts.js';
import type { FunctionCfg } from '../cfg/contracts.js';
import type { Definition, ReachingDefinitionsResult } from '../dataflow/reaching-definitions.js';
import type { DefUseChains } from '../dataflow/def-use.js';
import type { ResolutionCertainty } from '../../resolution/contracts.js';
import { boundCertaintyByCallRelationship } from '../contracts.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, type ProgramAnalysisLimits } from '../limits.js';
import {
  TAINT_VERSION,
  type TaintAnalysisResult,
  type TaintCallHop,
  type TaintCallResolver,
  type TaintFinding,
  type TaintRuleSet,
  type TaintSummaryReturnSource,
} from './contracts.js';
import { matchersForLanguage, registryFromLegacyRuleSet, type TaintModelRegistry } from './model-registry.js';
import {
  bareIdentifier,
  callArgumentTexts,
  calleePath,
  identifierReads,
  matchTaintRole,
  type RegisteredTaintMatcher,
  type TaintFunctionContext,
  type TaintModelMatch,
} from './matching.js';
import type { TaintCategory, TaintMatchStrength } from './model-schema.js';

const MAX_BOUNDARIES = 50;
/** Statement kinds whose primary expression can be a (sink) call: `exec(x)`, `y = exec(x)`, `return exec(x)`, `await exec(x)`... */
const SINK_BEARING_KINDS: ReadonlySet<string> = new Set(['call', 'declaration', 'assignment', 'await', 'return', 'yield', 'throw']);
/** Statement-level matching never proves symbol identity (see contracts.ts). */
const STATEMENT_EVIDENCE_CERTAINTY: ResolutionCertainty = 'heuristic';

type TaintOrigin =
  | { kind: 'source'; statementId: string; match: TaintModelMatch }
  | { kind: 'parameter'; parameterIndex: number; statementId: string }
  | { kind: 'callee-return'; statementId: string; returnSource: TaintSummaryReturnSource };

interface DefinitionTaint {
  tainted: boolean;
  origin?: TaintOrigin;
  /** Definition statement ids from source to this definition, inclusive. */
  propagation: string[];
  /** Categories cleaned on this path (`*` = all). */
  cleaned: ReadonlySet<string>;
  /** Sanitizer statements applied on this path. */
  sanitizerStatementIds: readonly string[];
  certainty: ResolutionCertainty;
  hops: readonly TaintCallHop[];
}

const CLEAN: DefinitionTaint = { tainted: false, propagation: [], cleaned: new Set(), sanitizerStatementIds: [], certainty: STATEMENT_EVIDENCE_CERTAINTY, hops: [] };

/** A tainted value reaching a sink argument — the engine's raw output before shaping into findings/summaries. */
export interface TaintSinkFlow {
  origin: TaintOrigin;
  sinkStatementId: string;
  sinkMatch: TaintModelMatch;
  /** Function owning the sink when it lies inside a callee (`hops` non-empty). */
  sinkFunctionId?: string;
  sinkStatementInCallee?: string;
  sinkLineInCallee?: number;
  variableName: string;
  propagation: readonly string[];
  siblingSanitizerStatementIds: readonly string[];
  certainty: ResolutionCertainty;
  hops: readonly TaintCallHop[];
}

export interface TaintReturnFlow {
  origin: TaintOrigin;
  returnStatementId: string;
  certainty: ResolutionCertainty;
  hops: readonly TaintCallHop[];
}

export interface TaintFlowAnalysis {
  sinkFlows: readonly TaintSinkFlow[];
  returnFlows: readonly TaintReturnFlow[];
  /** Parameters whose read reached a return only through a full (`*`) sanitizer. */
  sanitizedParameterReturns: readonly number[];
  unevaluatedMatcherRefs: readonly string[];
  boundaries: readonly string[];
  depthCapHit: boolean;
  modelFingerprint: string;
}

interface TaintTraceContext {
  ir: FunctionIr;
  definitions: Readonly<Record<string, Definition>>;
  matchers: readonly RegisteredTaintMatcher[];
  functionContext: TaintFunctionContext;
  parameterSeeds: ReadonlyMap<string, number>;
  callResolver?: TaintCallResolver;
  /** statement id -> name -> definition ids reaching the start of that statement. */
  reachingAt: Map<string, Map<string, Set<string>>>;
  memo: Map<string, DefinitionTaint>;
  maxDepth: number;
  depthCapHit: boolean;
  unevaluated: Set<string>;
  boundaries: Set<string>;
}

function primaryExpression(ir: FunctionIr, statementId: string): IrExpression | undefined {
  const exprId = ir.statements[statementId]?.expressions[0];
  return exprId ? ir.expressions[exprId] : undefined;
}

function noteBoundary(ctx: TaintTraceContext, boundary: string): void {
  if (ctx.boundaries.size < MAX_BOUNDARIES) ctx.boundaries.add(boundary);
}

function matchRole(ctx: TaintTraceContext, role: 'source' | 'sink' | 'sanitizer', statementId: string, expr: IrExpression | undefined, text?: string): TaintModelMatch[] {
  const statement = ctx.ir.statements[statementId];
  if (!statement) return [];
  const { matches, unevaluated } = matchTaintRole(ctx.matchers, role, { statementKind: statement.kind, expressionKind: expr?.kind, text: text ?? expr?.name }, ctx.functionContext);
  for (const ref of unevaluated) ctx.unevaluated.add(ref);
  return matches;
}

function weaker(left: ResolutionCertainty, right: ResolutionCertainty): ResolutionCertainty {
  return boundCertaintyByCallRelationship(left, right);
}

/** Taint of a name as read at `statementId` (the union of its reaching definitions, first tainted wins deterministically). */
function nameTaintAt(name: string, statementId: string, expressionKind: IrExpression['kind'] | undefined, ctx: TaintTraceContext, visiting: Set<string>, depth: number): DefinitionTaint[] {
  const reaching = [...(ctx.reachingAt.get(statementId)?.get(name) ?? [])].sort((a, b) => a.localeCompare(b));
  if (reaching.length === 0) {
    const parameterIndex = ctx.parameterSeeds.get(name);
    if (parameterIndex !== undefined && (expressionKind === undefined || expressionKind === 'parameter-read' || expressionKind === 'local-read' || expressionKind === 'member-read' || expressionKind === 'index-read')) {
      return [{ ...CLEAN, tainted: true, origin: { kind: 'parameter', parameterIndex, statementId }, propagation: [] }];
    }
    return [];
  }
  return reaching.map((defId) => computeDefinitionTaint(defId, ctx, visiting, depth + 1));
}

function firstTainted(taints: readonly DefinitionTaint[]): DefinitionTaint | undefined {
  return taints.find((taint) => taint.tainted);
}

/** Names a statement's value expression reads: the expression itself if it is a name, else every identifier read inside it. */
function valueReadNames(expr: IrExpression): string[] {
  if ((expr.kind === 'local-read' || expr.kind === 'parameter-read') && expr.name) return [expr.name];
  return expr.name ? identifierReads(expr.name) : [];
}

function isCallText(expr: IrExpression | undefined): boolean {
  return !!expr && (expr.kind === 'call' || expr.kind === 'new' || (!!expr.name && expr.kind !== 'literal' && expr.kind !== 'lambda' && calleePath(expr.name) !== undefined));
}

const SELF_PARAMETERS = new Set(['self', 'cls', '&self', '&mut self', 'mut self', 'this']);

/**
 * Maps a callee parameter index to the caller's argument text for this
 * call, or undefined when positional mapping is unknown (spread/keyword
 * arguments, unparseable call text, arity mismatch).
 */
export function argumentForParameter(callText: string, calleeParameterNames: readonly string[], parameterIndex: number): { known: true; argumentText?: string; argumentIndex?: number } | { known: false; reason: string } {
  const args = callArgumentTexts(callText);
  if (!args) return { known: false, reason: 'unparseable-call-arguments' };
  if (args.some((arg) => /^(\.\.\.|\*\*?)/.test(arg) || /^[A-Za-z_]\w*\s*[:=](?!=)/.test(arg))) return { known: false, reason: 'spread-or-keyword-arguments' };
  const path = calleePath(callText) ?? '';
  const offset = SELF_PARAMETERS.has(calleeParameterNames[0] ?? '') && /\.|::/.test(path) ? 1 : 0;
  const declared = calleeParameterNames.length - offset;
  if (args.length > declared && !calleeParameterNames.some((name) => /^(\.\.\.|\*)/.test(name))) return { known: false, reason: 'argument-count-exceeds-parameters' };
  const argumentIndex = parameterIndex - offset;
  if (argumentIndex < 0) return { known: true };
  return { known: true, argumentText: args[argumentIndex], argumentIndex };
}

/** Taint carried into a callee parameter: the first tainted identifier read by the mapped argument text. */
function argumentTaint(argumentText: string | undefined, statementId: string, ctx: TaintTraceContext, visiting: Set<string>, depth: number): { taint: DefinitionTaint; name: string } | undefined {
  if (!argumentText) return undefined;
  const names = bareIdentifier(argumentText) ? [bareIdentifier(argumentText)!] : identifierReads(argumentText);
  for (const name of names) {
    const taint = firstTainted(nameTaintAt(name, statementId, undefined, ctx, visiting, depth));
    if (taint) return { taint, name };
  }
  return undefined;
}

function hopFor(ctx: TaintTraceContext, statementId: string, callee: { functionId: string; certainty: ResolutionCertainty; complete: boolean; strategy?: string }, transfer: string): TaintCallHop {
  return {
    callerFunctionId: ctx.ir.functionId,
    callStatementId: statementId,
    calleeFunctionId: callee.functionId,
    callCertainty: callee.certainty,
    callComplete: callee.complete,
    ...(callee.strategy ? { strategy: callee.strategy } : {}),
    transfer,
  };
}

/** Return-value transfer through resolved callees' summaries (interprocedural mode only). */
function callReturnTaint(statementId: string, callText: string, ctx: TaintTraceContext, visiting: Set<string>, depth: number): DefinitionTaint | undefined {
  if (!ctx.callResolver) {
    if (hasTaintedArgument(statementId, ctx)) noteEscape(ctx, callText);
    return undefined;
  }
  const resolution = ctx.callResolver({ statementId, callText });
  if (resolution.boundary) noteBoundary(ctx, resolution.boundary);
  if (!resolution.callees.some((callee) => callee.summary) && hasTaintedArgument(statementId, ctx)) noteEscape(ctx, callText);
  const callees = [...resolution.callees].sort((a, b) => a.functionId.localeCompare(b.functionId));
  for (const callee of callees) {
    if (!callee.summary) {
      if (callee.boundary) noteBoundary(ctx, callee.boundary);
      continue;
    }
    const returnSource = callee.summary.returnSources[0];
    if (returnSource) {
      const hop = hopFor(ctx, statementId, callee, 'return');
      return {
        ...CLEAN,
        tainted: true,
        origin: { kind: 'callee-return', statementId, returnSource },
        propagation: [statementId],
        certainty: weaker(weaker(returnSource.certainty, callee.certainty), STATEMENT_EVIDENCE_CERTAINTY),
        hops: [hop, ...returnSource.hops],
      };
    }
    for (const parameterIndex of callee.summary.taintedParameterToReturn) {
      const mapping = argumentForParameter(callText, callee.summary.parameterNames, parameterIndex);
      if (!mapping.known) {
        noteBoundary(ctx, `unknown-parameter-mapping:${callee.functionId}:${mapping.reason}`);
        continue;
      }
      const carried = argumentTaint(mapping.argumentText, statementId, ctx, visiting, depth);
      if (!carried) continue;
      return {
        ...carried.taint,
        propagation: [...carried.taint.propagation, statementId],
        certainty: weaker(carried.taint.certainty, callee.certainty),
        hops: [...carried.taint.hops, hopFor(ctx, statementId, callee, `argument:${mapping.argumentIndex}->parameter:${parameterIndex}`)],
      };
    }
  }
  return undefined;
}

function computeDefinitionTaint(defId: string, ctx: TaintTraceContext, visiting: Set<string>, depth: number): DefinitionTaint {
  const cached = ctx.memo.get(defId);
  if (cached) return cached;
  if (depth > ctx.maxDepth) {
    ctx.depthCapHit = true;
    return CLEAN;
  }
  if (visiting.has(defId)) return CLEAN;

  const definition = ctx.definitions[defId];
  if (!definition) return CLEAN;
  const statementId = definition.statementId;
  const expr = primaryExpression(ctx.ir, statementId);
  if (!expr) return CLEAN;

  visiting.add(defId);
  let result: DefinitionTaint = CLEAN;
  const sanitizers = matchRole(ctx, 'sanitizer', statementId, expr);
  const sources = matchRole(ctx, 'source', statementId, expr);

  if (sources[0]) {
    result = { ...CLEAN, tainted: true, origin: { kind: 'source', statementId, match: sources[0] }, propagation: [statementId] };
  } else if (isCallText(expr) && expr.name) {
    if (sanitizers.length > 0) {
      // A sanitizer's output carries its input's taint minus the classes it cleans.
      const carried = argumentTaint(expr.name.slice(expr.name.indexOf('(') + 1), statementId, ctx, visiting, depth);
      if (carried) result = { ...carried.taint, propagation: [...carried.taint.propagation, statementId] };
    } else {
      result = callReturnTaint(statementId, expr.name, ctx, visiting, depth) ?? CLEAN;
    }
  } else {
    for (const name of valueReadNames(expr)) {
      const upstream = firstTainted(nameTaintAt(name, statementId, expr.kind, ctx, visiting, depth));
      if (upstream) {
        result = { ...upstream, propagation: [...upstream.propagation, statementId] };
        break;
      }
    }
  }

  if (sanitizers.length > 0) {
    const categories = new Set(result.cleaned);
    for (const match of sanitizers) for (const category of match.categories ?? ['*']) categories.add(category);
    const sanitizerStatementIds = [...result.sanitizerStatementIds, statementId];
    result = categories.has('*')
      ? { ...CLEAN, cleaned: categories, sanitizerStatementIds }
      : { ...result, cleaned: categories, sanitizerStatementIds };
  }

  visiting.delete(defId);
  ctx.memo.set(defId, result);
  return result;
}

function reachesCategory(taint: DefinitionTaint, category: TaintCategory | undefined): boolean {
  return taint.tainted && !taint.cleaned.has('*') && !(category && taint.cleaned.has(category));
}

function siblingSanitizers(taints: readonly DefinitionTaint[], category: TaintCategory | undefined): string[] {
  const ids = new Set<string>();
  for (const taint of taints) {
    if (taint.cleaned.has('*') || (category && taint.cleaned.has(category))) for (const id of taint.sanitizerStatementIds) ids.add(id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Argument names read by a call-bearing statement: the lowering's identifier scan for `call` statements, else identifiers in the parsed initializer/RHS call. */
function argumentNames(ir: FunctionIr, statementId: string): Array<{ name: string; kind?: IrExpression['kind'] }> {
  const statement = ir.statements[statementId]!;
  if (statement.kind === 'call') {
    return statement.expressions.slice(1).flatMap((exprId) => {
      const expr = ir.expressions[exprId];
      return expr?.name && (expr.kind === 'local-read' || expr.kind === 'parameter-read') ? [{ name: expr.name, kind: expr.kind }] : [];
    });
  }
  const text = primaryExpression(ir, statementId)?.name;
  const args = text ? callArgumentTexts(text) : undefined;
  return (args ?? []).flatMap((arg) => identifierReads(arg)).map((name) => ({ name }));
}

/** Whether any argument read by this call-bearing statement carries (source or seeded-parameter) taint. */
function hasTaintedArgument(statementId: string, ctx: TaintTraceContext): boolean {
  return argumentNames(ctx.ir, statementId).some(({ name, kind }) => nameTaintAt(name, statementId, kind, ctx, new Set(), 0).some((taint) => taint.tainted));
}

/** Tainted data left the analyzed function through a call nobody analyzed — a coverage boundary, never silent. */
function noteEscape(ctx: TaintTraceContext, callText: string): void {
  noteBoundary(ctx, `tainted-argument-into-unanalyzed-call:${calleePath(callText) ?? callText.slice(0, 60)}`);
}

function sinkFlowsAt(statementId: string, ctx: TaintTraceContext): TaintSinkFlow[] {
  const expr = primaryExpression(ctx.ir, statementId);
  if (!expr?.name || !isCallText(expr)) return [];
  const flows: TaintSinkFlow[] = [];

  const sinks = matchRole(ctx, 'sink', statementId, expr);
  if (sinks.length > 0) {
    const sink = sinks[0]!;
    // A source expression passed straight into the sink (`exec(req.body.cmd)`).
    for (const arg of callArgumentTexts(expr.name) ?? []) {
      const direct = matchRole(ctx, 'source', statementId, undefined, arg)[0];
      if (!direct) continue;
      flows.push({
        origin: { kind: 'source', statementId, match: direct },
        sinkStatementId: statementId,
        sinkMatch: sink,
        variableName: arg.slice(0, 80),
        propagation: [statementId],
        siblingSanitizerStatementIds: [],
        certainty: STATEMENT_EVIDENCE_CERTAINTY,
        hops: [],
      });
    }
    const seen = new Set<string>();
    for (const { name, kind } of argumentNames(ctx.ir, statementId)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const taints = nameTaintAt(name, statementId, kind, ctx, new Set(), 0);
      const siblings = siblingSanitizers(taints, sink.category);
      for (const taint of taints) {
        if (!reachesCategory(taint, sink.category) || !taint.origin) continue;
        flows.push({
          origin: taint.origin,
          sinkStatementId: statementId,
          sinkMatch: sink,
          variableName: name,
          propagation: [...taint.propagation, statementId],
          siblingSanitizerStatementIds: siblings,
          certainty: taint.certainty,
          hops: taint.hops,
        });
      }
    }
    return flows;
  }

  if (!hasTaintedArgument(statementId, ctx)) return flows;
  if (!ctx.callResolver) {
    noteEscape(ctx, expr.name);
    return flows;
  }
  const resolution = ctx.callResolver({ statementId, callText: expr.name });
  if (resolution.boundary) noteBoundary(ctx, resolution.boundary);
  if (!resolution.callees.some((callee) => callee.summary)) noteEscape(ctx, expr.name);
  for (const callee of [...resolution.callees].sort((a, b) => a.functionId.localeCompare(b.functionId))) {
    if (!callee.summary) {
      if (callee.boundary) noteBoundary(ctx, callee.boundary);
      continue;
    }
    for (const entry of callee.summary.taintedParameterToSink) {
      const mapping = argumentForParameter(expr.name, callee.summary.parameterNames, entry.parameterIndex);
      if (!mapping.known) {
        noteBoundary(ctx, `unknown-parameter-mapping:${callee.functionId}:${mapping.reason}`);
        continue;
      }
      const carried = argumentTaint(mapping.argumentText, statementId, ctx, new Set(), 0);
      if (!carried?.taint.origin || !reachesCategory(carried.taint, entry.category)) continue;
      const hop = hopFor(ctx, statementId, callee, `argument:${mapping.argumentIndex}->parameter:${entry.parameterIndex}`);
      flows.push({
        origin: carried.taint.origin,
        sinkStatementId: statementId,
        sinkMatch: {
          matcherRef: `${entry.sinkModelId ?? 'unknown'}/${entry.sinkMatcherId}`,
          modelId: entry.sinkModelId ?? 'unknown',
          matcherId: entry.sinkMatcherId,
          role: 'sink',
          strength: 'syntactic',
          ...(entry.category ? { category: entry.category } : {}),
          origin: 'summary',
        },
        sinkFunctionId: entry.sinkFunctionId,
        sinkStatementInCallee: entry.sinkStatementId,
        ...(entry.sinkLine ? { sinkLineInCallee: entry.sinkLine } : {}),
        variableName: carried.name,
        propagation: [...carried.taint.propagation, statementId],
        siblingSanitizerStatementIds: [],
        certainty: weaker(weaker(carried.taint.certainty, callee.certainty), entry.certainty),
        hops: [...carried.taint.hops, hop, ...entry.hops],
      });
    }
  }
  return flows;
}

function returnFlowsAt(statementId: string, ctx: TaintTraceContext): { flows: TaintReturnFlow[]; sanitizedParameters: number[] } {
  const expr = primaryExpression(ctx.ir, statementId);
  if (!expr) return { flows: [], sanitizedParameters: [] };
  const flows: TaintReturnFlow[] = [];
  const sanitizedParameters: number[] = [];
  const source = matchRole(ctx, 'source', statementId, expr)[0];
  if (source) {
    flows.push({ origin: { kind: 'source', statementId, match: source }, returnStatementId: statementId, certainty: STATEMENT_EVIDENCE_CERTAINTY, hops: [] });
    return { flows, sanitizedParameters };
  }
  if (isCallText(expr) && expr.name) {
    if (matchRole(ctx, 'sanitizer', statementId, expr).some((match) => (match.categories ?? ['*']).includes('*'))) return { flows, sanitizedParameters };
    const viaCall = callReturnTaint(statementId, expr.name, ctx, new Set(), 0);
    if (viaCall?.origin) flows.push({ origin: viaCall.origin, returnStatementId: statementId, certainty: viaCall.certainty, hops: viaCall.hops });
    return { flows, sanitizedParameters };
  }
  for (const name of valueReadNames(expr)) {
    for (const taint of nameTaintAt(name, statementId, expr.kind, ctx, new Set(), 0)) {
      if (taint.tainted && taint.origin) flows.push({ origin: taint.origin, returnStatementId: statementId, certainty: taint.certainty, hops: taint.hops });
      else if (taint.cleaned.has('*')) {
        const parameterIndex = ctx.parameterSeeds.get(name);
        if (parameterIndex !== undefined) sanitizedParameters.push(parameterIndex);
      }
    }
  }
  return { flows, sanitizedParameters };
}

function seedReachingByName(blockId: string, reachingDefinitions: ReachingDefinitionsResult): Map<string, Set<string>> {
  const current = new Map<string, Set<string>>();
  for (const defId of reachingDefinitions.in[blockId] ?? []) {
    const def = reachingDefinitions.definitions[defId];
    if (!def?.variableName) continue;
    if (!current.has(def.variableName)) current.set(def.variableName, new Set());
    current.get(def.variableName)!.add(defId);
  }
  return current;
}

function applyWriteToReachingByName(statement: FunctionIr['statements'][string], statementId: string, ir: FunctionIr, current: Map<string, Set<string>>): void {
  if (statement.kind !== 'declaration' && statement.kind !== 'assignment') return;
  const targetId = statement.targets[0];
  const target = targetId ? ir.expressions[targetId] : undefined;
  if (target && (target.kind === 'local-read' || target.kind === 'parameter-read') && target.name) {
    current.set(target.name, new Set([`${statementId}:def`]));
  }
}

/** Snapshot of the reaching-definitions-by-name map at the start of every statement (statement-precise, like def-use.ts's replay). */
function computeReachingAt(ir: FunctionIr, cfg: FunctionCfg, reachingDefinitions: ReachingDefinitionsResult): Map<string, Map<string, Set<string>>> {
  const reachingAt = new Map<string, Map<string, Set<string>>>();
  for (const blockId of cfg.order) {
    const current = seedReachingByName(blockId, reachingDefinitions);
    for (const statementId of cfg.blocks[blockId]!.statementIds) {
      const statement = ir.statements[statementId];
      if (!statement) continue;
      reachingAt.set(statementId, new Map([...current].map(([name, ids]) => [name, new Set(ids)])));
      applyWriteToReachingByName(statement, statementId, ir, current);
    }
  }
  return reachingAt;
}

export interface TaintEngineInput {
  ir: FunctionIr;
  cfg: FunctionCfg;
  reachingDefinitions: ReachingDefinitionsResult;
  defUse: DefUseChains;
  /** Legacy text rules; ignored when `registry` is given. */
  ruleSet?: TaintRuleSet;
  registry?: TaintModelRegistry;
  context?: TaintFunctionContext;
  /** Parameter names to treat as taint seeds (function-summary construction). */
  parameterSeeds?: readonly string[];
  /** Interprocedural mode: resolves a call statement to its persisted callees + their summaries. */
  callResolver?: TaintCallResolver;
  limits?: ProgramAnalysisLimits;
}

/** Raw flow analysis — sink flows (from sources and from seeded parameters) and return flows. */
export function analyzeTaintFlows(input: TaintEngineInput): TaintFlowAnalysis {
  const { ir, cfg, reachingDefinitions } = input;
  const registry = input.registry ?? (input.ruleSet ? registryFromLegacyRuleSet(input.ruleSet) : undefined);
  if (!registry) throw new Error('computeTaintFindings requires a model registry or a legacy rule set');
  const limits = input.limits ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS;
  const ctx: TaintTraceContext = {
    ir,
    definitions: reachingDefinitions.definitions,
    matchers: matchersForLanguage(registry, ir.language),
    functionContext: input.context ?? {},
    parameterSeeds: new Map((input.parameterSeeds ?? []).map((name, index) => [name, index])),
    callResolver: input.callResolver,
    reachingAt: computeReachingAt(ir, cfg, reachingDefinitions),
    memo: new Map(),
    maxDepth: limits.maxIntraproceduralChainDepth,
    depthCapHit: false,
    unevaluated: new Set(),
    boundaries: new Set(),
  };

  const sinkFlows: TaintSinkFlow[] = [];
  const returnFlows: TaintReturnFlow[] = [];
  const sanitizedParameterReturns = new Set<number>();
  for (const blockId of cfg.order) {
    for (const statementId of cfg.blocks[blockId]!.statementIds) {
      const statement = ir.statements[statementId];
      if (!statement) continue;
      if (SINK_BEARING_KINDS.has(statement.kind)) {
        sinkFlows.push(...sinkFlowsAt(statementId, ctx));
      }
      if (statement.kind === 'return') {
        const returned = returnFlowsAt(statementId, ctx);
        returnFlows.push(...returned.flows);
        for (const index of returned.sanitizedParameters) sanitizedParameterReturns.add(index);
      }
    }
  }

  return {
    sinkFlows,
    returnFlows,
    sanitizedParameterReturns: [...sanitizedParameterReturns].sort((a, b) => a - b),
    unevaluatedMatcherRefs: [...ctx.unevaluated].sort(),
    boundaries: [...ctx.boundaries].sort(),
    depthCapHit: ctx.depthCapHit,
    modelFingerprint: registry.fingerprint,
  };
}

function originStatementId(origin: TaintOrigin): string {
  return origin.kind === 'callee-return' ? origin.returnSource.sourceStatementId : origin.statementId;
}

function findingFromFlow(flow: TaintSinkFlow, ir: FunctionIr): TaintFinding | undefined {
  const functionId = ir.functionId;
  const lineOf = (statementId: string) => ir.statements[statementId]?.range.startLine;
  const origin = flow.origin;
  if (origin.kind === 'parameter') return undefined;
  const source: { matcherId: string; modelId?: string; strength?: TaintMatchStrength; functionId?: string } = origin.kind === 'source'
    ? { matcherId: origin.match.matcherId, modelId: origin.match.modelId, strength: origin.match.strength }
    : { matcherId: origin.returnSource.sourceMatcherId, modelId: origin.returnSource.sourceModelId, strength: origin.returnSource.strength, functionId: origin.returnSource.sourceFunctionId };
  const sourceStatementId = originStatementId(origin);
  const hopKey = flow.hops.map((hop) => `${hop.calleeFunctionId}`).join('>');
  return {
    id: `${sourceStatementId}->${flow.sinkStatementId}:${flow.variableName}${flow.sinkStatementInCallee ? `>${flow.sinkStatementInCallee}` : ''}${hopKey ? `#${hopKey}` : ''}`,
    sourceStatementId,
    sourceMatcherId: source.matcherId,
    sinkStatementId: flow.sinkStatementInCallee ?? flow.sinkStatementId,
    sinkMatcherId: flow.sinkMatch.matcherId,
    variableName: flow.variableName,
    propagationStatementIds: flow.propagation,
    sanitizedByStatementIds: flow.siblingSanitizerStatementIds,
    certainty: flow.certainty,
    ...(source.modelId ? { sourceModelId: source.modelId } : {}),
    sinkModelId: flow.sinkMatch.modelId,
    ...(flow.sinkMatch.category ? { sinkCategory: flow.sinkMatch.category } : {}),
    ...(source.strength ? { sourceMatchStrength: source.strength } : {}),
    sinkMatchStrength: flow.sinkMatch.strength,
    ...(source.functionId && source.functionId !== functionId ? { sourceFunctionId: source.functionId } : {}),
    ...(flow.sinkFunctionId && flow.sinkFunctionId !== functionId ? { sinkFunctionId: flow.sinkFunctionId } : {}),
    ...(flow.hops.length > 0 ? { hops: flow.hops } : {}),
    ...lineFields(origin.kind === 'callee-return' ? origin.returnSource.sourceLine : lineOf(sourceStatementId), flow.sinkStatementInCallee ? flow.sinkLineInCallee : lineOf(flow.sinkStatementId)),
    propagationLines: [...new Set(flow.propagation.map(lineOf).filter((line): line is number => line !== undefined))],
  };
}

function lineFields(sourceLine: number | undefined, sinkLine: number | undefined): { sourceLine?: number; sinkLine?: number } {
  return { ...(sourceLine !== undefined ? { sourceLine } : {}), ...(sinkLine !== undefined ? { sinkLine } : {}) };
}

export function computeTaintFindings(input: TaintEngineInput): TaintAnalysisResult {
  const { ir, cfg, reachingDefinitions } = input;
  const limits = input.limits ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS;
  const analysis = analyzeTaintFlows(input);

  const seen = new Set<string>();
  const findings = analysis.sinkFlows
    .map((flow) => findingFromFlow(flow, ir))
    .filter((finding): finding is TaintFinding => {
      if (!finding || seen.has(finding.id)) return false;
      seen.add(finding.id);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const truncated = ir.truncated || cfg.truncated || reachingDefinitions.truncated || analysis.depthCapHit;
  const reason =
    ir.reason ??
    cfg.reason ??
    reachingDefinitions.reason ??
    (analysis.depthCapHit ? `exceeded maxIntraproceduralChainDepth (${limits.maxIntraproceduralChainDepth}) while tracing taint propagation` : undefined);

  return {
    version: TAINT_VERSION,
    functionId: ir.functionId,
    findings,
    truncated,
    reason,
    modelFingerprint: analysis.modelFingerprint,
    unevaluatedMatcherRefs: analysis.unevaluatedMatcherRefs,
    boundaries: analysis.boundaries,
  };
}
