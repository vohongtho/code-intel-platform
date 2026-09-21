import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Language } from '../../../../src/shared/languages.js';
import { IR_VERSION, generateExpressionId, generateStatementId } from '../../../../src/program-analysis/ir/contracts.js';
import { validateFunctionIr } from '../../../../src/program-analysis/ir/validate.js';
import type { FunctionIr, IrExpression, IrStatement } from '../../../../src/program-analysis/ir/contracts.js';

const FUNCTION_ARTIFACT_ID = 'pa:v1:ir:test-fn';
const FUNCTION_ID = 'sym:v2:function:test';

function range(startLine = 1) {
  return { filePath: '/src/foo.ts', startLine, startColumn: 0, endLine: startLine, endColumn: 10 };
}

function makeExpression(localIndex: number, overrides: Partial<IrExpression> = {}): IrExpression {
  const id = generateExpressionId(FUNCTION_ARTIFACT_ID, localIndex);
  return {
    id,
    functionId: FUNCTION_ID,
    range: range(),
    kind: 'literal',
    operands: [],
    ...overrides,
  };
}

function makeStatement(localIndex: number, overrides: Partial<IrStatement> = {}): IrStatement {
  const id = generateStatementId(FUNCTION_ARTIFACT_ID, localIndex);
  return {
    id,
    functionId: FUNCTION_ID,
    range: range(),
    kind: 'return',
    expressions: [],
    targets: [],
    children: [],
    ...overrides,
  };
}

function baseIr(overrides: Partial<FunctionIr> = {}): FunctionIr {
  const expr = makeExpression(0);
  const stmt = makeStatement(0, { expressions: [expr.id] });
  return {
    version: IR_VERSION,
    functionId: FUNCTION_ID,
    language: Language.TypeScript,
    entryStatementId: stmt.id,
    statements: { [stmt.id]: stmt },
    expressions: { [expr.id]: expr },
    order: [stmt.id],
    truncated: false,
    ...overrides,
  };
}

