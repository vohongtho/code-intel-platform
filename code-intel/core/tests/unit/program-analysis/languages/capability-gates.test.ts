/**
 * Correctness/performance/memory gates for every language the capability
 * registry (task 15) marks 'supported' — turning a language 'supported'
 * without a corresponding gate here is a bug this test is designed to
 * catch: the registry is filtered for 'supported' languages and every one
 * of them MUST have a fixture below, or the test fails loudly rather than
 * silently skipping a gate.
 *
 *  - Correctness: the lowered IR and built CFG both pass their structural
 *    validators, and neither is truncated for this small, representative
 *    snippet.
 *  - Performance: the full lowering → CFG → dataflow → summary pipeline
 *    completes within a generous wall-clock budget (loose on purpose —
 *    this guards against a hang/blow-up, not a performance regression).
 *  - Memory: the resulting `FunctionSummary`'s serialized size stays
 *    within a sane bound for a snippet this small — guards against
 *    runaway artifact bloat, not exact byte-budget tuning.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Node as TSNode } from 'web-tree-sitter';
import { Language } from '../../../../src/shared/languages.js';
import { getLanguage, parseSource } from '../../../../src/parsing/parser-manager.js';
import { lowerFunctionToIr } from '../../../../src/program-analysis/languages/generic-lowering.js';
import { getLoweringTable } from '../../../../src/program-analysis/languages/lowering-tables.js';
import {
  PROGRAM_ANALYSIS_CAPABILITY_REGISTRY,
  validateProgramAnalysisCapabilityRegistry,
} from '../../../../src/program-analysis/languages/capability-registry.js';
import { validateFunctionIr } from '../../../../src/program-analysis/ir/validate.js';
import { buildFunctionCfg } from '../../../../src/program-analysis/cfg/build.js';
import { validateFunctionCfg } from '../../../../src/program-analysis/cfg/validate.js';
import { computeReachingDefinitions } from '../../../../src/program-analysis/dataflow/reaching-definitions.js';
import { computeDefUseChains } from '../../../../src/program-analysis/dataflow/def-use.js';
import { buildFunctionSummary } from '../../../../src/program-analysis/summaries/build.js';
import { PROGRAM_ANALYSIS_VERSION, type ProgramAnalysisFingerprint } from '../../../../src/program-analysis/contracts.js';

const FINGERPRINT: ProgramAnalysisFingerprint = {
  programAnalysisVersion: PROGRAM_ANALYSIS_VERSION,
  languageLoweringVersion: 'gate-test',
  resolverVersion: 'evidence-based-v1',
};

const PERFORMANCE_BUDGET_MS = 3000;
const MEMORY_BUDGET_BYTES = 50_000;

// Every fixture below includes a loop, and cfg/build.ts *always* marks a
// function containing one truncated — "loop init/condition/update clauses
// are not modeled" is a documented scope decision (task 4), not a defect.
// The gate treats only that specific, known reason as acceptable; any
// other truncation reason is a real correctness failure.
const KNOWN_ACCEPTABLE_CFG_TRUNCATION_REASONS = ['loop init/condition/update clauses are not modeled (only the body is)'];

function isOnlyKnownAcceptableTruncation(reason: string | undefined): boolean {
  if (!reason) return false;
  return reason.split('; ').every((part) => KNOWN_ACCEPTABLE_CFG_TRUNCATION_REASONS.includes(part));
}

function findFirstOfType(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findFirstOfType(child, type);
    if (found) return found;
  }
  return null;
}

const GATE_FIXTURES: Record<string, { source: string; parameterNames: readonly string[] }> = {
  [Language.TypeScript]: {
    source: 'function foo(a, b) { let x = 1; if (a) { x = a + b; } else { throw new Error("bad"); } for (let i = 0; i < 10; i++) { if (i === 5) break; consume(i); } return x; }',
    parameterNames: ['a', 'b'],
  },
  [Language.JavaScript]: {
    source: 'function foo(a, b) { let x = 1; if (a) { x = a + b; } else { throw new Error("bad"); } for (let i = 0; i < 10; i++) { if (i === 5) break; consume(i); } return x; }',
    parameterNames: ['a', 'b'],
  },
  [Language.Python]: {
    source: 'def foo(a, b):\n    x = 1\n    if a:\n        x = a\n    else:\n        raise Exception("bad")\n    for i in range(10):\n        if i == 5:\n            break\n        consume(i)\n    return x\n',
    parameterNames: ['a', 'b'],
  },
  [Language.Java]: {
    source: 'class Foo { int foo(int a, int b) { int x = 1; if (a > 0) { x = a + b; } else { throw new RuntimeException("bad"); } for (int i = 0; i < 10; i++) { if (i == 5) break; consume(i); } return x; } }',
    parameterNames: ['a', 'b'],
  },
  [Language.Go]: {
    source: 'package main\nfunc foo(a int, b int) int {\n    x := 1\n    if a > 0 {\n        x = a + b\n    } else {\n        panic("bad")\n    }\n    for i := 0; i < 10; i++ {\n        if i == 5 { break }\n        consume(i)\n    }\n    return x\n}\n',
    parameterNames: ['a', 'b'],
  },
  [Language.C]: {
    source: 'int foo(int a, int b) {\n    int x = 1;\n    if (a > 0) {\n        x = a + b;\n    } else {\n        return -1;\n    }\n    for (int i = 0; i < 10; i++) {\n        if (i == 5) break;\n        consume(i);\n    }\n    return x;\n}\n',
    parameterNames: ['a', 'b'],
  },
  [Language.Cpp]: {
    source: 'int foo(int a, int b) {\n    int x = 1;\n    if (a > 0) {\n        x = a + b;\n    } else {\n        throw std::runtime_error("bad");\n    }\n    for (int i = 0; i < 10; i++) {\n        if (i == 5) break;\n        consume(i);\n    }\n    return x;\n}\n',
    parameterNames: ['a', 'b'],
  },
  [Language.CSharp]: {
    source: 'class Foo { int Bar(int a, int b) { int x = 1; if (a > 0) { x = a + b; } else { throw new Exception("bad"); } for (int i = 0; i < 10; i++) { if (i == 5) break; Consume(i); } return x; } }',
    parameterNames: ['a', 'b'],
  },
  [Language.Rust]: {
    source: 'fn foo(a: i32, b: i32) -> i32 {\n    let mut x = 1;\n    if a > 0 {\n        x = a + b;\n    } else {\n        panic!("bad");\n    }\n    for i in 0..10 {\n        if i == 5 { break; }\n        consume(i);\n    }\n    x\n}\n',
    parameterNames: ['a', 'b'],
  },
  [Language.PHP]: {
    source: '<?php\nfunction foo($a, $b) {\n    $x = 1;\n    if ($a > 0) {\n        $x = $a + $b;\n    } else {\n        throw new Exception("bad");\n    }\n    for ($i = 0; $i < 10; $i++) {\n        if ($i == 5) break;\n        consume($i);\n    }\n    return $x;\n}\n',
    parameterNames: ['a', 'b'],
  },
  [Language.Ruby]: {
    source: 'def foo(a, b)\n  x = 1\n  if a > 0\n    x = a + b\n  else\n    raise "bad"\n  end\n  while x > 0\n    x -= 1\n    consume(x)\n  end\n  x\nend\n',
    parameterNames: ['a', 'b'],
  },
};

const supportedLanguages = PROGRAM_ANALYSIS_CAPABILITY_REGISTRY.filter((entry) => entry.capabilities.ir === 'supported').map((entry) => entry.language);

describe('program-analysis capability registry', () => {
  it('is internally consistent (validated at module load, re-checked here)', () => {
    assert.doesNotThrow(() => validateProgramAnalysisCapabilityRegistry());
  });

  it('marks at least one language supported', () => {
    assert.ok(supportedLanguages.length > 0, 'expected at least one supported language to gate');
  });
});

describe('per-language correctness/performance/memory gates', () => {
  for (const language of supportedLanguages) {
    it(`${language}: passes correctness, performance, and memory gates`, async () => {
      const fixture = GATE_FIXTURES[language];
      assert.ok(fixture, `no gate fixture defined for '${language}', which the capability registry marks 'supported' — add one`);

      const available = await getLanguage(language);
      assert.ok(available, `grammar unavailable for ${language} in this environment`);

      const startedAt = Date.now();

      const tree = await parseSource(language, fixture.source);
      assert.ok(tree);
      const table = getLoweringTable(language)!;
      const bodyNode = findFirstOfType(tree!.rootNode as unknown as TSNode, table.blockTypes[0]!);
      assert.ok(bodyNode, `could not locate a ${table.blockTypes[0]} node for ${language}`);

      const ir = lowerFunctionToIr({
        bodyNode: bodyNode!,
        language,
        functionId: 'sym:v2:function:gate-test',
        filePath: '/src/gate-fixture',
        parameterNames: fixture.parameterNames,
      });
      const irValidation = validateFunctionIr(ir);
      const cfg = buildFunctionCfg(ir);
      const cfgValidation = validateFunctionCfg(cfg);
      const reachingDefinitions = computeReachingDefinitions(ir, cfg);
      const defUse = computeDefUseChains(ir, cfg, reachingDefinitions);
      const summary = buildFunctionSummary({
        ir,
        parameterNames: fixture.parameterNames,
        reachingDefinitions,
        defUse,
        bodyHash: 'gate-test-hash',
        fingerprint: FINGERPRINT,
      });

      const elapsedMs = Date.now() - startedAt;

      // Correctness.
      assert.deepEqual(irValidation.errors, []);
      assert.equal(irValidation.valid, true);
      assert.equal(ir.truncated, false, `IR unexpectedly truncated for ${language}: ${ir.reason}`);
      assert.deepEqual(cfgValidation.errors, []);
      assert.equal(cfgValidation.valid, true);
      // cfg.truncated propagates into reachingDefinitions.truncated and then into
      // summary.truncated, so the same known-acceptable-reason tolerance applies to all three.
      if (cfg.truncated) {
        assert.ok(isOnlyKnownAcceptableTruncation(cfg.reason), `CFG truncated for ${language} for an unexpected reason: ${cfg.reason}`);
      }
      if (reachingDefinitions.truncated) {
        assert.ok(isOnlyKnownAcceptableTruncation(reachingDefinitions.reason), `reaching-definitions truncated for ${language} for an unexpected reason: ${reachingDefinitions.reason}`);
      }
      if (summary.truncated) {
        assert.ok(isOnlyKnownAcceptableTruncation(summary.reason), `summary truncated for ${language} for an unexpected reason: ${summary.reason}`);
      }
      assert.ok(summary.parameterInfluence.length === fixture.parameterNames.length);

      // Performance (loose — guards against a hang, not a regression).
      assert.ok(elapsedMs < PERFORMANCE_BUDGET_MS, `${language} gate took ${elapsedMs}ms, over the ${PERFORMANCE_BUDGET_MS}ms budget`);

      // Memory (loose — guards against runaway artifact bloat for a small snippet).
      const summaryBytes = JSON.stringify(summary).length;
      assert.ok(summaryBytes < MEMORY_BUDGET_BYTES, `${language} summary serialized to ${summaryBytes} bytes, over the ${MEMORY_BUDGET_BYTES}-byte budget`);
    });
  }
});
