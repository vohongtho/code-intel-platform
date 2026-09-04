/**
 * taint/build.ts
 *
 * Bounded intraprocedural source-to-sink taint analysis over the same
 * artifacts as function summaries (reaching-definitions/def-use), plus a
 * per-block replay of "which definition of each name reaches this exact
 * statement" so a sink call's individual arguments (captured via language
 * lowering's call-argument identifier scan, task 3) can be checked, not
 * just its overall call text.
 *
 * A definition is tainted when its own statement text matches a source
 * rule, or (transitively, through simple name-to-name assignment chains —
 * the same shallow-IR limits as dataflow/def-use.ts) its value comes from
 * one that is. A sanitizer match always produces a clean value regardless
 * of its input, and — when it sits on a sibling branch reaching the same
 * use as a tainted definition — is reported as evidence alongside the
 * finding, not as something that silently suppresses it.
 */
import type { FunctionIr } from '../ir/contracts.js';
import type { FunctionCfg } from '../cfg/contracts.js';
import type { Definition, ReachingDefinitionsResult } from '../dataflow/reaching-definitions.js';
import type { DefUseChains } from '../dataflow/def-use.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, type ProgramAnalysisLimits } from '../limits.js';
import { TAINT_VERSION, matchesTaintText, type TaintAnalysisResult, type TaintFinding, type TaintRuleSet } from './contracts.js';

interface DefinitionTaint {
  tainted: boolean;
  sourceStatementId?: string;
  sourceMatcherId?: string;
  /** Definition statement ids from source to this definition, inclusive. */
  propagation: string[];
  sanitizerStatementId?: string;
}

interface TaintTraceContext {
  ir: FunctionIr;
  definitions: Readonly<Record<string, Definition>>;
  defUse: DefUseChains;
  ruleSet: TaintRuleSet;
  memo: Map<string, DefinitionTaint>;
  maxDepth: number;
  /** Set true the first time the depth cap actually cuts off a trace — surfaced via `TaintAnalysisResult.truncated`. */
  depthCapHit: boolean;
}

function statementPrimaryText(ir: FunctionIr, statementId: string): string | undefined {
  const exprId = ir.statements[statementId]?.expressions[0];
  return exprId ? ir.expressions[exprId]?.name : undefined;
}

