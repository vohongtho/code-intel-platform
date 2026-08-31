import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CallSiteFact, DeclarationFact, HeritageFact } from '../../../src/semantic/facts.js';
import { buildReverseDependencyIndex, factRef, isReverseDependencyIndexCompatible, lookupConsumers } from '../../../src/incremental/reverse-dependency-index.js';
import { Language } from '../../../src/shared/languages.js';

function range(filePath: string, line = 1) {
  return { filePath, startLine: line, startColumn: 0, endLine: line, endColumn: 10 };
}

function declaration(filePath: string, name: string): DeclarationFact {
  return {
    factId: `decl:${filePath}:${name}`,
    language: Language.TypeScript,
    filePath,
    sourceRange: range(filePath),
    declarationKind: 'class',
    name,
    qualifiedName: name,
    anchors: { identity: range(filePath), render: range(filePath) },
  };
}

function callSite(filePath: string, calleeText: string): CallSiteFact {
  return {
    factId: `call:${filePath}:${calleeText}`,
    language: Language.TypeScript,
    filePath,
    sourceRange: range(filePath),
    calleeText,
  };
}

function heritage(filePath: string, targetName: string): HeritageFact {
  return {
    factId: `heritage:${filePath}:${targetName}`,
    language: Language.TypeScript,
    filePath,
    sourceRange: range(filePath),
    heritageKind: 'extends',
    target: { kind: 'nominal', text: targetName, name: targetName },
  };
}

describe('reverse-dependency-index', () => {
  it('finds call-site consumers of a declared symbol in another file', () => {
    const index = buildReverseDependencyIndex(new Map([
      ['a.ts', [declaration('a.ts', 'Widget')]],
      ['b.ts', [callSite('b.ts', 'Widget')]],
    ]));
    const consumers = lookupConsumers(index, 'call-site', 'Widget');
    assert.equal(consumers.length, 1);
    assert.equal(consumers[0]!.filePath, 'b.ts');
    assert.equal(consumers[0]!.factId, 'call:b.ts:Widget');
  });

  it('finds heritage consumers separately from call-site consumers', () => {
    const index = buildReverseDependencyIndex(new Map([
      ['a.ts', [declaration('a.ts', 'Base')]],
      ['b.ts', [heritage('b.ts', 'Base')]],
      ['c.ts', [callSite('c.ts', 'Base')]],
    ]));
    assert.equal(lookupConsumers(index, 'heritage', 'Base').length, 1);
    assert.equal(lookupConsumers(index, 'call-site', 'Base').length, 1);
    assert.equal(lookupConsumers(index, 'type', 'Base').length, 0);
  });

  it('records produced keys for declarations, used for re-export propagation', () => {
    const decl = declaration('a.ts', 'Widget');
    const index = buildReverseDependencyIndex(new Map([['a.ts', [decl]]]));
    const produced = index.producedByFactId.get(factRef('a.ts', decl.factId));
    assert.ok(produced);
    assert.ok(produced!.some((k) => k.domain === 'call-site' && k.key === 'Widget'));
    assert.ok(produced!.some((k) => k.domain === 'heritage' && k.key === 'Widget'));
  });

  it('validates index version compatibility', () => {
    const index = buildReverseDependencyIndex(new Map());
    assert.equal(isReverseDependencyIndexCompatible(index), true);
    assert.equal(isReverseDependencyIndexCompatible({ version: 999 }), false);
    assert.equal(isReverseDependencyIndexCompatible(null), false);
  });
});
