import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Node as TSNode } from 'web-tree-sitter';
import { Language } from '../../../../src/shared/languages.js';
import { getLanguage, parseSource } from '../../../../src/parsing/parser-manager.js';
import { lowerFunctionToIr } from '../../../../src/program-analysis/languages/generic-lowering.js';
import { getLoweringTable } from '../../../../src/program-analysis/languages/lowering-tables.js';
import { buildFunctionCfg } from '../../../../src/program-analysis/cfg/build.js';
import { computeControlDependence } from '../../../../src/program-analysis/cfg/control-dependence.js';
import { computeReachingDefinitions } from '../../../../src/program-analysis/dataflow/reaching-definitions.js';
import { computeDefUseChains } from '../../../../src/program-analysis/dataflow/def-use.js';
import { buildProgramDependenceGraph } from '../../../../src/program-analysis/pdg/build.js';
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

async function buildPdgForSnippet(source: string, parameterNames: readonly string[] = []) {
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
  const controlDependence = computeControlDependence(cfg);
  const reachingDefinitions = computeReachingDefinitions(ir, cfg);
  const defUse = computeDefUseChains(ir, cfg, reachingDefinitions);
  const pdg = buildProgramDependenceGraph({ ir, cfg, controlDependence, reachingDefinitions, defUse });
  return { ir, pdg };
}

describe('buildProgramDependenceGraph (real lowered IR/CFG/dataflow)', () => {
  it('lists every statement id as a node, even ones with no edges', async () => {
    const { ir, pdg } = await buildPdgForSnippet('function foo() { doThing(); }');
    assert.deepEqual(pdg.statementIds, Object.keys(ir.statements).sort((a, b) => a.localeCompare(b)));
  });

  it('adds a control edge from the conditional statement to each statement in its then-branch', async () => {
    const { ir, pdg } = await buildPdgForSnippet(`
function foo(a) {
  if (a) {
    inThen();
  }
}
`);
    const conditional = Object.values(ir.statements).find((s) => s.kind === 'conditional')!;
    const inThen = Object.values(ir.statements).find((s) => s.kind === 'call')!;
    assert.ok(
      pdg.edges.some((e) => e.kind === 'control' && e.fromStatementId === conditional.id && e.toStatementId === inThen.id),
    );
  });

  it('adds a data edge from a definition to each of its structurally-resolved uses', async () => {
    const { ir, pdg } = await buildPdgForSnippet(`
function foo() {
  let x = 1;
  let y;
  y = x;
  return y;
}
`);
    const xDecl = Object.values(ir.statements).find((s) => s.kind === 'declaration')!.id;
    const yAssign = Object.values(ir.statements).find((s) => s.kind === 'assignment')!.id;
    const returnStmt = Object.values(ir.statements).find((s) => s.kind === 'return')!.id;
    assert.ok(pdg.edges.some((e) => e.kind === 'data' && e.fromStatementId === xDecl && e.toStatementId === yAssign));
    assert.ok(pdg.edges.some((e) => e.kind === 'data' && e.fromStatementId === yAssign && e.toStatementId === returnStmt));
  });

  it('does not add a control edge for statements outside any conditional/loop/switch', async () => {
    const { pdg } = await buildPdgForSnippet('function foo() { a(); b(); c(); }');
    assert.equal(pdg.edges.filter((e) => e.kind === 'control').length, 0);
  });

  it('is deterministic (edges sorted, no duplicates) across repeated builds', async () => {
    const source = `
function foo(a) {
  let x = 1;
  if (a) {
    x = 2;
  }
  return x;
}
`;
    const a = await buildPdgForSnippet(source);
    const b = await buildPdgForSnippet(source);
    assert.deepEqual(a.pdg, b.pdg);
    const keys = a.pdg.edges.map((e) => `${e.kind}|${e.fromStatementId}|${e.toStatementId}`);
    assert.deepEqual(keys, [...new Set(keys)].sort((x, y) => x.localeCompare(y)));
  });
});
