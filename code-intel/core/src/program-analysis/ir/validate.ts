/**
 * ir/validate.ts
 *
 * Structural validation for a lowered `FunctionIr`. Every language adapter
 * (task 3) must produce IR that passes this check before it is handed to
 * CFG construction; catching a dangling reference or an "unknown" node
 * missing its uncertainty flag here is far cheaper than debugging it three
 * stages downstream in the PDG or taint engine.
 */
import type { FunctionIr, IrExpression, IrStatement } from './contracts.js';
import { flattenStatementBranches, getTopLevelStatementIds, isContainerStatementKind } from './contracts.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, type ProgramAnalysisLimits } from '../limits.js';

export interface IrValidationResult {
  valid: boolean;
  errors: readonly string[];
}

/** Iterative (non-recursive) cycle detection so deeply nested functions can't overflow the call stack. */
function detectCycle(nodeIds: readonly string[], next: (id: string) => readonly string[]): string | null {
  const color = new Map<string, 1 | 2>();
  for (const start of nodeIds) {
    if (color.get(start) === 2) continue;
    const stack: Array<{ id: string; iter: Iterator<string> }> = [];
    color.set(start, 1);
    stack.push({ id: start, iter: next(start)[Symbol.iterator]() });
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const { value, done } = top.iter.next();
      if (done) {
        color.set(top.id, 2);
        stack.pop();
        continue;
      }
      const childColor = color.get(value);
      if (childColor === 1) return value;
      if (childColor !== 2) {
        color.set(value, 1);
        stack.push({ id: value, iter: next(value)[Symbol.iterator]() });
      }
    }
  }
  return null;
}

function validateOrderAndEntry(ir: FunctionIr, statementIdSet: ReadonlySet<string>, errors: string[]): void {
  const orderSet = new Set(ir.order);
  if (orderSet.size !== ir.order.length) {
    errors.push('order contains duplicate statement ids');
  }
  if (orderSet.size !== statementIdSet.size || [...orderSet].some((id) => !statementIdSet.has(id))) {
    errors.push('order does not match the set of statements exactly');
  }

  if (ir.entryStatementId !== null) {
    if (!statementIdSet.has(ir.entryStatementId)) {
      errors.push(`entryStatementId ${ir.entryStatementId} is not a known statement`);
    }
    if (!orderSet.has(ir.entryStatementId)) {
      errors.push(`entryStatementId ${ir.entryStatementId} is missing from order`);
    }
  }

  const expectedEntry = getTopLevelStatementIds(ir)[0] ?? null;
  if (ir.entryStatementId !== expectedEntry) {
    errors.push(
      `entryStatementId ${ir.entryStatementId} does not match the first top-level statement (${expectedEntry})`,
    );
  }
}

function validateStatementBranches(key: string, statement: IrStatement, errors: string[]): void {
  if (!isContainerStatementKind(statement.kind)) {
    if (statement.branches) errors.push(`statement ${key} has leaf kind '${statement.kind}' but carries branches`);
    return;
  }
  if (!statement.branches) {
    errors.push(`statement ${key} has container kind '${statement.kind}' but is missing branches`);
    return;
  }
  if (statement.branches.kind !== statement.kind) {
    errors.push(`statement ${key} has kind '${statement.kind}' but branches.kind is '${statement.branches.kind}'`);
    return;
  }
  const flattened = flattenStatementBranches(statement.branches);
  const flattenedSet = new Set(flattened);
  if (flattenedSet.size !== flattened.length) {
    errors.push(`statement ${key} branches reference the same nested statement more than once`);
  }
  const childrenSet = new Set(statement.children);
  if (childrenSet.size !== statement.children.length) {
    errors.push(`statement ${key} children contains duplicate ids`);
  }
  const matchesChildren =
    flattened.every((id) => childrenSet.has(id)) && statement.children.every((id) => flattenedSet.has(id));
  if (!matchesChildren) {
    errors.push(`statement ${key} children does not match the flattened union of branches`);
  }
}

function validateStatementReferences(
  key: string,
  statement: IrStatement,
  statementIdSet: ReadonlySet<string>,
  expressionIdSet: ReadonlySet<string>,
  errors: string[],
): void {
  for (const exprId of statement.expressions) {
    if (!expressionIdSet.has(exprId)) errors.push(`statement ${key} references unknown expression ${exprId}`);
  }
  for (const targetId of statement.targets) {
    if (!expressionIdSet.has(targetId)) errors.push(`statement ${key} references unknown target expression ${targetId}`);
  }
  for (const childId of statement.children) {
    if (childId === key) errors.push(`statement ${key} lists itself as a child`);
    else if (!statementIdSet.has(childId)) errors.push(`statement ${key} references unknown child statement ${childId}`);
  }
}

