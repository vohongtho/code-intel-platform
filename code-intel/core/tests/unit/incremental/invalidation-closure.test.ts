import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CallSiteFact, DeclarationFact, PublishedNameFact } from '../../../src/semantic/facts.js';
import { buildReverseDependencyIndex } from '../../../src/incremental/reverse-dependency-index.js';
import { computeInvalidationClosure } from '../../../src/incremental/invalidation-closure.js';
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

function publishedName(filePath: string, moduleRef: string, publicName: string, sourceRef: string): PublishedNameFact {
  return {
    factId: `pub:${filePath}:${publicName}`,
    language: Language.TypeScript,
    filePath,
    sourceRange: range(filePath),
    moduleRef,
    publicName,
    sourceRef,
    publicationKind: 'reexport',
  };
}

describe('invalidation-closure', () => {
  it('returns empty untruncated result for no seeds', () => {
    const result = computeInvalidationClosure({ seedKeys: [], index: null, excludeFiles: new Set() });
    assert.equal(result.truncated, false);
    assert.equal(result.invalidatedFacts.length, 0);
  });

  it('falls back to full resolution when the index is missing', () => {
    const result = computeInvalidationClosure({
      seedKeys: [{ domain: 'call-site', key: 'Widget' }],
      index: null,
      excludeFiles: new Set(),
    });
    assert.equal(result.truncated, true);
    assert.match(result.reason ?? '', /missing or incompatible/);
  });

  it('finds direct consumers and excludes the changed file itself', () => {
    const index = buildReverseDependencyIndex(new Map([
      ['a.ts', [declaration('a.ts', 'Widget'), callSite('a.ts', 'Widget')]],
      ['b.ts', [callSite('b.ts', 'Widget')]],
    ]));
    const result = computeInvalidationClosure({
      seedKeys: [{ domain: 'call-site', key: 'Widget' }],
      index,
      excludeFiles: new Set(['a.ts']),
    });
    assert.equal(result.truncated, false);
    assert.deepEqual([...result.invalidatedFiles], ['b.ts']);
  });

  it('falls back to full resolution when breadth budget is exceeded', () => {
    const files = new Map<string, CallSiteFact[]>();
    for (let i = 0; i < 5; i += 1) files.set(`f${i}.ts`, [callSite(`f${i}.ts`, 'Widget')]);
    const index = buildReverseDependencyIndex(files);
    const result = computeInvalidationClosure({
      seedKeys: [{ domain: 'call-site', key: 'Widget' }],
      index,
      excludeFiles: new Set(),
      limits: { maxBreadth: 2, maxDepth: 6 },
    });
    assert.equal(result.truncated, true);
    assert.match(result.reason ?? '', /max breadth/);
  });

  it('propagates through re-export chains up to the depth limit', () => {
    const index = buildReverseDependencyIndex(new Map([
      ['a.ts', [declaration('a.ts', 'Widget')]],
      ['b.ts', [publishedName('b.ts', 'b', 'Widget', 'decl:a.ts:Widget')]],
      ['c.ts', [callSite('c.ts', 'Widget')]],
    ]));
    const result = computeInvalidationClosure({
      seedKeys: [{ domain: 'call-site', key: 'Widget' }, { domain: 'type', key: 'Widget' }, { domain: 'heritage', key: 'Widget' }, { domain: 'registration', key: 'Widget' }, { domain: 'route', key: 'Widget' }],
      index,
      excludeFiles: new Set(['a.ts']),
      limits: { maxBreadth: 100, maxDepth: 6 },
    });
    assert.equal(result.truncated, false);
    assert.ok(result.invalidatedFiles.has('c.ts'));
  });

  it('keeps both sides of a cross-file factId collision distinct (regression)', () => {
    // Two different files' consumer facts sharing the identical factId (a
    // real occurrence with content-derived factId schemes) must both survive
    // the closure's dedup step — a bare-factId Map would keep only one.
    const collidingFactId = 'call:Widget';
    const index = buildReverseDependencyIndex(new Map([
      ['a.ts', [{ ...callSite('a.ts', 'Widget'), factId: collidingFactId }]],
      ['b.ts', [{ ...callSite('b.ts', 'Widget'), factId: collidingFactId }]],
    ]));
    const result = computeInvalidationClosure({
      seedKeys: [{ domain: 'call-site', key: 'Widget' }],
      index,
      excludeFiles: new Set(),
    });
    assert.equal(result.truncated, false);
    assert.equal(result.invalidatedFacts.length, 2);
    assert.deepEqual([...result.invalidatedFiles].sort(), ['a.ts', 'b.ts']);
  });
});
