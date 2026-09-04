/**
 * cfg/build.ts
 *
 * Builds a deterministic basic-block CFG from a validated `FunctionIr`
 * (ir/build via language lowering, task 3). Threads a "current block"
 * through a structural walk of the branch-discriminated IR (ir/contracts.ts
 * `StatementBranches`) — the same shape of algorithm as textbook
 * AST-to-CFG lowering, just over the universal IR instead of a
 * language-specific AST.
 *
 * Deliberately scoped for this iteration (documented, not silent, per the
 * spec's truthful-reporting requirement):
 *  - `goto` targets are not resolved — a function containing one is marked
 *    `truncated`.
 *  - `finally` blocks are wired for the normal (fall-through) exit path
 *    only; a `try` with a `finally` marks the CFG `truncated` because an
 *    early exit (return/throw/break/continue) inside the try/catch bodies
 *    does not get routed through `finally` in this model.
 *  - Loops are modeled as a single header block (condition-check position
 *    is not distinguished) with a back edge and an exit edge; this matches
 *    the IR, which does not lower a loop's init/condition/update clauses
 *    (task 3 lowers loop bodies only).
 *  - Switch case fallthrough-to-next-case (the C/Java/Go/PHP default) is
 *    not modeled — every case is treated as independent, matching the
 *    non-fall-through languages (Rust/Kotlin/Swift/TS-with-break) exactly
 *    and under-approximating the fall-through ones.
 */
import type {
  ConditionalBranches,
  FunctionIr,
  IrStatement,
  IrStatementKind,
  LoopBranches,
  SwitchBranches,
  TryBranches,
} from '../ir/contracts.js';
import { getTopLevelStatementIds } from '../ir/contracts.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, type ProgramAnalysisLimits } from '../limits.js';
import { CFG_VERSION, generateBlockId, type CfgBlock, type CfgEdgeKind, type FunctionCfg } from './contracts.js';

class CfgBudgetExceeded extends Error {}

interface MutableCfgBlock {
  id: string;
  functionId: string;
  statementIds: string[];
  successors: { kind: CfgEdgeKind; targetBlockId: string }[];
  predecessors: string[];
}

interface LoopContext {
  breakTarget: string;
  continueTarget: string;
}

interface FlowContext {
  /** Nearest enclosing catch's entry block, if the current position is inside a try body with a catch. */
  exceptionalTarget: string | null;
}

interface StatementListResult {
  entryBlockId: string;
  /** Block fallthrough execution reaches after this list, or null if it never falls through (e.g. ends in return/throw/break/continue). */
  exitBlockId: string | null;
}

class CfgBuilder {
  readonly functionId: string;
  readonly ir: FunctionIr;
  readonly limits: ProgramAnalysisLimits;
  readonly blocks = new Map<string, MutableCfgBlock>();
  readonly order: string[] = [];
  readonly entryBlockId: string;
  readonly exitBlockId: string;
  private counter = 0;
  truncated = false;
  private readonly reasons = new Set<string>();

  constructor(ir: FunctionIr, limits: ProgramAnalysisLimits) {
    this.ir = ir;
    this.functionId = ir.functionId;
    this.limits = limits;
    // Entry/exit are mandatory and always allowed, even under a limit smaller than 2 —
    // a CFG without them isn't a valid shape to return at all.
    this.entryBlockId = this.newBlock();
    this.exitBlockId = this.newBlock();
  }

  newBlock(): string {
    if (this.blocks.size >= 2 && this.blocks.size >= this.limits.maxBlocksPerFunction) {
      throw new CfgBudgetExceeded(`exceeded maxBlocksPerFunction (${this.limits.maxBlocksPerFunction})`);
    }
    const id = generateBlockId(this.functionId, this.counter);
    this.counter += 1;
    this.blocks.set(id, { id, functionId: this.functionId, statementIds: [], successors: [], predecessors: [] });
    this.order.push(id);
    return id;
  }

  addStatement(blockId: string, statementId: string): void {
    this.blocks.get(blockId)!.statementIds.push(statementId);
  }

  addEdge(fromBlockId: string, kind: CfgEdgeKind, targetBlockId: string): void {
    this.blocks.get(fromBlockId)!.successors.push({ kind, targetBlockId });
  }

  markTruncated(reason: string): void {
    this.truncated = true;
    this.reasons.add(reason);
  }

  reasonText(): string | undefined {
    return this.reasons.size > 0 ? [...this.reasons].sort((a, b) => a.localeCompare(b)).join('; ') : undefined;
  }

  finalizeBlocks(): Readonly<Record<string, CfgBlock>> {
    for (const blockId of this.order) {
      const block = this.blocks.get(blockId)!;
      for (const edge of block.successors) {
        this.blocks.get(edge.targetBlockId)!.predecessors.push(blockId);
      }
    }
    const frozen: Record<string, CfgBlock> = {};
    for (const [id, block] of this.blocks) {
      frozen[id] = {
        id: block.id,
        functionId: block.functionId,
        statementIds: block.statementIds,
        successors: block.successors,
        predecessors: block.predecessors,
      };
    }
    return frozen;
  }
}

