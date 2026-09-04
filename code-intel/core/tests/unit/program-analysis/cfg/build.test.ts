import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Node as TSNode } from 'web-tree-sitter';
import { Language } from '../../../../src/shared/languages.js';
import { getLanguage, parseSource } from '../../../../src/parsing/parser-manager.js';
import { lowerFunctionToIr } from '../../../../src/program-analysis/languages/generic-lowering.js';
import { getLoweringTable } from '../../../../src/program-analysis/languages/lowering-tables.js';
import { buildFunctionCfg } from '../../../../src/program-analysis/cfg/build.js';
import { validateFunctionCfg } from '../../../../src/program-analysis/cfg/validate.js';
import type { FunctionCfg } from '../../../../src/program-analysis/cfg/contracts.js';

function findFirstOfType(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findFirstOfType(child, type);
    if (found) return found;
  }
  return null;
}

async function buildCfgForSnippet(source: string, language: Language = Language.TypeScript): Promise<FunctionCfg> {
  const available = await getLanguage(language);
  assert.ok(available, `grammar unavailable for ${language}`);
  const tree = await parseSource(language, source);
  assert.ok(tree);
  const table = getLoweringTable(language)!;
  const bodyNode = findFirstOfType(tree!.rootNode as unknown as TSNode, table.blockTypes[0]!);
  assert.ok(bodyNode);
  const ir = lowerFunctionToIr({ bodyNode: bodyNode!, language, functionId: 'sym:v2:function:test', filePath: '/src/sample' });
  return buildFunctionCfg(ir);
}

function edgeKinds(cfg: FunctionCfg, blockId: string): string[] {
  return cfg.blocks[blockId]!.successors.map((e) => e.kind).sort();
}

