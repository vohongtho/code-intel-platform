import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CallSiteFact, DeclarationFact } from '../../../src/semantic/facts.js';
import { Language } from '../../../src/shared/languages.js';
import { computeSemanticCompatibility, createSemanticSnapshot } from '../../../src/incremental/semantic-snapshot.js';
import { buildReverseDependencyIndex } from '../../../src/incremental/reverse-dependency-index.js';
import { computeSemanticDelta } from '../../../src/incremental/semantic-delta.js';
import { mergedFactCorpus, selectFactsForReResolution } from '../../../src/incremental/re-resolve.js';

function range(filePath: string, line = 1) {
  return { filePath, startLine: line, startColumn: 0, endLine: line, endColumn: 10 };
}

function declaration(filePath: string, name: string, extra: Partial<DeclarationFact> = {}): DeclarationFact {
  return {
    factId: `decl:${filePath}:${name}`,
    language: Language.TypeScript,
    filePath,
    sourceRange: range(filePath),
    declarationKind: 'class',
    name,
    qualifiedName: name,
    anchors: { identity: range(filePath), render: range(filePath) },
    ...extra,
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

const compat = computeSemanticCompatibility();

describe('re-resolve', () => {
  it('selects every relationship fact in a changed file plus closure-invalidated facts in unchanged files', () => {
    const decl = declaration('a.ts', 'Widget');
    const consumerCall = callSite('b.ts', 'Widget');
    const unrelatedCall = callSite('c.ts', 'Other');
    const factsByFile = new Map([
      ['a.ts', [decl]],
      ['b.ts', [consumerCall]],
      ['c.ts', [unrelatedCall]],
    ]);
    const snapshot = createSemanticSnapshot(factsByFile, compat);
    const reverseIndex = buildReverseDependencyIndex(factsByFile);

    const changedDecl = declaration('a.ts', 'Widget', { signature: { parameters: [{ name: 'x' }] } });
    const newCallInA = callSite('a.ts', 'helper');
    const delta = computeSemanticDelta({
      changedFiles: ['a.ts'],
      deletedFiles: [],
      previousSnapshot: snapshot,
      newFactsByFile: new Map([['a.ts', [changedDecl, newCallInA]]]),
      reverseIndex,
      compatibility: compat,
    });

    const selected = selectFactsForReResolution({
      delta,
      previousSnapshot: snapshot,
      newFactsByFile: new Map([['a.ts', [changedDecl, newCallInA]]]),
    });

    const selectedIds = selected.map((f) => f.factId).sort();
    assert.deepEqual(selectedIds, [consumerCall.factId, newCallInA.factId].sort());
    assert.ok(!selectedIds.includes(unrelatedCall.factId));
  });

  it('merges the current fact corpus with changed files replaced and deleted files removed', () => {
    const factsByFile = new Map([
      ['a.ts', [declaration('a.ts', 'Widget')]],
      ['b.ts', [callSite('b.ts', 'Widget')]],
      ['c.ts', [callSite('c.ts', 'Gone')]],
    ]);
    const snapshot = createSemanticSnapshot(factsByFile, compat);
    const newDecl = declaration('a.ts', 'RenamedWidget');

    const merged = mergedFactCorpus({
      previousSnapshot: snapshot,
      changedFiles: ['a.ts'],
      deletedFiles: ['c.ts'],
      newFactsByFile: new Map([['a.ts', [newDecl]]]),
    });

    const ids = merged.map((f) => f.factId).sort();
    assert.deepEqual(ids, [newDecl.factId, 'call:b.ts:Widget'].sort());
  });

  it('does not drop one side of a cross-file factId collision (regression)', () => {
    // Several real fact adapters (e.g. the current TypeScript/JavaScript
    // stubs) derive factId from content alone, without the file path, so two
    // files can legitimately produce the identical factId (e.g. two files
    // each importing a same-named symbol on the same line). Selecting facts
    // for re-resolution must key by (filePath, factId), not bare factId, or
    // one file's fact silently overwrites the other's in the result.
    const sharedFactId = 'imp:Widget:1';
    const factInFileA: CallSiteFact = { ...callSite('a.ts', 'Widget'), factId: sharedFactId };
    const factInFileB: CallSiteFact = { ...callSite('b.ts', 'Widget'), factId: sharedFactId };

    const delta = computeSemanticDelta({
      changedFiles: ['a.ts', 'b.ts'],
      deletedFiles: [],
      previousSnapshot: createSemanticSnapshot(new Map(), compat),
      newFactsByFile: new Map([['a.ts', [factInFileA]], ['b.ts', [factInFileB]]]),
      reverseIndex: buildReverseDependencyIndex(new Map()),
      compatibility: compat,
    });

    const selected = selectFactsForReResolution({
      delta,
      previousSnapshot: createSemanticSnapshot(new Map(), compat),
      newFactsByFile: new Map([['a.ts', [factInFileA]], ['b.ts', [factInFileB]]]),
    });

    assert.equal(selected.length, 2, 'both files\' colliding-factId facts must survive selection');
    assert.ok(selected.some((f) => f.filePath === 'a.ts'));
    assert.ok(selected.some((f) => f.filePath === 'b.ts'));
  });
});
