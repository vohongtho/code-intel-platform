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
import { buildFunctionSummary, generateFunctionSummaryArtifactId } from '../../../../src/program-analysis/summaries/build.js';
import { PROGRAM_ANALYSIS_VERSION, type ProgramAnalysisFingerprint } from '../../../../src/program-analysis/contracts.js';
import type { FunctionIr } from '../../../../src/program-analysis/ir/contracts.js';

function findFirstOfType(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findFirstOfType(child, type);
    if (found) return found;
  }
  return null;
}

const FINGERPRINT: ProgramAnalysisFingerprint = {
  programAnalysisVersion: PROGRAM_ANALYSIS_VERSION,
  languageLoweringVersion: 'typescript-lowering-v1',
  resolverVersion: 'evidence-based-v1',
};

async function summarizeSnippet(source: string, parameterNames: readonly string[] = []) {
  const language = Language.TypeScript;
  const available = await getLanguage(language);
  assert.ok(available);
  const tree = await parseSource(language, source);
  assert.ok(tree);
  const table = getLoweringTable(language)!;
  const bodyNode = findFirstOfType(tree!.rootNode as unknown as TSNode, table.blockTypes[0]!);
  assert.ok(bodyNode);
  const ir: FunctionIr = lowerFunctionToIr({
    bodyNode: bodyNode!,
    language,
    functionId: 'sym:v2:function:test',
    filePath: '/src/sample',
    parameterNames,
  });
  const cfg = buildFunctionCfg(ir);
  const reachingDefinitions = computeReachingDefinitions(ir, cfg);
  const defUse = computeDefUseChains(ir, cfg, reachingDefinitions);
  const summary = buildFunctionSummary({ ir, parameterNames, reachingDefinitions, defUse, bodyHash: 'hash-1', fingerprint: FINGERPRINT });
  return { ir, summary };
}

describe('buildFunctionSummary (real lowered IR/CFG/dataflow)', () => {
  it('marks direct parameter-to-return influence', async () => {
    const { ir, summary } = await summarizeSnippet('function foo(a) { return a; }', ['a']);
    const returnStmt = Object.values(ir.statements).find((s) => s.kind === 'return')!.id;
    const influence = summary.parameterInfluence.find((p) => p.parameterName === 'a')!;
    assert.deepEqual(influence.influencesReturnAtStatementIds, [returnStmt]);
  });

  it('traces parameter influence through a simple name-to-name assignment chain', async () => {
    const { ir, summary } = await summarizeSnippet(
      `
function foo(a) {
  let x;
  x = a;
  return x;
}
`,
      ['a'],
    );
    const returnStmt = Object.values(ir.statements).find((s) => s.kind === 'return')!.id;
    const influence = summary.parameterInfluence.find((p) => p.parameterName === 'a')!;
    assert.deepEqual(influence.influencesReturnAtStatementIds, [returnStmt]);
  });

  it('reports an empty (not missing) influence list for a parameter that never reaches a return', async () => {
    const { summary } = await summarizeSnippet('function foo(a, b) { return 1; }', ['a', 'b']);
    assert.deepEqual(
      summary.parameterInfluence.map((p) => p.parameterName).sort(),
      ['a', 'b'],
    );
    for (const influence of summary.parameterInfluence) assert.deepEqual(influence.influencesReturnAtStatementIds, []);
  });

  it('groups repeated calls to the same callee text and keeps distinct callees separate', async () => {
    const { summary } = await summarizeSnippet(`
function foo() {
  doThing();
  doThing();
  other();
}
`);
    const byCallee = new Map(summary.calledCallees.map((c) => [c.calleeText, c.statementIds.length]));
    assert.equal(byCallee.get('doThing()'), 2);
    assert.equal(byCallee.get('other()'), 1);
  });

  it('records local variable reads and writes', async () => {
    const { ir, summary } = await summarizeSnippet(`
function foo() {
  let x = 1;
  return x;
}
`);
    const declStmt = Object.values(ir.statements).find((s) => s.kind === 'declaration')!.id;
    const returnStmt = Object.values(ir.statements).find((s) => s.kind === 'return')!.id;
    const access = summary.localAccesses.find((a) => a.variableName === 'x')!;
    assert.deepEqual(access.writeAtStatementIds, [declStmt]);
    assert.deepEqual(access.readAtStatementIds, [returnStmt]);
  });

  it('lists member/index-target writes as boundary writes, not named-variable definitions', async () => {
    const { ir, summary } = await summarizeSnippet('function foo(obj) { obj.field = 1; }', ['obj']);
    const writeStmt = Object.values(ir.statements).find((s) => s.kind === 'assignment')!.id;
    assert.deepEqual(summary.boundaryWriteStatementIds, [writeStmt]);
    assert.equal(summary.localAccesses.some((a) => a.writeAtStatementIds.includes(writeStmt)), false);
  });

  it('propagates unresolved-use statement ids from def-use analysis', async () => {
    const { ir, summary } = await summarizeSnippet('function foo(x) { consume(x); }', ['x']);
    const callStmt = Object.values(ir.statements).find((s) => s.kind === 'call')!.id;
    assert.ok(summary.unresolvedUseStatementIds.includes(callStmt));
  });

  it('is deterministic across repeated builds', async () => {
    const a = await summarizeSnippet('function foo(a) { let x = a; return x; }', ['a']);
    const b = await summarizeSnippet('function foo(a) { let x = a; return x; }', ['a']);
    assert.deepEqual(a.summary, b.summary);
  });
});

describe('generateFunctionSummaryArtifactId', () => {
  it('is stable for identical inputs and changes when the body hash changes', () => {
    const idA = generateFunctionSummaryArtifactId('sym:v2:function:test', 'hash-1', FINGERPRINT);
    const idB = generateFunctionSummaryArtifactId('sym:v2:function:test', 'hash-1', FINGERPRINT);
    const idC = generateFunctionSummaryArtifactId('sym:v2:function:test', 'hash-2', FINGERPRINT);
    assert.equal(idA, idB);
    assert.notEqual(idA, idC);
  });
});
