/**
 * dataflow/def-use.ts
 *
 * Statement-precise def-use chains built from `ReachingDefinitionsResult`
 * (block-level IN sets) by replaying each block's statements once more,
 * refining the reaching set at each write instead of only knowing it at
 * block boundaries.
 *
 * A "use" is only recognized in a statement's own shallow primary
 * expression (`IrStatement.expressions[0]`) when it is a plain name
 * (`local-read`/`parameter-read`) — e.g. `return x;`, `y = x;`. The
 * language lowering IR (task 3) does not lower operand trees, so a use
 * nested inside a call's arguments, a binary/member expression, or a
 * conditional/loop/switch's condition is NOT modeled here. Rather than
 * silently miss it, every statement where that could be happening is
 * listed in `unresolvedUseStatementIds`; treat "no reaching definitions
 * found" as meaningful only for statements NOT in that list.
 */
import type { FunctionIr, IrExpressionKind, IrStatementKind } from '../ir/contracts.js';
import type { FunctionCfg } from '../cfg/contracts.js';
import type { ReachingDefinitionsResult } from './reaching-definitions.js';

export interface DefUseChains {
  version: string;
  functionId: string;
  /** statement id (the use site) -> definition ids that may reach it, sorted for determinism; empty means no definition of that name reaches here. */
  reachingDefinitionsForUse: Readonly<Record<string, readonly string[]>>;
  /** definition id -> statement ids of uses it may reach, sorted for determinism. */
  usesOfDefinition: Readonly<Record<string, readonly string[]>>;
  /** Statement ids that may read a local/parameter this analysis could not structurally resolve (see file header). */
  unresolvedUseStatementIds: readonly string[];
}

// A declaration's initializer is never captured by the shallow IR (task 3 lowers
// only the declared name, not its value), so any declaration could be silently
// hiding a use — always flag it rather than reporting a false "no use here".
const ALWAYS_UNRESOLVED_KINDS: ReadonlySet<IrStatementKind> = new Set(['conditional', 'switch', 'loop', 'call', 'declaration']);
const UNRESOLVED_PRIMARY_EXPRESSION_KINDS: ReadonlySet<IrExpressionKind> = new Set([
  'binary',
  'unary',
  'member-read',
  'index-read',
  'call',
  'new',
  'lambda',
  'cast',
  'type-test',
  'unknown',
]);

interface DefUseAccumulator {
  reachingDefinitionsForUse: Record<string, string[]>;
  usesOfDefinition: Record<string, string[]>;
  unresolvedUseStatementIds: string[];
}

function seedCurrentDefs(blockId: string, reachingDefinitions: ReachingDefinitionsResult): Map<string, Set<string>> {
  const current = new Map<string, Set<string>>();
  for (const defId of reachingDefinitions.in[blockId] ?? []) {
    const def = reachingDefinitions.definitions[defId];
    if (!def?.variableName) continue;
    if (!current.has(def.variableName)) current.set(def.variableName, new Set());
    current.get(def.variableName)!.add(defId);
  }
  return current;
}

function recordUse(statementId: string, useExpr: { kind: IrExpressionKind; name?: string }, current: Map<string, Set<string>>, acc: DefUseAccumulator): boolean {
  if (!((useExpr.kind === 'local-read' || useExpr.kind === 'parameter-read') && useExpr.name)) {
    return UNRESOLVED_PRIMARY_EXPRESSION_KINDS.has(useExpr.kind);
  }
  const reaching = current.get(useExpr.name);
  const defIds = reaching ? [...reaching].sort((a, b) => a.localeCompare(b)) : [];
  acc.reachingDefinitionsForUse[statementId] = defIds;
  for (const defId of defIds) {
    acc.usesOfDefinition[defId] ??= [];
    acc.usesOfDefinition[defId].push(statementId);
  }
  return false;
}

function applyWrite(statement: FunctionIr['statements'][string], statementId: string, ir: FunctionIr, current: Map<string, Set<string>>): void {
  if (statement.kind !== 'declaration' && statement.kind !== 'assignment') return;
  const targetId = statement.targets[0];
  const target = targetId ? ir.expressions[targetId] : undefined;
  if (target && (target.kind === 'local-read' || target.kind === 'parameter-read') && target.name) {
    current.set(target.name, new Set([`${statementId}:def`]));
  }
}

export function computeDefUseChains(
  ir: FunctionIr,
  cfg: FunctionCfg,
  reachingDefinitions: ReachingDefinitionsResult,
): DefUseChains {
  const acc: DefUseAccumulator = { reachingDefinitionsForUse: {}, usesOfDefinition: {}, unresolvedUseStatementIds: [] };

  for (const blockId of cfg.order) {
    const current = seedCurrentDefs(blockId, reachingDefinitions);

    for (const statementId of cfg.blocks[blockId]!.statementIds) {
      const statement = ir.statements[statementId];
      if (!statement) continue;

      let flaggedUnresolved = ALWAYS_UNRESOLVED_KINDS.has(statement.kind);
      const useExprId = statement.expressions[0];
      const useExpr = useExprId ? ir.expressions[useExprId] : undefined;
      if (useExpr) flaggedUnresolved ||= recordUse(statementId, useExpr, current, acc);
      if (flaggedUnresolved) acc.unresolvedUseStatementIds.push(statementId);

      applyWrite(statement, statementId, ir, current);
    }
  }

  for (const defId of Object.keys(acc.usesOfDefinition)) {
    acc.usesOfDefinition[defId] = [...new Set(acc.usesOfDefinition[defId])].sort((a, b) => a.localeCompare(b));
  }

  return {
    version: reachingDefinitions.version,
    functionId: ir.functionId,
    reachingDefinitionsForUse: acc.reachingDefinitionsForUse,
    usesOfDefinition: acc.usesOfDefinition,
    unresolvedUseStatementIds: [...new Set(acc.unresolvedUseStatementIds)].sort((a, b) => a.localeCompare(b)),
  };
}
