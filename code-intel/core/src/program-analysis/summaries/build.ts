/**
 * summaries/build.ts
 *
 * Assembles a `FunctionSummary` from a function's already-built IR, CFG,
 * and dataflow (reaching-definitions/def-use) artifacts — no new
 * traversal of source or AST, just aggregation plus one bounded traversal
 * to trace a `return`'s value back to a parameter through simple
 * name-to-name assignment chains.
 */
import { generateProgramAnalysisArtifactId, type ProgramAnalysisFingerprint } from '../contracts.js';
import type { FunctionIr } from '../ir/contracts.js';
import type { Definition, ReachingDefinitionsResult } from '../dataflow/reaching-definitions.js';
import type { DefUseChains } from '../dataflow/def-use.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, type ProgramAnalysisLimits } from '../limits.js';
import { FUNCTION_SUMMARY_VERSION, type CalledCallee, type FunctionSummary, type ParameterInfluence, type VariableAccess } from './contracts.js';

interface TraceContext {
  ir: FunctionIr;
  definitions: Readonly<Record<string, Definition>>;
  defUse: DefUseChains;
  parameterName: string;
  memo: Map<string, boolean>;
  maxDepth: number;
  /** Set true the first time the depth cap actually cuts off a trace (as opposed to reaching a non-traceable leaf) — surfaced via `FunctionSummary.truncated`. */
  depthCapHit: boolean;
}

/** Whether the value read by `statementId`'s own primary expression traces back to `ctx.parameterName`, directly or through a bounded chain of simple name-to-name assignments. */
function valueTracesToParameter(statementId: string, ctx: TraceContext, visiting: Set<string>, depth: number): boolean {
  if (depth > ctx.maxDepth) {
    ctx.depthCapHit = true;
    return false;
  }
  if (visiting.has(statementId)) return false;
  const useExprId = ctx.ir.statements[statementId]?.expressions[0];
  const useExpr = useExprId ? ctx.ir.expressions[useExprId] : undefined;
  if (useExpr?.kind === 'parameter-read') return useExpr.name === ctx.parameterName;
  if (useExpr?.kind !== 'local-read') return false;

  visiting.add(statementId);
  const reachingDefs = ctx.defUse.reachingDefinitionsForUse[statementId] ?? [];
  const result = reachingDefs.some((defId) => {
    const cached = ctx.memo.get(defId);
    if (cached !== undefined) return cached;
    const def = ctx.definitions[defId];
    const traced = def ? valueTracesToParameter(def.statementId, ctx, visiting, depth + 1) : false;
    ctx.memo.set(defId, traced);
    return traced;
  });
  visiting.delete(statementId);
  return result;
}

function computeParameterInfluence(
  ir: FunctionIr,
  parameterNames: readonly string[],
  reachingDefinitions: ReachingDefinitionsResult,
  defUse: DefUseChains,
  maxDepth: number,
): { influence: ParameterInfluence[]; depthCapHit: boolean } {
  const returnStatementIds = Object.values(ir.statements)
    .filter((s) => s.kind === 'return')
    .map((s) => s.id)
    .sort((a, b) => a.localeCompare(b));

  let depthCapHit = false;
  const influence = [...parameterNames].sort((a, b) => a.localeCompare(b)).map((parameterName) => {
    const ctx: TraceContext = { ir, definitions: reachingDefinitions.definitions, defUse, parameterName, memo: new Map(), maxDepth, depthCapHit: false };
    const influencesReturnAtStatementIds = returnStatementIds.filter((id) => valueTracesToParameter(id, ctx, new Set(), 0));
    if (ctx.depthCapHit) depthCapHit = true;
    return { parameterName, influencesReturnAtStatementIds };
  });
  return { influence, depthCapHit };
}

