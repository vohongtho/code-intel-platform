/**
 * languages/generic-lowering.ts
 *
 * One tree-sitter-to-universal-IR walker shared by every language, driven
 * by the per-language `LanguageLoweringTable` (lowering-tables.ts). A
 * construct not present in the active table always lowers to an explicit
 * `unknown`/uncertain node rather than being dropped or treated as a no-op
 * (spec: "Unsupported lowering MUST remain explicit").
 *
 * Container statements (conditional/switch/try/loop/label) build a
 * branch-discriminated `StatementBranches` value — not just a flat list of
 * nested ids — because CFG construction needs to tell a then-branch
 * statement apart from an else-branch statement, a switch case from its
 * neighbor, and a try body from its catch/finally blocks.
 */
import type { Node as TSNode } from 'web-tree-sitter';
import type { Language } from '../../shared/languages.js';
import type { SourceRange } from '../../semantic/anchors.js';
import {
  IR_VERSION,
  flattenStatementBranches,
  generateExpressionId,
  generateStatementId,
  isContainerStatementKind,
  type ConditionalBranches,
  type FunctionIr,
  type IrExpression,
  type IrExpressionKind,
  type IrStatement,
  type IrStatementKind,
  type StatementBranches,
  type SwitchBranches,
  type TryBranches,
  type TryCatchGroup,
} from '../ir/contracts.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, isDeadlineExceeded, startDeadline, type ProgramAnalysisLimits } from '../limits.js';
import { getLoweringTable, type LanguageLoweringTable } from './lowering-tables.js';

class LoweringBudgetExceeded extends Error {}

interface LoweringContext {
  functionId: string;
  filePath: string;
  statements: Record<string, IrStatement>;
  expressions: Record<string, IrExpression>;
  order: string[];
  stmtCounter: number;
  exprCounter: number;
  limits: ProgramAnalysisLimits;
  deadline: ReturnType<typeof startDeadline>;
  /** Names lowered as `parameter-read` instead of `local-read` — see `LowerFunctionInput.parameterNames`. */
  parameterNames: ReadonlySet<string>;
}

function rangeOf(node: TSNode, filePath: string): SourceRange {
  return {
    filePath,
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
  };
}

function truncateText(text: string, max = 160): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function unwrapTransparent(node: TSNode, table: LanguageLoweringTable, maxHops = 4): TSNode {
  let current = node;
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (!table.transparentWrapperTypes.includes(current.type)) break;
    const children = current.namedChildren;
    const only = children.length === 1 ? children[0] : undefined;
    if (!only) break;
    current = only;
  }
  return current;
}

function leadingWord(text: string): string {
  return text.trim().split(/\s+/, 1)[0] ?? '';
}

interface SlotClassification {
  kind: IrStatementKind;
  node: TSNode;
  reason?: string;
}

function classifySlot(rawNode: TSNode, table: LanguageLoweringTable, allowFallback: boolean): SlotClassification | null {
  const node = unwrapTransparent(rawNode, table);

  const direct = table.statementKindByType[node.type];
  if (direct) return { kind: direct, node };

  if (table.expressionStatementWrapperType && node.type === table.expressionStatementWrapperType) {
    const inner = node.namedChildren[0];
    if (inner) {
      const resolvedInner = unwrapTransparent(inner, table);
      const innerKind = table.expressionStatementInnerKind[resolvedInner.type];
      if (innerKind) return { kind: innerKind, node: resolvedInner };
    }
    return allowFallback
      ? { kind: 'unknown', node, reason: `unrecognized expression statement${inner ? `: ${inner.type}` : ''}` }
      : null;
  }

  if (table.collapsedControlTransferTypes?.includes(node.type) && table.disambiguateByLeadingText) {
    const mapped = table.disambiguateByLeadingText[leadingWord(node.text)];
    if (mapped) return { kind: mapped, node };
  }

  return allowFallback ? { kind: 'unknown', node, reason: `unmapped node type: ${node.type}` } : null;
}

