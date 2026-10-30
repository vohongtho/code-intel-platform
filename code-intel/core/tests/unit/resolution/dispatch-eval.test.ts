/**
 * Dispatch precision/recall against declared target sets (not edge counts).
 * Each case declares the exact runtime targets a call may reach, the
 * targets it must never reach, and whether the set may be called complete.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildResolutionIndexes } from '../../../src/resolution/indexes.js';
import { resolveDispatch } from '../../../src/resolution/dispatch.js';
import type { ReceiverFact, SemanticFact } from '../../../src/semantic/facts.js';
import { Language } from '../../../src/shared/languages.js';

const range = { filePath: 'f', startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 };
const nominal = (name: string) => ({ kind: 'nominal' as const, text: name, name });

function decl(language: Language, factId: string, name: string, kind: string, ownerRef?: string): SemanticFact {
  return { factId, language, filePath: 'f', sourceRange: range, declarationKind: kind, name, ...(ownerRef ? { ownerRef } : {}), anchors: { identity: range, render: range } } as SemanticFact;
}
function inherits(language: Language, factId: string, declarationRef: string, target: string, heritageKind: 'extends' | 'implements' | 'mixes-in'): SemanticFact {
  return { factId, language, filePath: 'f', sourceRange: range, declarationRef, heritageKind, target: nominal(target) } as SemanticFact;
}

interface EvalCase {
  name: string;
  language: Language;
  facts: SemanticFact[];
  receiver: ReceiverFact;
  callerRef?: string;
  member: string;
  expected: string[];
  forbidden: string[];
  complete: boolean;
}

function shapes(language: Language): SemanticFact[] {
  return [
    decl(language, 'Shape', 'Shape', 'interface'),
    decl(language, 'Shape.area', 'area', 'method', 'Shape'),
    decl(language, 'Circle', 'Circle', 'class'),
    decl(language, 'Circle.area', 'area', 'method', 'Circle'),
    inherits(language, 'h1', 'Circle', 'Shape', 'implements'),
    decl(language, 'Square', 'Square', 'class'),
    decl(language, 'Square.area', 'area', 'method', 'Square'),
    inherits(language, 'h2', 'Square', 'Shape', 'implements'),
    decl(language, 'Report', 'Report', 'class'),
    decl(language, 'Report.area', 'area', 'method', 'Report'),
  ];
}

const CASES: EvalCase[] = [
  ...[Language.TypeScript, Language.Java, Language.CSharp].map((language): EvalCase => ({
    name: `${language}: interface with two implementations`,
    language, facts: shapes(language), receiver: { text: 's', type: nominal('Shape') }, member: 'area',
    expected: ['Circle.area', 'Square.area'], forbidden: ['Shape.area', 'Report.area'], complete: false,
  })),
  {
    name: 'java: constructor receiver narrows to one class',
    language: Language.Java, facts: shapes(Language.Java), receiver: { text: 'new Square()' }, member: 'area',
    expected: ['Square.area'], forbidden: ['Circle.area', 'Report.area', 'Shape.area'], complete: true,
  },
  {
    name: 'csharp: exact DI registration narrows the injected interface',
    language: Language.CSharp,
    facts: [...shapes(Language.CSharp), {
      factId: 'di', language: Language.CSharp, filePath: 'Startup.cs', sourceRange: range, bindingKind: 'contract-to-implementation', contractRef: 'Shape', implementationRef: 'Circle', dynamic: false,
      frameworkEvidence: { frameworkId: 'microsoft-di', adapterVersion: '0.2.0', exact: true },
    } as SemanticFact],
    receiver: { text: 's', type: nominal('Shape') }, member: 'area',
    expected: ['Circle.area'], forbidden: ['Square.area', 'Report.area'], complete: true,
  },
  {
    name: 'go: embedded struct promotes the base method',
    language: Language.Go,
    facts: [
      decl(Language.Go, 'Base', 'Base', 'struct'), decl(Language.Go, 'Base.Start', 'Start', 'method', 'Base'),
      decl(Language.Go, 'Server', 'Server', 'struct'), inherits(Language.Go, 'e1', 'Server', 'Base', 'mixes-in'),
      decl(Language.Go, 'Other', 'Other', 'struct'), decl(Language.Go, 'Other.Start', 'Start', 'method', 'Other'),
    ],
    receiver: { text: 's', type: nominal('Server') }, member: 'Start',
    expected: ['Base.Start'], forbidden: ['Other.Start'], complete: true,
  },
  {
    name: 'python: self receiver dispatches to the class and its overriding subclass',
    language: Language.Python,
    facts: [
      decl(Language.Python, 'Handler', 'Handler', 'class'), decl(Language.Python, 'Handler.run', 'run', 'method', 'Handler'),
      decl(Language.Python, 'Handler.handle', 'handle', 'method', 'Handler'),
      decl(Language.Python, 'Json', 'JsonHandler', 'class'), decl(Language.Python, 'Json.handle', 'handle', 'method', 'Json'),
      inherits(Language.Python, 'p1', 'Json', 'Handler', 'extends'),
      decl(Language.Python, 'Plain', 'PlainHandler', 'class'), inherits(Language.Python, 'p2', 'Plain', 'Handler', 'extends'),
      decl(Language.Python, 'Unrelated.handle', 'handle', 'method', 'Unrelated'),
    ],
    receiver: { text: 'self' }, callerRef: 'Handler.run', member: 'handle',
    expected: ['Handler.handle', 'Json.handle'], forbidden: ['Unrelated.handle'], complete: true,
  },
  {
    name: 'rust: trait object dispatch stays an open candidate set',
    language: Language.Rust,
    facts: [
      decl(Language.Rust, 'Store', 'Store', 'trait'), decl(Language.Rust, 'Store.get', 'get', 'method', 'Store'),
      decl(Language.Rust, 'Mem', 'MemStore', 'struct'), decl(Language.Rust, 'Mem.get', 'get', 'method', 'Mem'),
      inherits(Language.Rust, 'r1', 'Mem', 'Store', 'implements'),
    ],
    receiver: { text: 'store', type: nominal('Store') }, member: 'get',
    expected: ['Mem.get'], forbidden: ['Store.get'], complete: false,
  },
];

describe('dispatch target-set evaluation', () => {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const testCase of CASES) {
    it(testCase.name, () => {
      const result = resolveDispatch(buildResolutionIndexes(testCase.facts), {
        callSiteId: testCase.name, language: testCase.language, receiver: testCase.receiver, callerRef: testCase.callerRef, memberName: testCase.member,
      });
      const emitted = new Set(result?.candidates.map((item) => item.targetId) ?? []);
      for (const target of testCase.expected) if (emitted.has(target)) truePositives += 1; else falseNegatives += 1;
      for (const target of emitted) if (!testCase.expected.includes(target)) falsePositives += 1;
      for (const forbidden of testCase.forbidden) assert.ok(!emitted.has(forbidden), `forbidden target ${forbidden} emitted`);
      assert.deepEqual([...emitted].sort(), [...testCase.expected].sort());
      assert.equal(result?.complete, testCase.complete);
      if (!testCase.complete) assert.notEqual(result?.certainty, 'exact');
    });
  }

  it('reaches full precision and recall on the declared target sets', () => {
    const precision = truePositives / Math.max(1, truePositives + falsePositives);
    const recall = truePositives / Math.max(1, truePositives + falseNegatives);
    assert.equal(precision, 1);
    assert.equal(recall, 1);
    assert.ok(truePositives >= 10);
  });
});