const STRAIGHT_LINE_KINDS: ReadonlySet<IrStatementKind> = new Set([
  'declaration',
  'assignment',
  'call',
  'await',
  'yield',
  'unknown',
]);

function lowerStatementList(
  stmtIds: readonly string[],
  builder: CfgBuilder,
  loopCtx: LoopContext | null,
  flowCtx: FlowContext,
): StatementListResult {
  if (stmtIds.length === 0) {
    const empty = builder.newBlock();
    return { entryBlockId: empty, exitBlockId: empty };
  }

  let entryBlockId: string | null = null;
  let currentBlockId: string | null = null;

  for (const stmtId of stmtIds) {
    const statement = builder.ir.statements[stmtId]!;
    // Either the first statement, or the previous one ended with no fallthrough
    // (dead code following it): start a fresh, possibly-unreachable block.
    currentBlockId ??= builder.newBlock();
    entryBlockId ??= currentBlockId;

    currentBlockId = lowerOneStatement(statement, currentBlockId, builder, loopCtx, flowCtx);
  }

  return { entryBlockId: entryBlockId!, exitBlockId: currentBlockId };
}

function lowerOneStatement(
  statement: IrStatement,
  currentBlockId: string,
  builder: CfgBuilder,
  loopCtx: LoopContext | null,
  flowCtx: FlowContext,
): string | null {
  if (STRAIGHT_LINE_KINDS.has(statement.kind)) {
    builder.addStatement(currentBlockId, statement.id);
    return currentBlockId;
  }

  switch (statement.kind) {
    case 'return':
      builder.addStatement(currentBlockId, statement.id);
      builder.addEdge(currentBlockId, 'return', builder.exitBlockId);
      return null;

    case 'throw': {
      builder.addStatement(currentBlockId, statement.id);
      if (flowCtx.exceptionalTarget) {
        builder.addEdge(currentBlockId, 'exceptional', flowCtx.exceptionalTarget);
      } else {
        builder.addEdge(currentBlockId, 'throw', builder.exitBlockId);
      }
      return null;
    }

    case 'break':
      builder.addStatement(currentBlockId, statement.id);
      builder.addEdge(currentBlockId, 'break', loopCtx?.breakTarget ?? builder.exitBlockId);
      return null;

    case 'continue':
      builder.addStatement(currentBlockId, statement.id);
      builder.addEdge(currentBlockId, 'continue', loopCtx?.continueTarget ?? builder.exitBlockId);
      return null;

    case 'goto':
      builder.addStatement(currentBlockId, statement.id);
      builder.markTruncated('goto edges are not modeled');
      return null;

    case 'conditional':
      return lowerConditional(statement, currentBlockId, builder, loopCtx, flowCtx);

    case 'switch':
      return lowerSwitch(statement, currentBlockId, builder, loopCtx, flowCtx);

    case 'loop':
      return lowerLoop(statement, currentBlockId, builder, flowCtx);

    case 'try':
      return lowerTry(statement, currentBlockId, builder, loopCtx, flowCtx);

    case 'label':
      // Nested body has no branch ambiguity for a plain label; lower it in place.
      builder.addStatement(currentBlockId, statement.id);
      builder.markTruncated('label/goto targets are not resolved to a specific block');
      return currentBlockId;

    default:
      builder.addStatement(currentBlockId, statement.id);
      return currentBlockId;
  }
}

function lowerConditional(
  statement: IrStatement,
  currentBlockId: string,
  builder: CfgBuilder,
  loopCtx: LoopContext | null,
  flowCtx: FlowContext,
): string | null {
  builder.addStatement(currentBlockId, statement.id);
  const branches = statement.branches as ConditionalBranches;

  const thenResult = lowerStatementList(branches.then, builder, loopCtx, flowCtx);
  builder.addEdge(currentBlockId, 'true', thenResult.entryBlockId);

  const hasElse = !!branches.else && branches.else.length > 0;
  const elseResult = hasElse ? lowerStatementList(branches.else!, builder, loopCtx, flowCtx) : null;
  if (elseResult) builder.addEdge(currentBlockId, 'false', elseResult.entryBlockId);

  const fallthroughSources: Array<{ blockId: string; kind: CfgEdgeKind }> = [];
  if (thenResult.exitBlockId) fallthroughSources.push({ blockId: thenResult.exitBlockId, kind: 'normal' });
  if (elseResult) {
    if (elseResult.exitBlockId) fallthroughSources.push({ blockId: elseResult.exitBlockId, kind: 'normal' });
  } else {
    // No else branch: the condition being false falls straight through to the join point.
    fallthroughSources.push({ blockId: currentBlockId, kind: 'false' });
  }

  if (fallthroughSources.length === 0) return null;
  const joinBlockId = builder.newBlock();
  for (const source of fallthroughSources) builder.addEdge(source.blockId, source.kind, joinBlockId);
  return joinBlockId;
}

