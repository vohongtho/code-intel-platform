import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Node as TSNode } from 'web-tree-sitter';
import { Language } from '../../../../src/shared/languages.js';
import { getLanguage, parseSource } from '../../../../src/parsing/parser-manager.js';
import { lowerFunctionToIr } from '../../../../src/program-analysis/languages/generic-lowering.js';
import { getLoweringTable } from '../../../../src/program-analysis/languages/lowering-tables.js';
import { validateFunctionIr } from '../../../../src/program-analysis/ir/validate.js';
import type { FunctionIr, IrStatement } from '../../../../src/program-analysis/ir/contracts.js';

function findFirstOfType(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findFirstOfType(child, type);
    if (found) return found;
  }
  return null;
}

async function lowerSnippet(language: Language, source: string, functionId = 'sym:v2:function:test'): Promise<FunctionIr> {
  const available = await getLanguage(language);
  assert.ok(available, `grammar unavailable for ${language} in this environment`);
  const tree = await parseSource(language, source);
  assert.ok(tree, `parse failed for ${language}`);
  const table = getLoweringTable(language);
  assert.ok(table, `no lowering table for ${language}`);
  const bodyType = table!.blockTypes[0]!;
  const bodyNode = findFirstOfType(tree!.rootNode as unknown as TSNode, bodyType);
  assert.ok(bodyNode, `could not locate a ${bodyType} node for ${language}`);
  return lowerFunctionToIr({
    bodyNode: bodyNode!,
    language,
    functionId,
    filePath: '/src/sample',
  });
}

function kindsOf(ir: FunctionIr): string[] {
  return ir.order.map((id) => ir.statements[id]!.kind);
}

function countUnknown(ir: FunctionIr): number {
  return Object.values(ir.statements).filter((s: IrStatement) => s.kind === 'unknown').length;
}

const REPRESENTATIVE_SAMPLES: Array<{ language: Language; source: string; expectKinds: string[] }> = [
  {
    language: Language.TypeScript,
    source: `
function foo(a, b) {
  let x = 1;
  if (a > 0) {
    x = a + b;
  } else {
    throw new Error("bad");
  }
  for (let i = 0; i < 10; i++) {
    if (i === 5) break;
    console.log(i);
  }
  return x;
}
`,
    expectKinds: ['declaration', 'conditional', 'loop', 'return'],
  },
  {
    language: Language.Python,
    source: `
def foo(a, b):
    x = 1
    if a > 0:
        x = a + b
    else:
        raise Exception("bad")
    for i in range(10):
        if i == 5:
            break
        print(i)
    return x
`,
    expectKinds: ['call', 'conditional', 'loop', 'return'],
  },
  {
    language: Language.Go,
    source: `
package main
func foo(a int, b int) int {
    x := 1
    if a > 0 {
        x = a + b
    } else {
        panic("bad")
    }
    for i := 0; i < 10; i++ {
        if i == 5 { break }
        fmt.Println(i)
    }
    return x
}
`,
    expectKinds: ['declaration', 'conditional', 'loop', 'return'],
  },
  {
    language: Language.Java,
    source: `
class Foo {
  int foo(int a, int b) {
    int x = 1;
    if (a > 0) {
      x = a + b;
    } else {
      throw new RuntimeException("bad");
    }
    for (int i = 0; i < 10; i++) {
      if (i == 5) break;
      System.out.println(i);
    }
    return x;
  }
}
`,
    expectKinds: ['declaration', 'conditional', 'loop', 'return'],
  },
  {
    language: Language.Rust,
    source: `
fn foo(a: i32, b: i32) -> i32 {
    let mut x = 1;
    if a > 0 {
        x = a + b;
    } else {
        panic!("bad");
    }
    for i in 0..10 {
        if i == 5 { break; }
        println!("{}", i);
    }
    x
}
`,
    expectKinds: ['declaration', 'conditional', 'loop'],
  },
  {
    language: Language.Ruby,
    source: `
def foo(a, b)
  x = 1
  if a > 0
    x = a + b
  else
    raise "bad"
  end
  while x > 0
    x -= 1
  end
  x
end
`,
    expectKinds: ['assignment', 'conditional', 'loop'],
  },
  {
    language: Language.C,
    source: `
int foo(int a, int b) {
    int x = 1;
    if (a > 0) {
        x = a + b;
    } else {
        return -1;
    }
    for (int i = 0; i < 10; i++) {
        if (i == 5) break;
        printf("%d", i);
    }
    return x;
}
`,
    expectKinds: ['declaration', 'conditional', 'loop', 'return'],
  },
  {
    language: Language.Cpp,
    source: `
int foo(int a, int b) {
    int x = 1;
    if (a > 0) {
        x = a + b;
    } else {
        throw std::runtime_error("bad");
    }
    for (int i = 0; i < 10; i++) {
        if (i == 5) break;
        std::cout << i;
    }
    return x;
}
`,
    expectKinds: ['declaration', 'conditional', 'loop', 'return'],
  },
  {
    language: Language.CSharp,
    source: `
class Foo {
  int Bar(int a, int b) {
    int x = 1;
    if (a > 0) {
      x = a + b;
    } else {
      throw new Exception("bad");
    }
    for (int i = 0; i < 10; i++) {
      if (i == 5) break;
      Console.WriteLine(i);
    }
    return x;
  }
}
`,
    expectKinds: ['declaration', 'conditional', 'loop', 'return'],
  },
  {
    language: Language.PHP,
    source: `
<?php
function foo($a, $b) {
    $x = 1;
    if ($a > 0) {
        $x = $a + $b;
    } else {
        throw new Exception("bad");
    }
    for ($i = 0; $i < 10; $i++) {
        if ($i == 5) break;
        echo $i;
    }
    return $x;
}
`,
    expectKinds: ['conditional', 'loop', 'return'],
  },
];