function validateStatement(
  key: string,
  statement: IrStatement,
  ir: FunctionIr,
  statementIdSet: ReadonlySet<string>,
  expressionIdSet: ReadonlySet<string>,
  errors: string[],
): void {
  if (statement.id !== key) errors.push(`statement key ${key} does not match its id ${statement.id}`);
  if (statement.functionId !== ir.functionId) errors.push(`statement ${key} has mismatched functionId`);
  if (statement.kind === 'unknown' && !statement.uncertain) {
    errors.push(`statement ${key} has kind 'unknown' but is not marked uncertain`);
  }
  if ((statement.kind === 'goto' || statement.kind === 'label') && !statement.labelName) {
    errors.push(`${statement.kind} statement ${key} is missing labelName`);
  }
  validateStatementReferences(key, statement, statementIdSet, expressionIdSet, errors);
  validateStatementBranches(key, statement, errors);
}

function validateParentUniqueness(ir: FunctionIr, statementIdSet: ReadonlySet<string>, errors: string[]): void {
  const parentOf = new Map<string, string>();
  for (const [key, statement] of Object.entries(ir.statements)) {
    for (const childId of statement.children) {
      if (!statementIdSet.has(childId)) continue;
      const existingParent = parentOf.get(childId);
      if (existingParent && existingParent !== key) {
        errors.push(`statement ${childId} has multiple parents (${existingParent} and ${key})`);
      }
      parentOf.set(childId, key);
    }
  }
}

function validateExpression(
  key: string,
  expression: IrExpression,
  ir: FunctionIr,
  expressionIdSet: ReadonlySet<string>,
  errors: string[],
): void {
  if (expression.id !== key) errors.push(`expression key ${key} does not match its id ${expression.id}`);
  if (expression.functionId !== ir.functionId) errors.push(`expression ${key} has mismatched functionId`);
  if (expression.kind === 'unknown' && !expression.uncertain) {
    errors.push(`expression ${key} has kind 'unknown' but is not marked uncertain`);
  }
  for (const operandId of expression.operands) {
    if (operandId === key) errors.push(`expression ${key} lists itself as an operand`);
    else if (!expressionIdSet.has(operandId)) errors.push(`expression ${key} references unknown operand ${operandId}`);
  }
}

export function validateFunctionIr(
  ir: FunctionIr,
  limits: ProgramAnalysisLimits = DEFAULT_PROGRAM_ANALYSIS_LIMITS,
): IrValidationResult {
  const errors: string[] = [];
  const statementIds = Object.keys(ir.statements);
  const expressionIds = Object.keys(ir.expressions);
  const statementIdSet = new Set(statementIds);
  const expressionIdSet = new Set(expressionIds);

  validateOrderAndEntry(ir, statementIdSet, errors);

  for (const [key, statement] of Object.entries(ir.statements)) {
    validateStatement(key, statement, ir, statementIdSet, expressionIdSet, errors);
  }
  validateParentUniqueness(ir, statementIdSet, errors);

  const statementCycle = detectCycle(
    statementIds,
    (id) => ir.statements[id]?.children.filter((childId) => statementIdSet.has(childId) && childId !== id) ?? [],
  );
  if (statementCycle) errors.push(`statement graph contains a cycle involving ${statementCycle}`);

  for (const [key, expression] of Object.entries(ir.expressions)) {
    validateExpression(key, expression, ir, expressionIdSet, errors);
  }

  const expressionCycle = detectCycle(
    expressionIds,
    (id) => ir.expressions[id]?.operands.filter((operandId) => expressionIdSet.has(operandId) && operandId !== id) ?? [],
  );
  if (expressionCycle) errors.push(`expression graph contains a cycle involving ${expressionCycle}`);

  if (!ir.truncated && statementIds.length > limits.maxStatementsPerFunction) {
    errors.push(
      `statement count ${statementIds.length} exceeds maxStatementsPerFunction (${limits.maxStatementsPerFunction}) without being marked truncated`,
    );
  }

  return { valid: errors.length === 0, errors };
}
