import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DeclarationFact, SemanticFact } from '../../../src/semantic/facts.js';
import { Language } from '../../../src/shared/languages.js';
import {
  buildSemanticSnapshotFile,
  computeSemanticCompatibility,
  createSemanticSnapshot,
  factIdentityFingerprint,
  isCompatibleSnapshot,
  parseSemanticSnapshot,
  serializeSemanticSnapshot,
} from '../../../src/incremental/semantic-snapshot.js';

function range(startLine: number) {
  return { filePath: 'a.ts', startLine, startColumn: 0, endLine: startLine, endColumn: 10 };
}

function declaration(overrides: Partial<DeclarationFact> = {}): DeclarationFact {
  return {
    factId: 'decl:widget',
    language: Language.TypeScript,
    filePath: 'a.ts',
    sourceRange: range(1),
    declarationKind: 'class',
    name: 'Widget',
    qualifiedName: 'Widget',
    anchors: { identity: range(1), render: range(1) },
    ...overrides,
  } as DeclarationFact;
}

describe('semantic-snapshot', () => {
  it('is deterministic regardless of input fact order', () => {
    const factsA: SemanticFact[] = [declaration({ factId: 'decl:a' }), declaration({ factId: 'decl:b', name: 'Other' })];
    const factsB: SemanticFact[] = [...factsA].reverse();
    const compat = computeSemanticCompatibility();
    const snapA = createSemanticSnapshot(new Map([['a.ts', factsA]]), compat);
    const snapB = createSemanticSnapshot(new Map([['a.ts', factsB]]), compat);
    assert.equal(snapA.fingerprint, snapB.fingerprint);
  });

  it('ignores source position when fingerprinting a fact', () => {
    const moved = declaration({ sourceRange: range(99) });
    const original = declaration();
    assert.equal(factIdentityFingerprint(moved), factIdentityFingerprint(original));
  });

  it('changes fingerprint when declaration shape changes', () => {
    const original = declaration();
    const renamed = declaration({ qualifiedName: 'RenamedWidget' });
    assert.notEqual(factIdentityFingerprint(original), factIdentityFingerprint(renamed));
  });

  it('round-trips through serialization', () => {
    const compat = computeSemanticCompatibility();
    const snapshot = createSemanticSnapshot(new Map([['a.ts', [declaration()]]]), compat);
    const restored = parseSemanticSnapshot(serializeSemanticSnapshot(snapshot));
    assert.ok(restored);
    assert.equal(restored!.fingerprint, snapshot.fingerprint);
  });

  it('detects compatibility mismatches', () => {
    const compat = computeSemanticCompatibility();
    const snapshot = createSemanticSnapshot(new Map(), compat);
    assert.equal(isCompatibleSnapshot(snapshot, compat), true);
    assert.equal(isCompatibleSnapshot(snapshot, { ...compat, resolverFingerprint: 'stale' }), false);
    assert.equal(isCompatibleSnapshot(null, compat), false);
  });

  it('builds a single file record with a stable fact ordering', () => {
    const file = buildSemanticSnapshotFile('a.ts', [declaration({ factId: 'z' }), declaration({ factId: 'a' })]);
    assert.deepEqual(file.facts.map((f) => f.factId), ['a', 'z']);
  });
});