function computeDefinitionTaint(defId: string, ctx: TaintTraceContext, visiting: Set<string>, depth: number): DefinitionTaint {
  const cached = ctx.memo.get(defId);
  if (cached) return cached;
  const empty: DefinitionTaint = { tainted: false, propagation: [] };
  if (depth > ctx.maxDepth) {
    ctx.depthCapHit = true;
    return empty;
  }
  if (visiting.has(defId)) return empty;

  const definition = ctx.definitions[defId];
  if (!definition) return empty;

  visiting.add(defId);
  const text = statementPrimaryText(ctx.ir, definition.statementId);
  const sourceMatch = text ? matchesTaintText(text, ctx.ruleSet.sources) : undefined;
  const sanitizerMatch = text ? matchesTaintText(text, ctx.ruleSet.sanitizers) : undefined;

  let result: DefinitionTaint = { tainted: false, propagation: [] };
  if (sourceMatch) {
    result = {
      tainted: true,
      sourceStatementId: definition.statementId,
      sourceMatcherId: sourceMatch.id,
      propagation: [definition.statementId],
    };
  } else {
    const useExprId = ctx.ir.statements[definition.statementId]?.expressions[0];
    const useExpr = useExprId ? ctx.ir.expressions[useExprId] : undefined;
    if (useExpr && (useExpr.kind === 'local-read' || useExpr.kind === 'parameter-read')) {
      const reachingDefs = ctx.defUse.reachingDefinitionsForUse[definition.statementId] ?? [];
      for (const upstreamDefId of reachingDefs) {
        const upstream = computeDefinitionTaint(upstreamDefId, ctx, visiting, depth + 1);
        if (upstream.tainted) {
          result = { ...upstream, propagation: [...upstream.propagation, definition.statementId] };
          break;
        }
      }
    }
  }

  if (sanitizerMatch) {
    result = { tainted: false, propagation: [], sanitizerStatementId: definition.statementId };
  }

  visiting.delete(defId);
  ctx.memo.set(defId, result);
  return result;
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

function findingsForSinkCall(
  statementId: string,
  sinkMatcherId: string,
  ir: FunctionIr,
  current: Map<string, Set<string>>,
  ctx: TaintTraceContext,
): TaintFinding[] {
  const statement = ir.statements[statementId]!;
  const findings: TaintFinding[] = [];

  for (const exprId of statement.expressions.slice(1)) {
    const expr = ir.expressions[exprId];
    if (!expr?.name || (expr.kind !== 'local-read' && expr.kind !== 'parameter-read')) continue;

    const reachingDefIds = [...(current.get(expr.name) ?? [])];
    const taints = reachingDefIds.map((id) => computeDefinitionTaint(id, ctx, new Set(), 0));
    const sanitizedSiblingIds = [...new Set(taints.map((t) => t.sanitizerStatementId).filter((id): id is string => !!id))].sort(
      (a, b) => a.localeCompare(b),
    );

    for (const taint of taints) {
      if (!taint.tainted) continue;
      findings.push({
        id: `${taint.sourceStatementId}->${statementId}:${expr.name}`,
        sourceStatementId: taint.sourceStatementId!,
        sourceMatcherId: taint.sourceMatcherId!,
        sinkStatementId: statementId,
        sinkMatcherId,
        variableName: expr.name,
        propagationStatementIds: [...taint.propagation, statementId],
        sanitizedByStatementIds: sanitizedSiblingIds,
        certainty: 'heuristic',
      });
    }
  }
  return findings;
}

function applyWriteToReachingByName(statement: FunctionIr['statements'][string], statementId: string, ir: FunctionIr, current: Map<string, Set<string>>): void {
  if (statement.kind !== 'declaration' && statement.kind !== 'assignment') return;
  const targetId = statement.targets[0];
  const target = targetId ? ir.expressions[targetId] : undefined;
  if (target && (target.kind === 'local-read' || target.kind === 'parameter-read') && target.name) {
    current.set(target.name, new Set([`${statementId}:def`]));
  }
}

function findingsForBlock(blockId: string, ir: FunctionIr, cfg: FunctionCfg, reachingDefinitions: ReachingDefinitionsResult, ctx: TaintTraceContext): TaintFinding[] {
  const current = seedReachingByName(blockId, reachingDefinitions);
  const findings: TaintFinding[] = [];

  for (const statementId of cfg.blocks[blockId]!.statementIds) {
    const statement = ir.statements[statementId];
    if (!statement) continue;

    if (statement.kind === 'call') {
      const text = statementPrimaryText(ir, statementId);
      const sinkMatch = text ? matchesTaintText(text, ctx.ruleSet.sinks) : undefined;
      if (sinkMatch) findings.push(...findingsForSinkCall(statementId, sinkMatch.id, ir, current, ctx));
    }

    applyWriteToReachingByName(statement, statementId, ir, current);
  }
  return findings;
}

export function computeTaintFindings(input: {
  ir: FunctionIr;
  cfg: FunctionCfg;
  reachingDefinitions: ReachingDefinitionsResult;
  defUse: DefUseChains;
  ruleSet: TaintRuleSet;
  limits?: ProgramAnalysisLimits;
}): TaintAnalysisResult {
  const { ir, cfg, reachingDefinitions, defUse, ruleSet } = input;
  const limits = input.limits ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS;
  const ctx: TaintTraceContext = {
    ir,
    definitions: reachingDefinitions.definitions,
    defUse,
    ruleSet,
    memo: new Map(),
    maxDepth: limits.maxIntraproceduralChainDepth,
    depthCapHit: false,
  };

  const findings = cfg.order.flatMap((blockId) => findingsForBlock(blockId, ir, cfg, reachingDefinitions, ctx));

  const seen = new Set<string>();
  const dedupedSorted = findings
    .filter((finding) => {
      if (seen.has(finding.id)) return false;
      seen.add(finding.id);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const truncated = ir.truncated || cfg.truncated || reachingDefinitions.truncated || ctx.depthCapHit;
  const reason =
    ir.reason ??
    cfg.reason ??
    reachingDefinitions.reason ??
    (ctx.depthCapHit ? `exceeded maxIntraproceduralChainDepth (${limits.maxIntraproceduralChainDepth}) while tracing taint propagation` : undefined);

  return {
    version: TAINT_VERSION,
    functionId: ir.functionId,
    findings: dedupedSorted,
    truncated,
    reason,
  };
}
