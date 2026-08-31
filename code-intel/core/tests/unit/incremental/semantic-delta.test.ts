import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CallSiteFact, DeclarationFact, ImportBindingFact, PublishedNameFact } from '../../../src/semantic/facts.js';
import { Language } from '../../../src/shared/languages.js';
import { computeSemanticCompatibility, createSemanticSnapshot } from '../../../src/incremental/semantic-snapshot.js';
import { buildReverseDependencyIndex } from '../../../src/incremental/reverse-dependency-index.js';
import { computeSemanticDelta } from '../../../src/incremental/semantic-delta.js';

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

function callSite(filePath: string, calleeText: string, extra: Partial<CallSiteFact> = {}): CallSiteFact {
  return {
    factId: `call:${filePath}:${calleeText}`,
    language: Language.TypeScript,
    filePath,
    sourceRange: range(filePath),
    calleeText,
    ...extra,
  };
}

function importBinding(filePath: string, sourceModule: string, localName: string, importedName?: string): ImportBindingFact {
  return {
    factId: `import:${filePath}:${localName}`,
    language: Language.TypeScript,
    filePath,
    sourceRange: range(filePath),
    sourceModule,
    importedName,
    localName,
    bindingKind: 'named',
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
    publicationKind: 'definition',
  };
}

const compat = computeSemanticCompatibility();

describe('semantic-delta', () => {
  it('requires full resolution when the previous snapshot is incompatible', () => {
    const delta = computeSemanticDelta({
      changedFiles: ['a.ts'],
      deletedFiles: [],
      previousSnapshot: null,
      newFactsByFile: new Map(),
      reverseIndex: null,
      compatibility: compat,
    });
    assert.equal(delta.requiresFullResolution, true);
  });

  it('classifies a call-argument-only edit as body-only with no cross-file invalidation', () => {
    const decl = declaration('a.ts', 'Widget');
    const oldCall = callSite('a.ts', 'helper', { arguments: [{ position: 0, text: '1' }] });
    const newCall = callSite('a.ts', 'helper', { arguments: [{ position: 0, text: '2' }] });
    const snapshot = createSemanticSnapshot(new Map([['a.ts', [decl, oldCall]]]), compat);
    const reverseIndex = buildReverseDependencyIndex(new Map([['a.ts', [decl, oldCall]]]));

    const delta = computeSemanticDelta({
      changedFiles: ['a.ts'],
      deletedFiles: [],
      previousSnapshot: snapshot,
      newFactsByFile: new Map([['a.ts', [decl, newCall]]]),
      reverseIndex,
      compatibility: compat,
    });

    assert.equal(delta.requiresFullResolution, false);
    assert.deepEqual(delta.bodyOnlyFiles, ['a.ts']);
    assert.deepEqual(delta.changedFacts, [newCall.factId]);
    assert.equal(delta.invalidatedCallSites.length, 0);
    assert.equal(delta.invalidatedSymbols.length, 0);
    assert.ok(!delta.affectedArtifacts.has('flows'));
  });

  it('invalidates an unchanged consumer file when a declaration signature changes', () => {
    const decl = declaration('a.ts', 'Widget');
    const consumerCall = callSite('b.ts', 'Widget');
    const factsByFile = new Map([['a.ts', [decl]], ['b.ts', [consumerCall]]]);
    const snapshot = createSemanticSnapshot(factsByFile, compat);
    const reverseIndex = buildReverseDependencyIndex(factsByFile);

    const changedDecl = declaration('a.ts', 'Widget', { signature: { parameters: [{ name: 'x' }] } });
    const delta = computeSemanticDelta({
      changedFiles: ['a.ts'],
      deletedFiles: [],
      previousSnapshot: snapshot,
      newFactsByFile: new Map([['a.ts', [changedDecl]]]),
      reverseIndex,
      compatibility: compat,
    });

    assert.equal(delta.requiresFullResolution, false);
    assert.deepEqual(delta.bodyOnlyFiles, []);
    assert.deepEqual(delta.invalidatedCallSites, [consumerCall.factId]);
    assert.ok(delta.affectedArtifacts.has('flows'));
  });

  it('invalidates a same-module-path importer transitively when the exporting file is deleted', () => {
    const decl = declaration('a.ts', 'Widget');
    const publication = publishedName('a.ts', 'a', 'Widget', decl.factId);
    const consumerImport = importBinding('b.ts', 'a', 'Widget', 'Widget');
    const factsByFile = new Map([['a.ts', [decl, publication]], ['b.ts', [consumerImport]]]);
    const snapshot = createSemanticSnapshot(factsByFile, compat);
    const reverseIndex = buildReverseDependencyIndex(factsByFile);

    const delta = computeSemanticDelta({
      changedFiles: [],
      deletedFiles: ['a.ts'],
      previousSnapshot: snapshot,
      newFactsByFile: new Map(),
      reverseIndex,
      compatibility: compat,
    });

    assert.equal(delta.requiresFullResolution, false);
    assert.ok(delta.removedFacts.includes(decl.factId));
    assert.deepEqual(delta.invalidatedSymbols, [consumerImport.factId]);
  });

  it('treats a rename as remove-plus-add and still invalidates the old name\'s consumers', () => {
    const decl = declaration('a.ts', 'Widget');
    const consumerCall = callSite('b.ts', 'Widget');
    const factsByFile = new Map([['a.ts', [decl]], ['b.ts', [consumerCall]]]);
    const snapshot = createSemanticSnapshot(factsByFile, compat);
    const reverseIndex = buildReverseDependencyIndex(factsByFile);

    const renamed = declaration('a.ts', 'RenamedWidget', { factId: 'decl:a.ts:RenamedWidget' });
    const delta = computeSemanticDelta({
      changedFiles: ['a.ts'],
      deletedFiles: [],
      previousSnapshot: snapshot,
      newFactsByFile: new Map([['a.ts', [renamed]]]),
      reverseIndex,
      compatibility: compat,
    });

    assert.equal(delta.requiresFullResolution, false);
    assert.deepEqual(delta.removedFacts, [decl.factId]);
    assert.deepEqual(delta.addedFacts, [renamed.factId]);
    assert.deepEqual(delta.invalidatedCallSites, [consumerCall.factId]);
  });
});