describe('validateFunctionIr', () => {
  it('accepts a minimal well-formed function IR', () => {
    const result = validateFunctionIr(baseIr());
    assert.deepEqual(result, { valid: true, errors: [] });
  });

  it('rejects a statement referencing an unknown expression', () => {
    const ir = baseIr();
    const stmtId = ir.order[0]!;
    const mutated: FunctionIr = {
      ...ir,
      statements: { ...ir.statements, [stmtId]: { ...ir.statements[stmtId]!, expressions: ['ghost-expr'] } },
    };
    const result = validateFunctionIr(mutated);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('unknown expression')));
  });

  it('rejects an entryStatementId missing from statements', () => {
    const ir = baseIr({ entryStatementId: 'ghost-stmt' });
    const result = validateFunctionIr(ir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('entryStatementId')));
  });

  it('rejects order that does not match the statement set', () => {
    const ir = baseIr();
    const mutated: FunctionIr = { ...ir, order: [] };
    const result = validateFunctionIr(mutated);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('order does not match')));
  });

  it("requires 'unknown' statements to be marked uncertain", () => {
    const expr = makeExpression(0);
    const stmt = makeStatement(0, { kind: 'unknown', expressions: [expr.id], uncertain: false });
    const ir: FunctionIr = {
      version: IR_VERSION,
      functionId: FUNCTION_ID,
      language: Language.TypeScript,
      entryStatementId: stmt.id,
      statements: { [stmt.id]: stmt },
      expressions: { [expr.id]: expr },
      order: [stmt.id],
      truncated: false,
    };
    const result = validateFunctionIr(ir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("not marked uncertain")));
  });

  it("requires 'unknown' expressions to be marked uncertain", () => {
    const expr = makeExpression(0, { kind: 'unknown', uncertain: false });
    const stmt = makeStatement(0, { expressions: [expr.id] });
    const ir: FunctionIr = {
      version: IR_VERSION,
      functionId: FUNCTION_ID,
      language: Language.TypeScript,
      entryStatementId: stmt.id,
      statements: { [stmt.id]: stmt },
      expressions: { [expr.id]: expr },
      order: [stmt.id],
      truncated: false,
    };
    const result = validateFunctionIr(ir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("not marked uncertain")));
  });

  it('accepts an unknown statement/expression when marked uncertain with a reason', () => {
    const expr = makeExpression(0, { kind: 'unknown', uncertain: true, uncertaintyReason: 'unsupported syntax' });
    const stmt = makeStatement(0, { kind: 'unknown', expressions: [expr.id], uncertain: true, uncertaintyReason: 'unsupported syntax' });
    const ir: FunctionIr = {
      version: IR_VERSION,
      functionId: FUNCTION_ID,
      language: Language.TypeScript,
      entryStatementId: stmt.id,
      statements: { [stmt.id]: stmt },
      expressions: { [expr.id]: expr },
      order: [stmt.id],
      truncated: false,
    };
    const result = validateFunctionIr(ir);
    assert.deepEqual(result, { valid: true, errors: [] });
  });

  it('detects a cycle in nested statement children', () => {
    const stmtA = makeStatement(0, { kind: 'loop', children: [generateStatementId(FUNCTION_ARTIFACT_ID, 1)] });
    const stmtB = makeStatement(1, { kind: 'loop', children: [stmtA.id] });
    const ir: FunctionIr = {
      version: IR_VERSION,
      functionId: FUNCTION_ID,
      language: Language.TypeScript,
      entryStatementId: stmtA.id,
      statements: { [stmtA.id]: stmtA, [stmtB.id]: stmtB },
      expressions: {},
      order: [stmtA.id, stmtB.id],
      truncated: false,
    };
    const result = validateFunctionIr(ir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('cycle')));
  });

  it('detects a statement claimed as a child by two parents', () => {
    const shared = makeStatement(2, { kind: 'return' });
    const parentA = makeStatement(0, { kind: 'conditional', children: [shared.id] });
    const parentB = makeStatement(1, { kind: 'conditional', children: [shared.id] });
    const ir: FunctionIr = {
      version: IR_VERSION,
      functionId: FUNCTION_ID,
      language: Language.TypeScript,
      entryStatementId: parentA.id,
      statements: { [parentA.id]: parentA, [parentB.id]: parentB, [shared.id]: shared },
      expressions: {},
      order: [parentA.id, parentB.id, shared.id],
      truncated: false,
    };
    const result = validateFunctionIr(ir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('multiple parents')));
  });

  it('requires goto/label statements to carry a labelName', () => {
    const stmt = makeStatement(0, { kind: 'goto' });
    const ir: FunctionIr = {
      version: IR_VERSION,
      functionId: FUNCTION_ID,
      language: Language.TypeScript,
      entryStatementId: stmt.id,
      statements: { [stmt.id]: stmt },
      expressions: {},
      order: [stmt.id],
      truncated: false,
    };
    const result = validateFunctionIr(ir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('labelName')));
  });

  it('flags a non-truncated IR that exceeds the statement limit', () => {
    const ir = baseIr();
    const result = validateFunctionIr(ir, {
      maxStatementsPerFunction: 0,
      maxBlocksPerFunction: 1000,
      maxWorklistIterations: 10000,
      maxCallSummaryDepth: 6,
      maxIntraproceduralChainDepth: 32,
      maxAnalyzedFunctionsPerRequest: 500,
      maxAnalysisTimeMsPerFunction: 2000,
      maxAnalysisTimeMsPerRequest: 30000,
      maxArtifactBytes: 5 * 1024 * 1024,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('exceeds maxStatementsPerFunction')));
  });

  it('does not flag a truncated IR that exceeds the statement limit', () => {
    const ir = baseIr({ truncated: true, reason: 'too many statements' });
    const result = validateFunctionIr(ir, {
      maxStatementsPerFunction: 0,
      maxBlocksPerFunction: 1000,
      maxWorklistIterations: 10000,
      maxCallSummaryDepth: 6,
      maxIntraproceduralChainDepth: 32,
      maxAnalyzedFunctionsPerRequest: 500,
      maxAnalysisTimeMsPerFunction: 2000,
      maxAnalysisTimeMsPerRequest: 30000,
      maxArtifactBytes: 5 * 1024 * 1024,
    });
    assert.equal(result.valid, true);
  });
});
