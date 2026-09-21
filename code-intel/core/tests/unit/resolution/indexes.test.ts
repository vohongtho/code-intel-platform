import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildResolutionIndexes, createResolutionInstrumentation, noteFullWorkspaceTraversal } from '../../../src/resolution/indexes.js';
import type { SemanticFact } from '../../../src/semantic/facts.js';
import { Language } from '../../../src/shared/languages.js';

const range = { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 };

function facts(): SemanticFact[] {
  return [
    {
      factId: 'decl:1',
      language: Language.TypeScript,
      filePath: 'src/a.ts',
      sourceRange: range,
      declarationKind: 'function',
      name: 'foo',
      qualifiedName: 'ns.foo',
      type: { kind: 'generic-application', text: 'Repo<User>', name: 'Repo', arguments: [{ kind: 'nominal', text: 'User', name: 'User' }] },
      anchors: { identity: range, render: range },
    },
    {
      factId: 'decl:2',
      language: Language.TypeScript,
      filePath: 'src/a.ts',
      sourceRange: range,
      declarationKind: 'method',
      name: 'bar',
      ownerRef: 'decl:1',
      anchors: { identity: range, render: range },
    },
    {
      factId: 'imp:1',
      language: Language.TypeScript,
      filePath: 'src/a.ts',
      sourceRange: range,
      sourceModule: './b',
      importedName: 'baz',
      localName: 'baz',
      bindingKind: 'named',
    },
    {
      factId: 'pub:1',
      language: Language.TypeScript,
      filePath: 'src/b.ts',
      sourceRange: range,
      moduleRef: 'module:b',
      publicName: 'baz',
      sourceRef: 'decl:1',
      publicationKind: 'definition',
    },
    {
      factId: 'herit:1',
      language: Language.TypeScript,
      filePath: 'src/a.ts',
      sourceRange: range,
      declarationRef: 'decl:2',
      heritageKind: 'extends',
      target: { kind: 'nominal', text: 'Base', name: 'Base' },
    },
    {
      factId: 'reg:1',
      language: Language.TypeScript,
      filePath: 'src/a.ts',
      sourceRange: range,
      registrationKind: 'event',
      subjectRef: 'decl:2',
      targetText: 'clicked',
    },
  ];
}

describe('resolution indexes', () => {
  it('builds prepared indexes and instrumentation counters', () => {
    const instrumentation = createResolutionInstrumentation();
    const indexes = buildResolutionIndexes(facts(), instrumentation);

    assert.equal(indexes.instrumentation.indexBuildCount, 1);
    assert.equal(indexes.declarationsByFactId.size, 2);
    assert.equal(indexes.declarationsByName.get('foo')?.length, 1);
    assert.equal(indexes.declarationsByQualifiedName.get('ns.foo')?.length, 1);
    assert.equal(indexes.declarationsByOwnerRef.get('decl:1')?.length, 1);
    assert.equal(indexes.declarationsByTypeName.get('Repo')?.length, 1);
    assert.equal(indexes.declarationsByTypeName.get('Repo<User>')?.length, 1);
    assert.equal(indexes.declarationsByTypeName.get('User')?.length, 1);
    assert.equal(indexes.importsByFile.get('src/a.ts')?.length, 1);
    assert.equal(indexes.publishedNamesByModule.get('module:b')?.length, 1);
    assert.equal(indexes.heritageByDeclaration.get('decl:2')?.length, 1);
    assert.equal(indexes.registrationsBySubject.get('decl:2')?.length, 1);
  });

  it('tracks explicit full workspace traversals', () => {
    const indexes = buildResolutionIndexes(facts());
    noteFullWorkspaceTraversal(indexes);
    noteFullWorkspaceTraversal(indexes);
    assert.equal(indexes.instrumentation.fullWorkspaceTraversalCount, 2);
  });
});
