/**
 * dataflow/reaching-definitions.ts
 *
 * Bounded intraprocedural reaching-definitions dataflow over a
 * `FunctionCfg`, for locals/parameters written via a bare name
 * (`IrExpression` kind `local-read`/`parameter-read`). Standard forward
 * dataflow — GEN/KILL per block by variable name, iterated with a
 * worklist to a fixed point, capped by `maxWorklistIterations`.
 *
 * A write through a member/index target (`obj.field = x`, `arr[i] = x`)
 * is heap/alias territory: it gets its own definition id (so PDG/taint can
 * still see "something happened here") but never kills or reaches a named
 * local slot, per the spec's "heap/alias uncertainty becomes boundary
 * rather than guessed kill/gen behavior" requirement.
 */
import type { FunctionIr } from '../ir/contracts.js';
import type { CfgBlock, FunctionCfg } from '../cfg/contracts.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, type ProgramAnalysisLimits } from '../limits.js';

export const REACHING_DEFINITIONS_VERSION = 'reaching-definitions-v1';

export interface Definition {
  id: string;
  statementId: string;
  blockId: string;
  /** null for a heap/boundary write (member/index target) — participates in no named-variable kill/gen. */
  variableName: string | null;
}

export interface ReachingDefinitionsResult {
  version: string;
  functionId: string;
  /** blockId -> definition ids reaching the start of the block, sorted for determinism. */
  in: Readonly<Record<string, readonly string[]>>;
  /** blockId -> definition ids reaching the end of the block, sorted for determinism. */
  out: Readonly<Record<string, readonly string[]>>;
  definitions: Readonly<Record<string, Definition>>;
  truncated: boolean;
  reason?: string;
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function definitionId(statementId: string): string {
  return `${statementId}:def`;
}

interface BlockDefInfo {
  gen: Set<string>;
  killVars: Set<string>;
}

function collectBlockDefinitions(
  block: CfgBlock,
  ir: FunctionIr,
  definitions: Record<string, Definition>,
  definitionIdsByVariable: Map<string, string[]>,
): BlockDefInfo {
  const lastDefByVar = new Map<string, string>();
  const killVars = new Set<string>();

  for (const statementId of block.statementIds) {
    const statement = ir.statements[statementId];
    if (!statement || (statement.kind !== 'declaration' && statement.kind !== 'assignment')) continue;
    const targetId = statement.targets[0];
    if (!targetId) continue;
    const target = ir.expressions[targetId];
    if (!target) continue;

    const id = definitionId(statementId);
    const isNamedLocal = (target.kind === 'local-read' || target.kind === 'parameter-read') && !!target.name;
    definitions[id] = { id, statementId, blockId: block.id, variableName: isNamedLocal ? target.name! : null };

    if (isNamedLocal) {
      const name = target.name!;
      if (!definitionIdsByVariable.has(name)) definitionIdsByVariable.set(name, []);
      definitionIdsByVariable.get(name)!.push(id);
      lastDefByVar.set(name, id);
      killVars.add(name);
    }
  }

  return { gen: new Set(lastDefByVar.values()), killVars };
}

export function computeReachingDefinitions(
  ir: FunctionIr,
  cfg: FunctionCfg,
  limits: ProgramAnalysisLimits = DEFAULT_PROGRAM_ANALYSIS_LIMITS,
): ReachingDefinitionsResult {
  const definitions: Record<string, Definition> = {};
  const definitionIdsByVariable = new Map<string, string[]>();
  const genByBlock = new Map<string, Set<string>>();
  const killVarsByBlock = new Map<string, Set<string>>();

  for (const blockId of cfg.order) {
    const info = collectBlockDefinitions(cfg.blocks[blockId]!, ir, definitions, definitionIdsByVariable);
    genByBlock.set(blockId, info.gen);
    killVarsByBlock.set(blockId, info.killVars);
  }

  const killByBlock = new Map<string, Set<string>>();
  for (const blockId of cfg.order) {
    const kill = new Set<string>();
    for (const varName of killVarsByBlock.get(blockId)!) {
      for (const defId of definitionIdsByVariable.get(varName) ?? []) kill.add(defId);
    }
    killByBlock.set(blockId, kill);
  }

  const inSets = new Map<string, Set<string>>(cfg.order.map((id) => [id, new Set<string>()]));
  const outSets = new Map<string, Set<string>>(cfg.order.map((id) => [id, new Set(genByBlock.get(id)!)]));

  const worklist: string[] = [...cfg.order];
  const queued = new Set(worklist);
  let iterations = 0;
  let truncated = false;
  let reason: string | undefined;

  while (worklist.length > 0) {
    iterations += 1;
    if (iterations > limits.maxWorklistIterations) {
      truncated = true;
      reason = `exceeded maxWorklistIterations (${limits.maxWorklistIterations})`;
      break;
    }
    const blockId = worklist.shift()!;
    queued.delete(blockId);
    const block = cfg.blocks[blockId]!;

    const newIn = new Set<string>();
    for (const predId of block.predecessors) {
      for (const defId of outSets.get(predId) ?? []) newIn.add(defId);
    }
    inSets.set(blockId, newIn);

    const kill = killByBlock.get(blockId)!;
    const newOut = new Set(genByBlock.get(blockId)!);
    for (const defId of newIn) if (!kill.has(defId)) newOut.add(defId);

    const prevOut = outSets.get(blockId)!;
    const outChanged = newOut.size !== prevOut.size || [...newOut].some((id) => !prevOut.has(id));
    if (outChanged) {
      outSets.set(blockId, newOut);
      for (const edge of block.successors) {
        if (!queued.has(edge.targetBlockId)) {
          queued.add(edge.targetBlockId);
          worklist.push(edge.targetBlockId);
        }
      }
    }
  }

  const inRecord: Record<string, readonly string[]> = {};
  const outRecord: Record<string, readonly string[]> = {};
  for (const blockId of cfg.order) {
    inRecord[blockId] = sortedIds(inSets.get(blockId) ?? []);
    outRecord[blockId] = sortedIds(outSets.get(blockId) ?? []);
  }

  return {
    version: REACHING_DEFINITIONS_VERSION,
    functionId: ir.functionId,
    in: inRecord,
    out: outRecord,
    definitions,
    truncated: truncated || cfg.truncated,
    reason: reason ?? (cfg.truncated ? cfg.reason : undefined),
  };
}