describe('buildFunctionCfg', () => {
  it('produces a valid single straight-line block chain from entry to exit', async () => {
    const cfg = await buildCfgForSnippet(`
function foo(a) {
  const x = a;
  bar(x);
  return x;
}
`);
    const validation = validateFunctionCfg(cfg);
    assert.deepEqual(validation.errors, []);
    assert.equal(validation.valid, true);
    assert.equal(cfg.truncated, false);
    assert.notEqual(cfg.entryBlockId, cfg.exitBlockId);
    assert.equal(cfg.blocks[cfg.exitBlockId]!.successors.length, 0);
    assert.equal(cfg.blocks[cfg.entryBlockId]!.predecessors.length, 0);
  });

  it('branches true/false to a join block for if/else, both sides falling through', async () => {
    const cfg = await buildCfgForSnippet(`
function foo(a) {
  if (a) {
    doThen();
  } else {
    doElse();
  }
  after();
}
`);
    assert.equal(validateFunctionCfg(cfg).valid, true);
    assert.equal(cfg.truncated, false);

    const condBlock = Object.values(cfg.blocks).find((b) => b.successors.some((e) => e.kind === 'true'))!;
    assert.deepEqual(edgeKinds(cfg, condBlock.id), ['false', 'true']);

    const trueTarget = condBlock.successors.find((e) => e.kind === 'true')!.targetBlockId;
    const falseTarget = condBlock.successors.find((e) => e.kind === 'false')!.targetBlockId;
    assert.notEqual(trueTarget, falseTarget);

    // Both then/else blocks fall through to the same join block.
    const trueNext = cfg.blocks[trueTarget]!.successors[0]!.targetBlockId;
    const falseNext = cfg.blocks[falseTarget]!.successors[0]!.targetBlockId;
    assert.equal(trueNext, falseNext);

    // The join block eventually reaches exit.
    assert.ok(cfg.blocks[trueNext]!.successors.some((e) => e.targetBlockId === cfg.exitBlockId));
  });

  it('falls through directly on a false condition when there is no else branch', async () => {
    const cfg = await buildCfgForSnippet(`
function foo(a) {
  if (a) {
    doThen();
  }
  after();
}
`);
    assert.equal(validateFunctionCfg(cfg).valid, true);
    const condBlock = Object.values(cfg.blocks).find((b) => b.successors.some((e) => e.kind === 'true'))!;
    assert.deepEqual(edgeKinds(cfg, condBlock.id), ['false', 'true']);
    // The 'false' edge leaves the SAME block (no else block was created).
    const falseEdge = condBlock.successors.find((e) => e.kind === 'false')!;
    assert.notEqual(falseEdge.targetBlockId, condBlock.id);
  });

  it('has no fallthrough after a conditional whose branches both terminate', async () => {
    const cfg = await buildCfgForSnippet(`
function foo(a) {
  if (a) {
    return 1;
  } else {
    return 2;
  }
}
`);
    assert.equal(validateFunctionCfg(cfg).valid, true);
    const condBlock = Object.values(cfg.blocks).find((b) => b.successors.some((e) => e.kind === 'true'))!;
    const trueTarget = condBlock.successors.find((e) => e.kind === 'true')!.targetBlockId;
    const falseTarget = condBlock.successors.find((e) => e.kind === 'false')!.targetBlockId;
    assert.deepEqual(edgeKinds(cfg, trueTarget), ['return']);
    assert.deepEqual(edgeKinds(cfg, falseTarget), ['return']);
    assert.ok(cfg.blocks[trueTarget]!.successors.every((e) => e.targetBlockId === cfg.exitBlockId));
  });

  it('wires break to the loop exit and continue to the loop header, and marks the CFG truncated (loop clauses unmodeled)', async () => {
    const cfg = await buildCfgForSnippet(`
function foo(x) {
  while (x > 0) {
    if (x === 5) {
      break;
    }
    if (x === 3) {
      continue;
    }
    x = x - 1;
  }
  after();
}
`);
    assert.equal(validateFunctionCfg(cfg).valid, true);
    assert.equal(cfg.truncated, true);
    assert.ok(cfg.reason?.includes('loop init/condition/update'));

    const headerBlock = Object.values(cfg.blocks).find((b) => b.successors.some((e) => e.kind === 'loop-entry'))!;
    const loopExitId = headerBlock.successors.find((e) => e.kind === 'loop-exit')!.targetBlockId;
    const breakEdgeTarget = Object.values(cfg.blocks)
      .flatMap((b) => b.successors)
      .find((e) => e.kind === 'break')!.targetBlockId;
    const continueEdgeTarget = Object.values(cfg.blocks)
      .flatMap((b) => b.successors)
      .find((e) => e.kind === 'continue')!.targetBlockId;
    assert.equal(breakEdgeTarget, loopExitId);
    assert.equal(continueEdgeTarget, headerBlock.id);
  });

  it('gives each switch case its own entry via a `case` edge and joins non-default cases at one block', async () => {
    const cfg = await buildCfgForSnippet(`
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
  after();
}
`);
    assert.equal(validateFunctionCfg(cfg).valid, true);
    const headerBlock = Object.values(cfg.blocks).find((b) => b.successors.filter((e) => e.kind === 'case').length === 3)!;
    assert.equal(headerBlock.successors.length, 3);
    assert.ok(headerBlock.successors.every((e) => e.kind === 'case'));
    const caseTargets = new Set(headerBlock.successors.map((e) => e.targetBlockId));
    assert.equal(caseTargets.size, 3);
  });

  it('routes the try body normal exit and each catch normal exit into the same finally block, and marks the CFG truncated', async () => {
    const cfg = await buildCfgForSnippet(`
function foo() {
  try {
    risky();
  } catch (e) {
    handle();
  } finally {
    cleanup();
  }
  after();
}
`);
    assert.equal(validateFunctionCfg(cfg).valid, true);
    assert.equal(cfg.truncated, true);
    assert.ok(cfg.reason?.includes('finally'));

    // The try body's own first block carries both the 'exceptional' edge (to the catch) and,
    // since it falls through normally, the 'finally' edge -- same for the catch body's block.
    const bodyEntry = Object.values(cfg.blocks).find((b) => b.successors.some((e) => e.kind === 'exceptional'))!;
    const catchEntry = cfg.blocks[bodyEntry.successors.find((e) => e.kind === 'exceptional')!.targetBlockId]!;
    const bodyFinallyTarget = bodyEntry.successors.find((e) => e.kind === 'finally')!.targetBlockId;
    const catchFinallyTarget = catchEntry.successors.find((e) => e.kind === 'finally')!.targetBlockId;
    assert.equal(bodyFinallyTarget, catchFinallyTarget);
  });

  it('marks the CFG truncated when a goto is present', async () => {
    const cfg = await buildCfgForSnippet(
      `
int foo(int a) {
    if (a > 0) {
        goto end;
    }
    end:
    return a;
}
`,
      Language.C,
    );
    assert.equal(validateFunctionCfg(cfg).valid, true);
    assert.equal(cfg.truncated, true);
    assert.ok(cfg.reason?.includes('goto'));
  });

  it('produces a trivially valid CFG for an empty function body', async () => {
    const cfg = await buildCfgForSnippet(`function foo() {}`);
    assert.equal(validateFunctionCfg(cfg).valid, true);
    assert.notEqual(cfg.entryBlockId, cfg.exitBlockId);
  });

  it('is deterministic across repeated builds of the same IR', async () => {
    const source = `
function foo(a) {
  if (a) {
    doThen();
  } else {
    doElse();
  }
}
`;
    const cfgA = await buildCfgForSnippet(source);
    const cfgB = await buildCfgForSnippet(source);
    assert.deepEqual(cfgA, cfgB);
  });
});