function primaryExpressionChild(node: TSNode, kind: IrStatementKind): TSNode | undefined {
  switch (kind) {
    case 'return':
    case 'throw':
    case 'await':
    case 'yield':
      return node.namedChildren[0];
    case 'call':
      return node;
    case 'assignment': {
      const children = node.namedChildren;
      return children.length > 0 ? children[children.length - 1] : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Best-effort declared-name lookup for a `declaration` statement: a
 * breadth-first (shallowest-and-leftmost-first) search for the first node
 * whose type is mapped to `local-read` in the language's expression table.
 * Across every grammar this table covers, a declaration's own name/pattern
 * appears before any type annotation or initializer, so this reliably
 * finds the declared name without per-language field access. Bounded so a
 * pathological declaration can't make lowering scan unboundedly.
 */
function findDeclaredNameNode(node: TSNode, table: LanguageLoweringTable, maxVisited = 40): TSNode | undefined {
  const queue: TSNode[] = [...node.namedChildren.filter((child): child is TSNode => !!child)];
  let visited = 0;
  while (queue.length > 0 && visited < maxVisited) {
    const current = queue.shift()!;
    visited += 1;
    if (table.expressionKindByType[current.type] === 'local-read') return current;
    queue.push(...current.namedChildren.filter((child): child is TSNode => !!child));
  }
  return undefined;
}

/** The write-target node(s) for a statement, lowered as ordinary (shallow) expressions but recorded as write targets rather than reads. */
function targetExpressionChild(node: TSNode, kind: IrStatementKind, table: LanguageLoweringTable): TSNode | undefined {
  switch (kind) {
    case 'assignment':
      return node.namedChildren[0];
    case 'declaration':
      return findDeclaredNameNode(node, table);
    default:
      return undefined;
  }
}

/**
 * Best-effort argument-reads lookup for a `call` statement/expression: a
 * breadth-first search collecting every node whose type is mapped to
 * `local-read` anywhere in the call's subtree (callee included — a bare
 * function-reference read is harmless to also record). This is how
 * data-flow analyses downstream (dataflow/*, taint/*) see "variable X was
 * passed into this call" without full recursive expression lowering.
 * Bounded so a pathological call expression can't make lowering scan
 * unboundedly.
 */
function findIdentifierReads(node: TSNode, table: LanguageLoweringTable, maxVisited = 40): TSNode[] {
  const found: TSNode[] = [];
  const queue: TSNode[] = [...node.namedChildren.filter((child): child is TSNode => !!child)];
  let visited = 0;
  while (queue.length > 0 && visited < maxVisited) {
    const current = queue.shift()!;
    visited += 1;
    if (table.expressionKindByType[current.type] === 'local-read') {
      found.push(current);
      continue;
    }
    queue.push(...current.namedChildren.filter((child): child is TSNode => !!child));
  }
  return found;
}

function checkBudget(ctx: LoweringContext): void {
  if (ctx.order.length >= ctx.limits.maxStatementsPerFunction) {
    throw new LoweringBudgetExceeded(`exceeded maxStatementsPerFunction (${ctx.limits.maxStatementsPerFunction})`);
  }
  if (isDeadlineExceeded(ctx.deadline)) {
    throw new LoweringBudgetExceeded(`exceeded maxAnalysisTimeMsPerFunction (${ctx.limits.maxAnalysisTimeMsPerFunction}ms)`);
  }
}

function lowerExpressionShallow(rawNode: TSNode, table: LanguageLoweringTable, ctx: LoweringContext): string {
  const node = unwrapTransparent(rawNode, table);
  const text = truncateText(node.text);
  let kind: IrExpressionKind = table.expressionKindByType[node.type] ?? 'unknown';
  if (kind === 'local-read' && ctx.parameterNames.has(node.text)) kind = 'parameter-read';
  const id = generateExpressionId(ctx.functionId, ctx.exprCounter);
  ctx.exprCounter += 1;
  ctx.expressions[id] = {
    id,
    functionId: ctx.functionId,
    range: rangeOf(node, ctx.filePath),
    kind,
    operands: [],
    name: text,
    ...(kind === 'unknown' ? { uncertain: true, uncertaintyReason: `unmapped expression node type: ${node.type}` } : {}),
  };
  return id;
}

function extractLabelName(node: TSNode, table: LanguageLoweringTable): string | undefined {
  for (const child of node.children) {
    if (child && table.labelIdentifierTypes.includes(child.type)) return child.text;
  }
  return undefined;
}

/** A statement/expression slot found directly in a block's body (recognized via `classifySlot` with fallback to `unknown`). */
function lowerBlock(blockNode: TSNode, table: LanguageLoweringTable, ctx: LoweringContext): string[] {
  const ids: string[] = [];
  for (const child of blockNode.namedChildren) {
    if (!child) continue;
    const classification = classifySlot(child, table, true);
    if (classification) ids.push(lowerStatement(classification, table, ctx));
  }
  return ids;
}

/** Whether `child` looks like it could hold (or itself be) a nested statement body — used to locate branch bodies positionally, skipping condition/pattern expressions. */
function isBodyLike(child: TSNode, table: LanguageLoweringTable): boolean {
  const resolved = unwrapTransparent(child, table);
  if (table.blockTypes.includes(resolved.type)) return true;
  if (table.clauses.elseTypes.includes(resolved.type)) return true;
  return classifySlot(child, table, false) !== null;
}

/** Lowers a clause wrapper's own content (else/catch/finally's single block, or — for an else-if chain — its single nested statement). */
function lowerClauseBody(clauseNode: TSNode, table: LanguageLoweringTable, ctx: LoweringContext): string[] {
  for (const child of clauseNode.namedChildren) {
    if (!child) continue;
    const resolved = unwrapTransparent(child, table);
    if (table.blockTypes.includes(resolved.type)) return lowerBlock(resolved, table, ctx);
  }
  for (const child of clauseNode.namedChildren) {
    if (!child) continue;
    const classification = classifySlot(child, table, false);
    if (classification) return [lowerStatement(classification, table, ctx)];
  }
  return [];
}

function lowerBodyLikeAsStatementList(child: TSNode, table: LanguageLoweringTable, ctx: LoweringContext): string[] {
  const resolved = unwrapTransparent(child, table);
  if (table.blockTypes.includes(resolved.type)) return lowerBlock(resolved, table, ctx);
  if (table.clauses.elseTypes.includes(resolved.type)) return lowerClauseBody(resolved, table, ctx);
  const classification = classifySlot(child, table, false);
  return classification ? [lowerStatement(classification, table, ctx)] : [];
}

/**
 * Locates the then/else bodies positionally: across every grammar checked
 * for this change, a conditional's namedChildren order as (condition,
 * then-body, else-body?) — the condition itself is never block-shaped,
 * clause-shaped, or independently classifiable as a statement, so it's
 * naturally skipped by `isBodyLike` without needing per-language field
 * names.
 */
function buildConditionalBranches(node: TSNode, table: LanguageLoweringTable, ctx: LoweringContext): ConditionalBranches {
  const bodyChildren = node.namedChildren.filter((child): child is TSNode => !!child && isBodyLike(child, table));
  const thenChild = bodyChildren[0];
  const elseChild = bodyChildren[1];
  const then = thenChild ? lowerBodyLikeAsStatementList(thenChild, table, ctx) : [];
  const elseIds = elseChild ? lowerBodyLikeAsStatementList(elseChild, table, ctx) : undefined;
  return { kind: 'conditional', then, ...(elseIds ? { else: elseIds } : {}) };
}

function findCaseNodes(node: TSNode, table: LanguageLoweringTable): TSNode[] {
  const result: TSNode[] = [];
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (table.clauses.caseContainerTypes.includes(child.type)) {
      result.push(...findCaseNodes(child, table));
    } else if (table.clauses.caseTypes.includes(child.type)) {
      result.push(child);
    }
  }
  return result;
}

function buildSwitchBranches(node: TSNode, table: LanguageLoweringTable, ctx: LoweringContext): SwitchBranches {
  const cases = findCaseNodes(node, table).map((caseNode) => ({
    // The case node's own children (test value plus body statements) are walked as one block;
    // a leading test-value child that isn't a recognized statement becomes a harmless `unknown` leaf.
    body: lowerBlock(caseNode, table, ctx),
    isDefault: table.clauses.defaultCaseTypes.includes(caseNode.type),
  }));
  return { kind: 'switch', cases };
}

function lowerIndividually(children: readonly TSNode[], table: LanguageLoweringTable, ctx: LoweringContext): string[] {
  const ids: string[] = [];
  for (const child of children) {
    const classification = classifySlot(child, table, false);
    if (classification) ids.push(lowerStatement(classification, table, ctx));
  }
  return ids;
}

function buildTryBranches(node: TSNode, table: LanguageLoweringTable, ctx: LoweringContext): TryBranches {
  const catches: TryCatchGroup[] = [];
  let finallyBody: string[] | undefined;
  const bodyCandidates: TSNode[] = [];

  for (const child of node.namedChildren) {
    if (!child) continue;
    const resolved = unwrapTransparent(child, table);
    if (table.clauses.catchTypes.includes(resolved.type)) {
      catches.push({ body: lowerClauseBody(resolved, table, ctx) });
    } else if (table.clauses.finallyTypes.includes(resolved.type)) {
      finallyBody = lowerClauseBody(resolved, table, ctx);
    } else {
      bodyCandidates.push(child);
    }
  }

  const soleCandidate = bodyCandidates.length === 1 ? bodyCandidates[0] : undefined;
  const soleResolved = soleCandidate ? unwrapTransparent(soleCandidate, table) : undefined;
  const body =
    soleResolved && table.blockTypes.includes(soleResolved.type)
      ? lowerBlock(soleResolved, table, ctx)
      : lowerIndividually(bodyCandidates, table, ctx);

  return { kind: 'try', body, catches, ...(finallyBody ? { finallyBody } : {}) };
}

/** Loop/label bodies have no branch ambiguity — search the whole subtree for nested statements, transparently skipping unrecognized wrapper nodes (e.g. a generic `statement` wrapper or the loop's init/condition/update clauses). */
function collectFlatBody(node: TSNode, table: LanguageLoweringTable, ctx: LoweringContext): string[] {
  const ids: string[] = [];
  for (const child of node.namedChildren) {
    if (!child) continue;
    const resolved = unwrapTransparent(child, table);
    if (table.blockTypes.includes(resolved.type)) {
      ids.push(...lowerBlock(resolved, table, ctx));
    } else {
      const classification = classifySlot(child, table, false);
      if (classification) ids.push(lowerStatement(classification, table, ctx));
    }
  }
  return ids;
}

function buildBranches(
  kind: IrStatementKind,
  node: TSNode,
  table: LanguageLoweringTable,
  ctx: LoweringContext,
): StatementBranches | undefined {
  switch (kind) {
    case 'conditional':
      return buildConditionalBranches(node, table, ctx);
    case 'switch':
      return buildSwitchBranches(node, table, ctx);
    case 'try':
      return buildTryBranches(node, table, ctx);
    case 'loop':
      return { kind: 'loop', body: collectFlatBody(node, table, ctx) };
    case 'label':
      return { kind: 'label', body: collectFlatBody(node, table, ctx) };
    default:
      return undefined;
  }
}

function lowerStatement(classification: SlotClassification, table: LanguageLoweringTable, ctx: LoweringContext): string {
  checkBudget(ctx);
  const { node, reason } = classification;
  let kind = classification.kind;
  let uncertaintyReason = kind === 'unknown' ? reason : undefined;
  let labelName: string | undefined;

  if (kind === 'label' || kind === 'goto') {
    labelName = extractLabelName(node, table);
    if (!labelName) {
      kind = 'unknown';
      uncertaintyReason = `could not extract labelName for ${classification.kind} node type: ${node.type}`;
    }
  }

  const id = generateStatementId(ctx.functionId, ctx.stmtCounter);
  ctx.stmtCounter += 1;
  // Recorded before descending into nested statements so `order` reflects
  // source (pre-)order — entryStatementId depends on this being true for
  // the very first top-level statement.
  ctx.order.push(id);

  const primary = primaryExpressionChild(node, kind);
  const expressions = primary ? [lowerExpressionShallow(primary, table, ctx)] : [];
  if (kind === 'call') {
    for (const identifierNode of findIdentifierReads(node, table)) {
      expressions.push(lowerExpressionShallow(identifierNode, table, ctx));
    }
  }
  const targetNode = targetExpressionChild(node, kind, table);
  const targets = targetNode ? [lowerExpressionShallow(targetNode, table, ctx)] : [];
  const branches = isContainerStatementKind(kind) ? buildBranches(kind, node, table, ctx) : undefined;
  const children = branches ? flattenStatementBranches(branches) : [];

  ctx.statements[id] = {
    id,
    functionId: ctx.functionId,
    range: rangeOf(node, ctx.filePath),
    kind,
    expressions,
    targets,
    children,
    ...(branches ? { branches } : {}),
    ...(kind === 'unknown' ? { uncertain: true, uncertaintyReason } : {}),
    ...(labelName ? { labelName } : {}),
  };
  return id;
}

export interface LowerFunctionInput {
  /** The function/method's block/body container node (e.g. `statement_block`, `block`, `compound_statement`) — the caller locates it. */
  bodyNode: TSNode;
  language: Language;
  functionId: string;
  filePath: string;
  limits?: ProgramAnalysisLimits;
  /**
   * Parameter names, sourced from the existing symbol graph (already
   * extracted at parse time — see `CodeNode.metadata.parameters`) rather
   * than re-derived here. Read expressions matching one of these names
   * lower as `parameter-read` instead of `local-read`, which function
   * summaries (task 7) use for parameter-to-return influence.
   */
  parameterNames?: readonly string[];
}

function emptyIr(input: LowerFunctionInput, reason: string): FunctionIr {
  return {
    version: IR_VERSION,
    functionId: input.functionId,
    language: input.language,
    entryStatementId: null,
    statements: {},
    expressions: {},
    order: [],
    truncated: true,
    reason,
  };
}

export function lowerFunctionToIr(input: LowerFunctionInput): FunctionIr {
  const table = getLoweringTable(input.language);
  if (!table) return emptyIr(input, `no program-analysis lowering table for language ${input.language}`);

  const limits = input.limits ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS;
  const ctx: LoweringContext = {
    functionId: input.functionId,
    filePath: input.filePath,
    statements: {},
    expressions: {},
    order: [],
    stmtCounter: 0,
    exprCounter: 0,
    limits,
    deadline: startDeadline(limits.maxAnalysisTimeMsPerFunction),
    parameterNames: new Set(input.parameterNames ?? []),
  };

  let truncated = false;
  let reason: string | undefined;
  let topLevelIds: string[] = [];
  try {
    topLevelIds = lowerBlock(input.bodyNode, table, ctx);
  } catch (err) {
    if (!(err instanceof LoweringBudgetExceeded)) throw err;
    truncated = true;
    reason = err.message;
  }

  return {
    version: IR_VERSION,
    functionId: input.functionId,
    language: input.language,
    entryStatementId: topLevelIds[0] ?? ctx.order[0] ?? null,
    statements: ctx.statements,
    expressions: ctx.expressions,
    order: ctx.order,
    truncated,
    reason,
  };
}
