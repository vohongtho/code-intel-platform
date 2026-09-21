import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Node as TSNode } from 'web-tree-sitter';
import { Language } from '../../../../src/shared/languages.js';
import { getLanguage, parseSource } from '../../../../src/parsing/parser-manager.js';
import { lowerFunctionToIr } from '../../../../src/program-analysis/languages/generic-lowering.js';
import { getLoweringTable } from '../../../../src/program-analysis/languages/lowering-tables.js';
import { buildFunctionCfg } from '../../../../src/program-analysis/cfg/build.js';
import { computeReachingDefinitions } from '../../../../src/program-analysis/dataflow/reaching-definitions.js';
import { computeDefUseChains } from '../../../../src/program-analysis/dataflow/def-use.js';
import type { FunctionIr } from '../../../../src/program-analysis/ir/contracts.js';
import type { FunctionCfg } from '../../../../src/program-analysis/cfg/contracts.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS } from '../../../../src/program-analysis/limits.js';

function findFirstOfType(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findFirstOfType(child, type);
    if (found) return found;
  }
  return null;
}

async function analyzeSnippet(source: string): Promise<{ ir: FunctionIr; cfg: FunctionCfg }> {
  const language = Language.TypeScript;
  const available = await getLanguage(language);
  assert.ok(available);
  const tree = await parseSource(language, source);
  assert.ok(tree);
  const table = getLoweringTable(language)!;
  const bodyNode = findFirstOfType(tree!.rootNode as unknown as TSNode, table.blockTypes[0]!);
  assert.ok(bodyNode);
  const ir = lowerFunctionToIr({ bodyNode: bodyNode!, language, functionId: 'sym:v2:function:test', filePath: '/src/sample' });
  const cfg = buildFunctionCfg(ir);
  return { ir, cfg };
}

function findStatementByTargetName(ir: FunctionIr, name: string): string {
  for (const statement of Object.values(ir.statements)) {
    const targetId = statement.targets[0];
    if (targetId && ir.expressions[targetId]?.name === name) return statement.id;
  }
  throw new Error(`no statement found defining ${name}`);
}

function findStatementByExpressionName(ir: FunctionIr, name: string): string {
  for (const statement of Object.values(ir.statements)) {
    const exprId = statement.expressions[0];
    if (exprId && ir.expressions[exprId]?.name === name) return statement.id;
  }
  throw new Error(`no statement found using ${name}`);
}

