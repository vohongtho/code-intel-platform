/**
 * taint/summary.ts
 *
 * Builds a function's `TaintFunctionSummary` by running the taint engine
 * with every parameter as a seed: a seeded parameter reaching a sink
 * becomes a parameter-to-sink entry, reaching a `return` becomes a
 * parameter-to-return entry, and a genuine source reaching a `return`
 * becomes a return source the caller inherits. With a call resolver the
 * summary is transitive (a parameter forwarded to a callee whose own
 * summary reaches a sink counts, carrying that callee hop).
 */
import type { FunctionIr } from '../ir/contracts.js';
import type { FunctionCfg } from '../cfg/contracts.js';
import type { ReachingDefinitionsResult } from '../dataflow/reaching-definitions.js';
import type { DefUseChains } from '../dataflow/def-use.js';
import type { ProgramAnalysisLimits } from '../limits.js';
import { analyzeTaintFlows } from './build.js';
import {
  TAINT_SUMMARY_VERSION,
  type TaintCallResolver,
  type TaintFunctionSummary,
  type TaintSummaryReturnSource,
  type TaintSummarySink,
} from './contracts.js';
import type { TaintModelRegistry } from './model-registry.js';
import type { TaintFunctionContext } from './matching.js';

export function buildTaintFunctionSummary(input: {
  ir: FunctionIr;
  cfg: FunctionCfg;
  reachingDefinitions: ReachingDefinitionsResult;
  defUse: DefUseChains;
  registry: TaintModelRegistry;
  parameterNames: readonly string[];
  context?: TaintFunctionContext;
  callResolver?: TaintCallResolver;
  limits?: ProgramAnalysisLimits;
}): TaintFunctionSummary {
  const { ir } = input;
  const analysis = analyzeTaintFlows({ ...input, parameterSeeds: input.parameterNames });

  const sinks = new Map<string, TaintSummarySink>();
  for (const flow of analysis.sinkFlows) {
    if (flow.origin.kind !== 'parameter') continue;
    const entry: TaintSummarySink = {
      parameterIndex: flow.origin.parameterIndex,
      sinkMatcherId: flow.sinkMatch.matcherId,
      sinkModelId: flow.sinkMatch.modelId,
      ...(flow.sinkMatch.category ? { category: flow.sinkMatch.category } : {}),
      sinkStatementId: flow.sinkStatementInCallee ?? flow.sinkStatementId,
      sinkFunctionId: flow.sinkFunctionId ?? ir.functionId,
      ...((flow.sinkStatementInCallee ? flow.sinkLineInCallee : ir.statements[flow.sinkStatementId]?.range.startLine) !== undefined
        ? { sinkLine: flow.sinkStatementInCallee ? flow.sinkLineInCallee : ir.statements[flow.sinkStatementId]!.range.startLine }
        : {}),
      certainty: flow.certainty,
      hops: flow.hops,
    };
    const key = `${entry.parameterIndex}|${entry.sinkModelId}/${entry.sinkMatcherId}|${entry.sinkFunctionId}|${entry.sinkStatementId}`;
    if (!sinks.has(key)) sinks.set(key, entry);
  }

  const toReturn = new Set<number>();
  const returnSources = new Map<string, TaintSummaryReturnSource>();
  for (const flow of analysis.returnFlows) {
    if (flow.origin.kind === 'parameter') {
      toReturn.add(flow.origin.parameterIndex);
      continue;
    }
    const source: TaintSummaryReturnSource = flow.origin.kind === 'source'
      ? {
          sourceMatcherId: flow.origin.match.matcherId,
          sourceModelId: flow.origin.match.modelId,
          sourceStatementId: flow.origin.statementId,
          sourceFunctionId: ir.functionId,
          ...(ir.statements[flow.origin.statementId] ? { sourceLine: ir.statements[flow.origin.statementId]!.range.startLine } : {}),
          strength: flow.origin.match.strength,
          certainty: flow.certainty,
          hops: flow.hops,
        }
      : { ...flow.origin.returnSource, certainty: flow.certainty, hops: flow.hops };
    const key = `${source.sourceFunctionId}|${source.sourceStatementId}|${source.sourceModelId}/${source.sourceMatcherId}`;
    if (!returnSources.has(key)) returnSources.set(key, source);
  }

  const truncated = ir.truncated || input.cfg.truncated || input.reachingDefinitions.truncated || analysis.depthCapHit;
  return {
    version: TAINT_SUMMARY_VERSION,
    functionId: ir.functionId,
    modelFingerprint: analysis.modelFingerprint,
    parameterNames: [...input.parameterNames],
    taintedParameterToReturn: [...toReturn].sort((a, b) => a - b),
    taintedParameterToSink: [...sinks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry),
    returnSources: [...returnSources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry),
    sanitizingParameterEffects: analysis.sanitizedParameterReturns.filter((index) => !toReturn.has(index)),
    boundaries: analysis.boundaries,
    truncated,
    ...(truncated ? { reason: ir.reason ?? input.cfg.reason ?? input.reachingDefinitions.reason ?? 'taint propagation depth cap reached' } : {}),
  };
}