function computeLocalAccesses(ir: FunctionIr, reachingDefinitions: ReachingDefinitionsResult): VariableAccess[] {
  const writesByVar = new Map<string, Set<string>>();
  for (const definition of Object.values(reachingDefinitions.definitions)) {
    if (definition.variableName === null) continue;
    if (!writesByVar.has(definition.variableName)) writesByVar.set(definition.variableName, new Set());
    writesByVar.get(definition.variableName)!.add(definition.statementId);
  }

  const readsByVar = new Map<string, Set<string>>();
  for (const statement of Object.values(ir.statements)) {
    const exprId = statement.expressions[0];
    const expr = exprId ? ir.expressions[exprId] : undefined;
    if (!expr || !expr.name || (expr.kind !== 'local-read' && expr.kind !== 'parameter-read')) continue;
    if (!readsByVar.has(expr.name)) readsByVar.set(expr.name, new Set());
    readsByVar.get(expr.name)!.add(statement.id);
  }

  const names = new Set([...writesByVar.keys(), ...readsByVar.keys()]);
  return [...names].sort((a, b) => a.localeCompare(b)).map((variableName) => ({
    variableName,
    readAtStatementIds: [...(readsByVar.get(variableName) ?? [])].sort((a, b) => a.localeCompare(b)),
    writeAtStatementIds: [...(writesByVar.get(variableName) ?? [])].sort((a, b) => a.localeCompare(b)),
  }));
}

function computeCalledCallees(ir: FunctionIr): CalledCallee[] {
  const statementIdsByCallee = new Map<string, Set<string>>();
  for (const statement of Object.values(ir.statements)) {
    if (statement.kind !== 'call') continue;
    const exprId = statement.expressions[0];
    const expr = exprId ? ir.expressions[exprId] : undefined;
    const calleeText = expr?.name;
    if (!calleeText) continue;
    if (!statementIdsByCallee.has(calleeText)) statementIdsByCallee.set(calleeText, new Set());
    statementIdsByCallee.get(calleeText)!.add(statement.id);
  }
  return [...statementIdsByCallee.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([calleeText, statementIds]) => ({ calleeText, statementIds: [...statementIds].sort((a, b) => a.localeCompare(b)) }));
}

export function buildFunctionSummary(input: {
  ir: FunctionIr;
  /** Every parameter name, whether or not it's referenced in the body — sourced from the existing symbol graph, same as `LowerFunctionInput.parameterNames`. */
  parameterNames: readonly string[];
  reachingDefinitions: ReachingDefinitionsResult;
  defUse: DefUseChains;
  bodyHash: string;
  fingerprint: ProgramAnalysisFingerprint;
  limits?: ProgramAnalysisLimits;
}): FunctionSummary {
  const { ir, parameterNames, reachingDefinitions, defUse, bodyHash, fingerprint } = input;
  const limits = input.limits ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS;

  const boundaryWriteStatementIds = Object.values(reachingDefinitions.definitions)
    .filter((d) => d.variableName === null)
    .map((d) => d.statementId)
    .sort((a, b) => a.localeCompare(b));

  const { influence: parameterInfluence, depthCapHit } = computeParameterInfluence(
    ir,
    parameterNames,
    reachingDefinitions,
    defUse,
    limits.maxIntraproceduralChainDepth,
  );

  const truncated = ir.truncated || reachingDefinitions.truncated || depthCapHit;
  const reason =
    ir.reason ??
    reachingDefinitions.reason ??
    (depthCapHit ? `exceeded maxIntraproceduralChainDepth (${limits.maxIntraproceduralChainDepth}) while tracing parameter influence` : undefined);

  return {
    version: FUNCTION_SUMMARY_VERSION,
    functionId: ir.functionId,
    bodyHash,
    fingerprint,
    parameterInfluence,
    localAccesses: computeLocalAccesses(ir, reachingDefinitions),
    boundaryWriteStatementIds,
    calledCallees: computeCalledCallees(ir),
    unresolvedUseStatementIds: defUse.unresolvedUseStatementIds,
    truncated,
    ...(reason ? { reason } : {}),
  };
}

export function generateFunctionSummaryArtifactId(
  canonicalFunctionId: string,
  bodyHash: string,
  fingerprint: ProgramAnalysisFingerprint,
): string {
  return generateProgramAnalysisArtifactId({ kind: 'function-summary', canonicalFunctionId, bodyHash, fingerprint });
}