describe('computeReachingDefinitions + computeDefUseChains (real lowered IR/CFG)', () => {
  it('chains a simple straight-line def to its use', async () => {
    const { ir, cfg } = await analyzeSnippet(`
function foo() {
  let x = 1;
  let y;
  y = x;
  return y;
}
`);
    const reaching = computeReachingDefinitions(ir, cfg);
    assert.equal(reaching.truncated, false);
    const defUse = computeDefUseChains(ir, cfg, reaching);

    const xDefStmt = findStatementByTargetName(ir, 'x');
    const yDefStmt = Object.values(ir.statements).find((s) => s.kind === 'assignment')!.id; // `y = x` -- uses x, defines y
    const returnStmt = findStatementByExpressionName(ir, 'y');

    assert.deepEqual(defUse.reachingDefinitionsForUse[yDefStmt], [`${xDefStmt}:def`]);
    assert.deepEqual(defUse.reachingDefinitionsForUse[returnStmt], [`${yDefStmt}:def`]);
    assert.deepEqual(defUse.usesOfDefinition[`${xDefStmt}:def`], [yDefStmt]);
    assert.deepEqual(defUse.usesOfDefinition[`${yDefStmt}:def`], [returnStmt]);
  });

  it('flags a declaration with an initializer as unresolved (the initializer expression is not captured by the shallow IR)', async () => {
    const { ir, cfg } = await analyzeSnippet(`
function foo() {
  let x = 1;
  let y = x;
  return y;
}
`);
    const reaching = computeReachingDefinitions(ir, cfg);
    const defUse = computeDefUseChains(ir, cfg, reaching);
    const yDeclStmt = findStatementByTargetName(ir, 'y');
    assert.ok(defUse.unresolvedUseStatementIds.includes(yDeclStmt));
    assert.equal(defUse.reachingDefinitionsForUse[yDeclStmt], undefined);
  });

  it('kills an earlier same-block definition of the same variable', async () => {
    const { ir, cfg } = await analyzeSnippet(`
function foo() {
  let x = 1;
  x = 2;
  return x;
}
`);
    const reaching = computeReachingDefinitions(ir, cfg);
    const defUse = computeDefUseChains(ir, cfg, reaching);
    const secondDefStmt = Object.values(ir.statements).find((s) => s.kind === 'assignment')!.id;
    const returnStmt = Object.values(ir.statements).find((s) => s.kind === 'return')!.id;
    assert.deepEqual(defUse.reachingDefinitionsForUse[returnStmt], [`${secondDefStmt}:def`]);
  });

  it('merges definitions from both branches of a diamond at the join use', async () => {
    const { ir, cfg } = await analyzeSnippet(`
function foo(a) {
  let x;
  if (a) {
    x = 1;
  } else {
    x = 2;
  }
  return x;
}
`);
    const reaching = computeReachingDefinitions(ir, cfg);
    const defUse = computeDefUseChains(ir, cfg, reaching);
    const assignments = Object.values(ir.statements).filter((s) => s.kind === 'assignment');
    assert.equal(assignments.length, 2);
    const returnStmt = Object.values(ir.statements).find((s) => s.kind === 'return')!.id;
    const reachingAtReturn = new Set(defUse.reachingDefinitionsForUse[returnStmt]);
    for (const assignment of assignments) assert.ok(reachingAtReturn.has(`${assignment.id}:def`));
    assert.equal(reachingAtReturn.size, 2);
  });

  it('treats a member-target write as a boundary definition that does not kill or reach a named local', async () => {
    const { ir, cfg } = await analyzeSnippet(`
function foo(obj) {
  let x = 1;
  obj.field = 2;
  return x;
}
`);
    const reaching = computeReachingDefinitions(ir, cfg);
    const boundaryDef = Object.values(reaching.definitions).find((d) => d.variableName === null);
    assert.ok(boundaryDef, 'expected a boundary definition for the member write');
    const defUse = computeDefUseChains(ir, cfg, reaching);
    const returnStmt = Object.values(ir.statements).find((s) => s.kind === 'return')!.id;
    const xDefStmt = findStatementByTargetName(ir, 'x');
    assert.deepEqual(defUse.reachingDefinitionsForUse[returnStmt], [`${xDefStmt}:def`]);
  });

  it('flags statements whose use is nested (call arguments, conditions) as unresolved rather than silently empty', async () => {
    const { ir, cfg } = await analyzeSnippet(`
function foo(x) {
  if (x) {
    consume(x);
  }
}
`);
    const reaching = computeReachingDefinitions(ir, cfg);
    const defUse = computeDefUseChains(ir, cfg, reaching);
    const conditional = Object.values(ir.statements).find((s) => s.kind === 'conditional')!;
    const callStmt = Object.values(ir.statements).find((s) => s.kind === 'call')!;
    assert.ok(defUse.unresolvedUseStatementIds.includes(conditional.id));
    assert.ok(defUse.unresolvedUseStatementIds.includes(callStmt.id));
  });

  it('marks the result truncated when the worklist iteration budget is exceeded', async () => {
    const { ir, cfg } = await analyzeSnippet(`
function foo(a) {
  let x = 1;
  if (a) {
    x = 2;
  }
  return x;
}
`);
    const reaching = computeReachingDefinitions(ir, cfg, { ...DEFAULT_PROGRAM_ANALYSIS_LIMITS, maxWorklistIterations: 0 });
    assert.equal(reaching.truncated, true);
    assert.ok(reaching.reason?.includes('maxWorklistIterations'));
  });

  it('is deterministic across repeated runs on the same IR/CFG', async () => {
    const { ir, cfg } = await analyzeSnippet(`
function foo(a) {
  let x = 1;
  if (a) {
    x = 2;
  } else {
    x = 3;
  }
  return x;
}
`);
    const first = computeDefUseChains(ir, cfg, computeReachingDefinitions(ir, cfg));
    const second = computeDefUseChains(ir, cfg, computeReachingDefinitions(ir, cfg));
    assert.deepEqual(first, second);
  });
});