describe('lowerFunctionToIr (real tree-sitter parses)', () => {
  for (const sample of REPRESENTATIVE_SAMPLES) {
    it(`produces valid, recognizably-structured IR for ${sample.language}`, async () => {
      const ir = await lowerSnippet(sample.language, sample.source);
      const validation = validateFunctionIr(ir);
      assert.deepEqual(validation.errors, []);
      assert.equal(validation.valid, true);
      assert.equal(ir.truncated, false);
      assert.ok(ir.order.length > 0, 'expected at least one lowered statement');

      const kinds = kindsOf(ir);
      for (const expected of sample.expectKinds) {
        assert.ok(kinds.includes(expected), `expected a '${expected}' statement in ${sample.language}, got: ${kinds.join(', ')}`);
      }
    });
  }

  it('marks every genuinely unknown construct as uncertain (never a silent no-op)', async () => {
    const ir = await lowerSnippet(
      Language.TypeScript,
      `
function foo() {
  using x = getResource();
  return x;
}
`,
    );
    for (const statement of Object.values(ir.statements)) {
      if (statement.kind === 'unknown') {
        assert.equal(statement.uncertain, true);
        assert.ok(statement.uncertaintyReason, 'unknown statement must carry a reason');
      }
    }
    assert.equal(validateFunctionIr(ir).valid, true);
  });

  it('produces deterministic output across repeated lowerings of the same source', async () => {
    const source = `
function foo(a) {
  if (a) {
    return 1;
  }
  return 0;
}
`;
    const first = await lowerSnippet(Language.TypeScript, source);
    const second = await lowerSnippet(Language.TypeScript, source);
    assert.deepEqual(first.order, second.order);
    assert.deepEqual(first.statements, second.statements);
    assert.deepEqual(first.expressions, second.expressions);
  });

  it('marks the CFG-relevant break/loop/conditional nesting for a while loop', async () => {
    const ir = await lowerSnippet(
      Language.TypeScript,
      `
function foo(x) {
  while (x > 0) {
    if (x === 5) {
      break;
    }
    x = x - 1;
  }
}
`,
    );
    const loopStatement = Object.values(ir.statements).find((s) => s.kind === 'loop');
    assert.ok(loopStatement, 'expected a loop statement');
    const nestedKinds = loopStatement!.children.map((id) => ir.statements[id]!.kind);
    assert.deepEqual(nestedKinds, ['conditional', 'assignment']);
    const conditional = ir.statements[loopStatement!.children[0]!]!;
    assert.deepEqual(conditional.children.map((id) => ir.statements[id]!.kind), ['break']);
  });

  it('returns a truncated empty IR for a language without a lowering table (HTML)', async () => {
    const tree = await parseSource(Language.TypeScript, 'function foo() { return 1; }');
    assert.ok(tree);
    const ir = lowerFunctionToIr({
      bodyNode: tree!.rootNode as unknown as TSNode,
      language: Language.HTML,
      functionId: 'sym:v2:function:html',
      filePath: '/src/sample.html',
    });
    assert.equal(ir.truncated, true);
    assert.ok(ir.reason?.includes('no program-analysis lowering table'));
    assert.equal(ir.entryStatementId, null);
    assert.deepEqual(ir.order, []);
    assert.equal(validateFunctionIr(ir).valid, true);
  });

  it('discriminates then-branch from else-branch statements in a conditional (the branch-topology fix)', async () => {
    const ir = await lowerSnippet(
      Language.TypeScript,
      `
function foo(a, b) {
  if (a > 0) {
    thenOnly();
  } else {
    elseOnly();
  }
}
`,
    );
    const conditional = Object.values(ir.statements).find((s) => s.kind === 'conditional')!;
    assert.equal(conditional.branches?.kind, 'conditional');
    const branches = conditional.branches as Extract<typeof conditional.branches, { kind: 'conditional' }>;
    assert.equal(branches.then.length, 1);
    assert.equal(branches.else?.length, 1);
    const thenCall = ir.statements[branches.then[0]!]!;
    const elseCall = ir.statements[branches.else![0]!]!;
    assert.equal(ir.expressions[thenCall.expressions[0]!]!.name, 'thenOnly()');
    assert.equal(ir.expressions[elseCall.expressions[0]!]!.name, 'elseOnly()');
    // children stays the flattened union, for consumers that don't care about topology.
    assert.deepEqual(new Set(conditional.children), new Set([...branches.then, ...(branches.else ?? [])]));
  });

  it('handles an else-if chain as nested conditional branches, not a flat sibling list', async () => {
    const ir = await lowerSnippet(
      Language.TypeScript,
      `
function foo(a, b) {
  if (a === 1) {
    one();
  } else if (a === 2) {
    two();
  } else {
    three();
  }
}
`,
    );
    // ir.statements insertion order is post-order (children land before their parent), so the
    // first 'conditional' in Object.values would actually be the innermost else-if — use
    // entryStatementId (the first *top-level* statement) to reliably get the outer one instead.
    const outer = ir.statements[ir.entryStatementId!]!;
    assert.equal(outer.kind, 'conditional');
    const outerBranches = outer.branches as Extract<typeof outer.branches, { kind: 'conditional' }>;
    assert.equal(outerBranches.then.length, 1);
    assert.equal(ir.expressions[ir.statements[outerBranches.then[0]!]!.expressions[0]!]!.name, 'one()');
    assert.equal(outerBranches.else?.length, 1);
    const inner = ir.statements[outerBranches.else![0]!]!;
    assert.equal(inner.kind, 'conditional');
    const innerBranches = inner.branches as Extract<typeof inner.branches, { kind: 'conditional' }>;
    assert.equal(ir.expressions[ir.statements[innerBranches.then[0]!]!.expressions[0]!]!.name, 'two()');
    assert.equal(ir.expressions[ir.statements[innerBranches.else![0]!]!.expressions[0]!]!.name, 'three()');
  });

  it('groups switch cases separately instead of flattening them into one chain', async () => {
    const ir = await lowerSnippet(
      Language.TypeScript,
      `
function foo(a) {
  switch (a) {
    case 1:
      one();
      break;
    case 2:
      two();
      break;
    default:
      fallback();
  }
}
`,
    );
    const switchStatement = Object.values(ir.statements).find((s) => s.kind === 'switch')!;
    const branches = switchStatement.branches as Extract<typeof switchStatement.branches, { kind: 'switch' }>;
    assert.equal(branches.cases.length, 3);
    assert.equal(branches.cases.filter((c) => c.isDefault).length, 1);
    const callNames = branches.cases.map((group) =>
      group.body
        .map((id) => ir.statements[id]!)
        .filter((s) => s.kind === 'call')
        .map((s) => ir.expressions[s.expressions[0]!]!.name),
    );
    assert.deepEqual(callNames, [['one()'], ['two()'], ['fallback()']]);
  });

  it('separates try body, catch, and finally into distinct branch groups', async () => {
    const ir = await lowerSnippet(
      Language.TypeScript,
      `
function foo() {
  try {
    risky();
  } catch (e) {
    handle();
  } finally {
    cleanup();
  }
}
`,
    );
    const tryStatement = Object.values(ir.statements).find((s) => s.kind === 'try')!;
    const branches = tryStatement.branches as Extract<typeof tryStatement.branches, { kind: 'try' }>;
    const nameOf = (id: string) => {
      const stmt = ir.statements[id]!;
      return ir.expressions[stmt.expressions[0]!]!.name;
    };
    assert.deepEqual(branches.body.map(nameOf), ['risky()']);
    assert.equal(branches.catches.length, 1);
    assert.deepEqual(branches.catches[0]!.body.map(nameOf), ['handle()']);
    assert.deepEqual(branches.finallyBody?.map(nameOf), ['cleanup()']);
  });

  it('sets entryStatementId to the first top-level statement even when it is a container with nested children', async () => {
    const ir = await lowerSnippet(
      Language.TypeScript,
      `
function foo(a) {
  if (a) {
    nested();
  }
  return a;
}
`,
    );
    assert.equal(ir.entryStatementId, ir.statements[ir.entryStatementId!]!.id);
    assert.equal(ir.statements[ir.entryStatementId!]!.kind, 'conditional');
  });

  it('records the declared/assigned name as a write target for declaration and assignment statements', async () => {
    const ir = await lowerSnippet(
      Language.TypeScript,
      `
function foo(a) {
  let x = 1;
  x = a + 1;
}
`,
    );
    const declaration = Object.values(ir.statements).find((s) => s.kind === 'declaration')!;
    const assignment = Object.values(ir.statements).find((s) => s.kind === 'assignment')!;
    assert.equal(declaration.targets.length, 1);
    assert.equal(ir.expressions[declaration.targets[0]!]!.name, 'x');
    assert.equal(assignment.targets.length, 1);
    assert.equal(ir.expressions[assignment.targets[0]!]!.name, 'x');
    assert.equal(ir.expressions[assignment.targets[0]!]!.kind, 'local-read');
  });

  it('lowers a name matching a supplied parameter as parameter-read instead of local-read', async () => {
    const available = await getLanguage(Language.TypeScript);
    assert.ok(available);
    const tree = await parseSource(Language.TypeScript, 'function foo(a, b) { let x = a; return b; }');
    assert.ok(tree);
    const table = getLoweringTable(Language.TypeScript)!;
    const bodyNode = findFirstOfType(tree!.rootNode as unknown as TSNode, table.blockTypes[0]!)!;
    const ir = lowerFunctionToIr({
      bodyNode,
      language: Language.TypeScript,
      functionId: 'sym:v2:function:test',
      filePath: '/src/sample',
      parameterNames: ['a', 'b'],
    });
    const returnStmt = Object.values(ir.statements).find((s) => s.kind === 'return')!;
    const returnedExpr = ir.expressions[returnStmt.expressions[0]!]!;
    assert.equal(returnedExpr.name, 'b');
    assert.equal(returnedExpr.kind, 'parameter-read');
  });

  it('captures bare-identifier call arguments as additional expressions beyond the primary call node', async () => {
    const ir = await lowerSnippet(Language.TypeScript, 'function foo(x, y) { consume(x, y); }');
    const callStmt = Object.values(ir.statements).find((s) => s.kind === 'call')!;
    assert.equal(ir.expressions[callStmt.expressions[0]!]!.kind, 'call');
    // Includes the bare callee identifier too (harmless over-capture) alongside the arguments.
    const argNames = callStmt.expressions.slice(1).map((id) => ir.expressions[id]!.name);
    assert.deepEqual(argNames.sort(), ['consume', 'x', 'y']);
  });

  it('truncates instead of hanging when the statement budget is exceeded', async () => {
    const manyStatements = Array.from({ length: 20 }, (_, i) => `x${i} = ${i};`).join('\n');
    const source = `function foo() {\n${manyStatements}\n}`;
    const available = await getLanguage(Language.TypeScript);
    assert.ok(available);
    const tree = await parseSource(Language.TypeScript, source);
    const table = getLoweringTable(Language.TypeScript)!;
    const bodyNode = findFirstOfType(tree!.rootNode as unknown as TSNode, table.blockTypes[0]!)!;
    const ir = lowerFunctionToIr({
      bodyNode,
      language: Language.TypeScript,
      functionId: 'sym:v2:function:budget',
      filePath: '/src/sample',
      limits: {
        maxStatementsPerFunction: 5,
        maxBlocksPerFunction: 1000,
        maxWorklistIterations: 10000,
        maxCallSummaryDepth: 6,
        maxIntraproceduralChainDepth: 32,
        maxAnalyzedFunctionsPerRequest: 500,
        maxAnalysisTimeMsPerFunction: 60000,
        maxAnalysisTimeMsPerRequest: 60000,
        maxArtifactBytes: 1024 * 1024,
      },
    });
    assert.equal(ir.truncated, true);
    assert.ok(ir.reason?.includes('maxStatementsPerFunction'));
    assert.equal(ir.order.length, 5);
    assert.equal(validateFunctionIr(ir, {
      maxStatementsPerFunction: 5,
      maxBlocksPerFunction: 1000,
      maxWorklistIterations: 10000,
      maxCallSummaryDepth: 6,
        maxIntraproceduralChainDepth: 32,
      maxAnalyzedFunctionsPerRequest: 500,
      maxAnalysisTimeMsPerFunction: 60000,
      maxAnalysisTimeMsPerRequest: 60000,
      maxArtifactBytes: 1024 * 1024,
    }).valid, true);
  });
});