function lowerSwitch(
  statement: IrStatement,
  currentBlockId: string,
  builder: CfgBuilder,
  loopCtx: LoopContext | null,
  flowCtx: FlowContext,
): string | null {
  builder.addStatement(currentBlockId, statement.id);
  const branches = statement.branches as SwitchBranches;

  // Created eagerly so `break` inside a case body has somewhere to target.
  const joinBlockId = builder.newBlock();
  const switchLoopCtx: LoopContext = { breakTarget: joinBlockId, continueTarget: loopCtx?.continueTarget ?? joinBlockId };

  let hasDefault = false;
  for (const group of branches.cases) {
    if (group.isDefault) hasDefault = true;
    const groupResult = lowerStatementList(group.body, builder, switchLoopCtx, flowCtx);
    builder.addEdge(currentBlockId, 'case', groupResult.entryBlockId);
    if (groupResult.exitBlockId) builder.addEdge(groupResult.exitBlockId, 'normal', joinBlockId);
  }
  if (!hasDefault) builder.addEdge(currentBlockId, 'normal', joinBlockId);
  if (branches.cases.length > 0) {
    builder.markTruncated('switch case fallthrough-to-next-case is not modeled');
  }

  return joinBlockId;
}

function lowerLoop(statement: IrStatement, currentBlockId: string, builder: CfgBuilder, flowCtx: FlowContext): string {
  builder.addStatement(currentBlockId, statement.id);
  const branches = statement.branches as LoopBranches;

  const loopExitId = builder.newBlock();
  const loopCtx: LoopContext = { breakTarget: loopExitId, continueTarget: currentBlockId };

  const bodyResult = lowerStatementList(branches.body, builder, loopCtx, flowCtx);
  builder.addEdge(currentBlockId, 'loop-entry', bodyResult.entryBlockId);
  if (bodyResult.exitBlockId) builder.addEdge(bodyResult.exitBlockId, 'loop-back', currentBlockId);
  builder.addEdge(currentBlockId, 'loop-exit', loopExitId);
  builder.markTruncated('loop init/condition/update clauses are not modeled (only the body is)');

  return loopExitId;
}

function lowerTry(
  statement: IrStatement,
  currentBlockId: string,
  builder: CfgBuilder,
  loopCtx: LoopContext | null,
  flowCtx: FlowContext,
): string | null {
  builder.addStatement(currentBlockId, statement.id);
  const branches = statement.branches as TryBranches;

  const catchResults = branches.catches.map((group) => lowerStatementList(group.body, builder, loopCtx, flowCtx));
  const firstCatchEntryId = catchResults[0]?.entryBlockId ?? null;

  const bodyFlowCtx: FlowContext = { exceptionalTarget: firstCatchEntryId ?? flowCtx.exceptionalTarget };
  const bodyResult = lowerStatementList(branches.body, builder, loopCtx, bodyFlowCtx);
  builder.addEdge(currentBlockId, 'normal', bodyResult.entryBlockId);
  if (firstCatchEntryId) builder.addEdge(bodyResult.entryBlockId, 'exceptional', firstCatchEntryId);

  const normalExits = [bodyResult.exitBlockId, ...catchResults.map((r) => r.exitBlockId)].filter(
    (id): id is string => id !== null,
  );

  if (branches.finallyBody && branches.finallyBody.length > 0) {
    const finallyResult = lowerStatementList(branches.finallyBody, builder, loopCtx, flowCtx);
    for (const exit of normalExits) builder.addEdge(exit, 'finally', finallyResult.entryBlockId);
    builder.markTruncated(
      'finally is only routed for the normal exit path; early exits (return/throw/break/continue) inside try/catch bypass it',
    );
    return finallyResult.exitBlockId;
  }

  if (normalExits.length === 0) return null;
  const joinBlockId = builder.newBlock();
  for (const exit of normalExits) builder.addEdge(exit, 'normal', joinBlockId);
  return joinBlockId;
}

export function buildFunctionCfg(ir: FunctionIr, limits: ProgramAnalysisLimits = DEFAULT_PROGRAM_ANALYSIS_LIMITS): FunctionCfg {
  const builder = new CfgBuilder(ir, limits);

  if (ir.truncated) builder.markTruncated(ir.reason ?? 'source IR is truncated');

  try {
    const topLevelIds = getTopLevelStatementIds(ir);
    const result = lowerStatementList(topLevelIds, builder, null, { exceptionalTarget: null });
    builder.addEdge(builder.entryBlockId, 'normal', result.entryBlockId);
    if (result.exitBlockId) builder.addEdge(result.exitBlockId, 'normal', builder.exitBlockId);
  } catch (err) {
    if (!(err instanceof CfgBudgetExceeded)) throw err;
    builder.markTruncated(err.message);
  }

  return {
    version: CFG_VERSION,
    functionId: ir.functionId,
    entryBlockId: builder.entryBlockId,
    exitBlockId: builder.exitBlockId,
    blocks: builder.finalizeBlocks(),
    order: builder.order,
    truncated: builder.truncated,
    reason: builder.reasonText(),
  };
}
