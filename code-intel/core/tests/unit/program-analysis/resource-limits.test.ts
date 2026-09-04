/**
 * Dedicated proof, per the spec requirement "Resource limits MUST produce
 * truncated status... consumers MUST NOT treat it as complete": every
 * resource limit actually wired into program-analysis (task 1's
 * `ProgramAnalysisLimits`) produces `truncated: true` with a reason when
 * hit, on real lowered IR/CFG/dataflow — never a result that silently
 * looks complete.
 *
 * `maxAnalyzedFunctionsPerRequest` and `maxAnalysisTimeMsPerRequest` are
 * request/batch-level concepts with no batch runner in this foundation yet
 * (every entry point here analyzes one function) — they are reserved,
 * not exercised, and that's noted rather than silently skipped.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Node as TSNode } from 'web-tree-sitter';
import { Language } from '../../../src/shared/languages.js';
import { getLanguage, parseSource } from '../../../src/parsing/parser-manager.js';
import { lowerFunctionToIr } from '../../../src/program-analysis/languages/generic-lowering.js';
import { getLoweringTable } from '../../../src/program-analysis/languages/lowering-tables.js';
import { validateFunctionIr } from '../../../src/program-analysis/ir/validate.js';
import { buildFunctionCfg } from '../../../src/program-analysis/cfg/build.js';
import { validateFunctionCfg } from '../../../src/program-analysis/cfg/validate.js';
import { computeReachingDefinitions } from '../../../src/program-analysis/dataflow/reaching-definitions.js';
import { computeDefUseChains } from '../../../src/program-analysis/dataflow/def-use.js';
import { buildFunctionSummary } from '../../../src/program-analysis/summaries/build.js';
import { computeTaintFindings } from '../../../src/program-analysis/taint/build.js';
import type { TaintRuleSet } from '../../../src/program-analysis/taint/contracts.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS, type ProgramAnalysisLimits } from '../../../src/program-analysis/limits.js';
import { PROGRAM_ANALYSIS_VERSION, type ProgramAnalysisFingerprint } from '../../../src/program-analysis/contracts.js';

const FINGERPRINT: ProgramAnalysisFingerprint = {
  programAnalysisVersion: PROGRAM_ANALYSIS_VERSION,
  languageLoweringVersion: 'typescript-lowering-v1',
  resolverVersion: 'evidence-based-v1',
};

function findFirstOfType(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findFirstOfType(child, type);
    if (found) return found;
  }
  return null;
}

function withLimits(overrides: Partial<ProgramAnalysisLimits>): ProgramAnalysisLimits {
  return { ...DEFAULT_PROGRAM_ANALYSIS_LIMITS, ...overrides };
}

async function realBodyNode(source: string): Promise<TSNode> {
  const language = Language.TypeScript;
  const available = await getLanguage(language);
  assert.ok(available);
  const tree = await parseSource(language, source);
  assert.ok(tree);
  const table = getLoweringTable(language)!;
  const bodyNode = findFirstOfType(tree!.rootNode as unknown as TSNode, table.blockTypes[0]!);
  assert.ok(bodyNode);
  return bodyNode!;
}

const DIAMOND_SOURCE = `
function foo(a) {
  let x = 1;
  if (a) {
    x = 2;
  } else {
    x = 3;
  }
  return x;
}
`;

describe('resource limits: every wired budget truncates rather than silently completing', () => {
  it('maxStatementsPerFunction truncates language lowering', async () => {
    const bodyNode = await realBodyNode(`function foo() {\n${'x();\n'.repeat(20)}}`);
    const ir = lowerFunctionToIr({
      bodyNode,
      language: Language.TypeScript,
      functionId: 'sym:v2:function:test',
      filePath: '/src/sample',
      limits: withLimits({ maxStatementsPerFunction: 5 }),
    });
    assert.equal(ir.truncated, true);
    assert.ok(ir.reason?.includes('maxStatementsPerFunction'));
    assert.equal(validateFunctionIr(ir, withLimits({ maxStatementsPerFunction: 5 })).valid, true);
  });

  it('maxAnalysisTimeMsPerFunction truncates language lowering even when the statement budget is not exceeded', async () => {
    const bodyNode = await realBodyNode('function foo() {\nx();\n}');
    const ir = lowerFunctionToIr({
      bodyNode,
      language: Language.TypeScript,
      functionId: 'sym:v2:function:test',
      filePath: '/src/sample',
      limits: withLimits({ maxAnalysisTimeMsPerFunction: 0 }),
    });
    assert.equal(ir.truncated, true);
    assert.ok(ir.reason?.includes('maxAnalysisTimeMsPerFunction'));
  });

  it('maxBlocksPerFunction truncates CFG construction', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `if (a) { x${i}(); }`).join('\n');
    const bodyNode = await realBodyNode(`function foo(a) {\n${many}\n}`);
    const ir = lowerFunctionToIr({ bodyNode, language: Language.TypeScript, functionId: 'sym:v2:function:test', filePath: '/src/sample' });
    const limits = withLimits({ maxBlocksPerFunction: 3 });
    const cfg = buildFunctionCfg(ir, limits);
    assert.equal(cfg.truncated, true);
    assert.ok(cfg.reason?.includes('maxBlocksPerFunction'));
    // Even truncated, entry/exit and every recorded edge/predecessor stays internally consistent.
    assert.equal(validateFunctionCfg(cfg).valid, true);
    assert.ok(Object.keys(cfg.blocks).length <= limits.maxBlocksPerFunction + 1);
  });

  it('maxWorklistIterations truncates reaching-definitions', async () => {
    const bodyNode = await realBodyNode(DIAMOND_SOURCE);
    const ir = lowerFunctionToIr({ bodyNode, language: Language.TypeScript, functionId: 'sym:v2:function:test', filePath: '/src/sample' });
    const cfg = buildFunctionCfg(ir);
    const reaching = computeReachingDefinitions(ir, cfg, withLimits({ maxWorklistIterations: 0 }));
    assert.equal(reaching.truncated, true);
    assert.ok(reaching.reason?.includes('maxWorklistIterations'));
  });

  it('maxIntraproceduralChainDepth truncates function-summary parameter-influence tracing', async () => {
    const chain = Array.from({ length: 10 }, (_, i) => `y${i} = ${i === 0 ? 'a' : `y${i - 1}`};`).join('\n');
    const bodyNode = await realBodyNode(`function foo(a) {\nvar ${Array.from({ length: 10 }, (_, i) => `y${i}`).join(', ')};\n${chain}\nreturn y9;\n}`);
    const ir = lowerFunctionToIr({
      bodyNode,
      language: Language.TypeScript,
      functionId: 'sym:v2:function:test',
      filePath: '/src/sample',
      parameterNames: ['a'],
    });
    const cfg = buildFunctionCfg(ir);
    const reaching = computeReachingDefinitions(ir, cfg);
    const defUse = computeDefUseChains(ir, cfg, reaching);
    const limits = withLimits({ maxIntraproceduralChainDepth: 3 });
    const summary = buildFunctionSummary({ ir, parameterNames: ['a'], reachingDefinitions: reaching, defUse, bodyHash: 'hash-1', fingerprint: FINGERPRINT, limits });
    assert.equal(summary.truncated, true);
    assert.ok(summary.reason?.includes('maxIntraproceduralChainDepth'));
    // Under-approximates safely: never claims influence it couldn't confirm within budget.
    const influenceA = summary.parameterInfluence.find((p) => p.parameterName === 'a')!;
    assert.deepEqual(influenceA.influencesReturnAtStatementIds, []);
  });

  it('maxIntraproceduralChainDepth truncates taint propagation tracing', async () => {
    const chain = Array.from({ length: 10 }, (_, i) => `y${i} = ${i === 0 ? 'tainted' : `y${i - 1}`};`).join('\n');
    const bodyNode = await realBodyNode(
      `function foo() {\nvar tainted, ${Array.from({ length: 10 }, (_, i) => `y${i}`).join(', ')};\ntainted = getUserInput();\n${chain}\nsink(y9);\n}`,
    );
    const ir = lowerFunctionToIr({ bodyNode, language: Language.TypeScript, functionId: 'sym:v2:function:test', filePath: '/src/sample' });
    const cfg = buildFunctionCfg(ir);
    const reaching = computeReachingDefinitions(ir, cfg);
    const defUse = computeDefUseChains(ir, cfg, reaching);
    const ruleSet: TaintRuleSet = {
      version: 'test-rules-v1',
      sources: [{ id: 'user-input', textPattern: 'getUserInput(' }],
      sinks: [{ id: 'sink', textPattern: 'sink(' }],
      sanitizers: [],
    };
    const limits = withLimits({ maxIntraproceduralChainDepth: 3 });
    const result = computeTaintFindings({ ir, cfg, reachingDefinitions: reaching, defUse, ruleSet, limits });
    assert.equal(result.truncated, true);
    assert.ok(result.reason?.includes('maxIntraproceduralChainDepth'));
    // Under-approximates safely: no finding fabricated for a chain it couldn't confirm within budget.
    assert.deepEqual(result.findings, []);
  });

  it('does not flag truncated when every budget comfortably covers the function', async () => {
    const bodyNode = await realBodyNode(DIAMOND_SOURCE);
    const ir = lowerFunctionToIr({ bodyNode, language: Language.TypeScript, functionId: 'sym:v2:function:test', filePath: '/src/sample', parameterNames: ['a'] });
    assert.equal(ir.truncated, false);
    const cfg = buildFunctionCfg(ir);
    assert.equal(cfg.truncated, false);
    const reaching = computeReachingDefinitions(ir, cfg);
    assert.equal(reaching.truncated, false);
    const defUse = computeDefUseChains(ir, cfg, reaching);
    const summary = buildFunctionSummary({ ir, parameterNames: ['a'], reachingDefinitions: reaching, defUse, bodyHash: 'hash-1', fingerprint: FINGERPRINT });
    assert.equal(summary.truncated, false);
  });
});
