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
import { computeTaintFindings } from '../../../../src/program-analysis/taint/build.js';
import type { TaintRuleSet } from '../../../../src/program-analysis/taint/contracts.js';

function findFirstOfType(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findFirstOfType(child, type);
    if (found) return found;
  }
  return null;
}

const RULE_SET: TaintRuleSet = {
  version: 'test-rules-v1',
  sources: [{ id: 'user-input', textPattern: 'getUserInput(' }],
  sinks: [{ id: 'sql', textPattern: 'execSql(' }],
  sanitizers: [{ id: 'sanitize', textPattern: 'sanitize(' }],
};

async function analyzeTaintForSnippet(source: string) {
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
  const reachingDefinitions = computeReachingDefinitions(ir, cfg);
  const defUse = computeDefUseChains(ir, cfg, reachingDefinitions);
  return computeTaintFindings({ ir, cfg, reachingDefinitions, defUse, ruleSet: RULE_SET });
}

describe('computeTaintFindings (real lowered IR/CFG/dataflow)', () => {
  it('finds a direct source-to-sink path through a call argument', async () => {
    const result = await analyzeTaintForSnippet(`
function foo() {
  var x;
  x = getUserInput();
  execSql(x);
}
`);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.sourceMatcherId, 'user-input');
    assert.equal(result.findings[0]!.sinkMatcherId, 'sql');
    assert.equal(result.findings[0]!.variableName, 'x');
    assert.equal(result.findings[0]!.certainty, 'heuristic');
  });

  it('finds no path when the sink argument was never tainted', async () => {
    const result = await analyzeTaintForSnippet(`
function foo() {
  var x;
  x = 1;
  execSql(x);
}
`);
    assert.deepEqual(result.findings, []);
  });

  it('traces taint through a chain of name-to-name assignments', async () => {
    const result = await analyzeTaintForSnippet(`
function foo() {
  var x, y;
  x = getUserInput();
  y = x;
  execSql(y);
}
`);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.variableName, 'y');
    assert.ok(result.findings[0]!.propagationStatementIds.length >= 2);
  });

  it('does not report a finding once the value has been sanitized', async () => {
    const result = await analyzeTaintForSnippet(`
function foo() {
  var x;
  x = getUserInput();
  x = sanitize(x);
  execSql(x);
}
`);
    assert.deepEqual(result.findings, []);
  });

  it('reports sibling-branch sanitizer evidence alongside a genuine finding at a merge point', async () => {
    const result = await analyzeTaintForSnippet(`
function foo(cond) {
  var x;
  x = getUserInput();
  if (cond) {
    x = sanitize(x);
  }
  execSql(x);
}
`);
    assert.equal(result.findings.length, 1);
    const sanitizerStmt = result.findings[0]!.sanitizedByStatementIds;
    assert.equal(sanitizerStmt.length, 1);
  });

  it('does not flag an unrelated variable passed to the same sink call', async () => {
    const result = await analyzeTaintForSnippet(`
function foo() {
  var x, y;
  x = getUserInput();
  y = 1;
  execSql(y);
}
`);
    assert.deepEqual(result.findings, []);
  });

  it('is deterministic across repeated runs', async () => {
    const source = `
function foo() {
  var x;
  x = getUserInput();
  execSql(x);
}
`;
    const a = await analyzeTaintForSnippet(source);
    const b = await analyzeTaintForSnippet(source);
    assert.deepEqual(a, b);
  });
});
