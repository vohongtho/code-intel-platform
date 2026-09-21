import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildResolutionIndexes } from '../../../src/resolution/indexes.js';
import { resolveImportBinding, resolveInheritanceDispatch, resolvePublicSurface, resolveQualifiedOwner, resolveReceiverType, resolveReference, resolveRegistrationDispatch } from '../../../src/resolution/strategies.js';
import type { SemanticFact } from '../../../src/semantic/facts.js';
import { Language } from '../../../src/shared/languages.js';

const range = { filePath: 'src/app.ts', startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 };
const decl = (factId: string, name: string, extras: Partial<SemanticFact> = {}) => ({
  factId,
  language: Language.TypeScript,
  filePath: 'src/app.ts',
  sourceRange: range,
  declarationKind: 'function',
  name,
  qualifiedName: `src/app.ts:${name}`,
  anchors: { identity: range, render: range },
  ...extras,
}) as SemanticFact;

describe('resolution strategies', () => {
  it('resolves lexical and qualified owner matches before fallback', () => {
    const indexes = buildResolutionIndexes([
      decl('owner', 'Owner'),
      decl('child', 'render', { ownerRef: 'owner' }),
    ]);

    const exact = resolveQualifiedOwner(indexes, { referenceId: 'ref1', filePath: 'src/app.ts', name: 'render', ownerRef: 'owner' });
    assert.equal(exact.length, 1);
    assert.equal(exact[0]?.targetId, 'child');

    const outcome = resolveReference(indexes, { referenceId: 'ref2', filePath: 'src/app.ts', name: 'render', ownerRef: 'owner' });
    assert.equal(outcome.certainty, 'exact');
  });

  it('resolves receiver/member matches without stripping generic structure first', () => {
    const indexes = buildResolutionIndexes([
      decl('owner:repo', 'RepoOwner', { type: { kind: 'generic-application', text: 'Repo<User>', name: 'Repo', arguments: [{ kind: 'nominal', text: 'User', name: 'User' }] } }),
      decl('member:save', 'save', { ownerRef: 'owner:repo' }),
    ]);

    const direct = resolveReceiverType(indexes, {
      referenceId: 'ref-generic',
      filePath: 'src/app.ts',
      name: 'save',
      receiverType: { kind: 'generic-application', text: 'Repo<User>', name: 'Repo', arguments: [{ kind: 'nominal', text: 'User', name: 'User' }] },
    });
    assert.equal(direct.length, 1);
    assert.equal(direct[0]?.targetId, 'member:save');

    const outcome = resolveReference(indexes, {
      referenceId: 'ref-generic-2',
      filePath: 'src/app.ts',
      name: 'save',
      receiverType: { kind: 'generic-application', text: 'Repo<User>', name: 'Repo', arguments: [{ kind: 'nominal', text: 'User', name: 'User' }] },
    });
    assert.equal(outcome.certainty, 'exact');
  });

  it('resolves imports through public surfaces and bounded re-exports', () => {
    const facts: SemanticFact[] = [
      {
        factId: 'decl:foo', language: Language.TypeScript, filePath: 'src/lib.ts', sourceRange: range,
        declarationKind: 'function', name: 'foo', qualifiedName: 'src/lib.ts:foo', anchors: { identity: range, render: range },
      },
      {
        factId: 'pub:foo', language: Language.TypeScript, filePath: 'src/lib.ts', sourceRange: range,
        moduleRef: './lib', publicName: 'foo', sourceRef: 'decl:foo', publicationKind: 'definition',
      },
      {
        factId: 'pub:re', language: Language.TypeScript, filePath: 'src/index.ts', sourceRange: range,
        moduleRef: './index', publicName: 'foo', sourceRef: './lib', publicationKind: 'reexport',
      },
      {
        factId: 'imp:foo', language: Language.TypeScript, filePath: 'src/app.ts', sourceRange: range,
        sourceModule: './index', importedName: 'foo', localName: 'foo', bindingKind: 'named',
      },
    ];
    const indexes = buildResolutionIndexes(facts);

    const surface = resolvePublicSurface(indexes, { referenceId: 'ref1', filePath: 'src/app.ts', name: 'foo', moduleRef: './index' });
    assert.equal(surface.length, 1);
    assert.equal(surface[0]?.targetId, 'decl:foo');

    const imported = resolveImportBinding(indexes, { referenceId: 'ref2', filePath: 'src/app.ts', name: 'foo', localName: 'foo' });
    assert.equal(imported.length, 1);
    assert.equal(imported[0]?.strategy, 'import-binding');
  });

  it('falls back heuristically on same-name global declarations only after stronger strategies fail', () => {
    const indexes = buildResolutionIndexes([
      decl('decl:a', 'same'),
      { ...decl('decl:b', 'same'), filePath: 'src/other.ts', qualifiedName: 'src/other.ts:same' },
    ]);

    const outcome = resolveReference(indexes, { referenceId: 'ref3', filePath: 'src/app.ts', name: 'same' });
    assert.equal(outcome.certainty, 'heuristic');
    assert.equal(outcome.coverage.complete, false);
    assert.equal(indexes.instrumentation.fullWorkspaceTraversalCount, 1);
  });

  it('does not pick unrelated same-name target when receiver evidence exists', () => {
    const indexes = buildResolutionIndexes([
      decl('owner:repo', 'RepoOwner', { type: { kind: 'nominal', text: 'Repo', name: 'Repo' } }),
      decl('owner:other', 'OtherOwner', { type: { kind: 'nominal', text: 'Other', name: 'Other' } }),
      decl('member:repo:save', 'save', { ownerRef: 'owner:repo' }),
      decl('member:other:save', 'save', { ownerRef: 'owner:other' }),
    ]);

    const outcome = resolveReference(indexes, {
      referenceId: 'ref-forbidden',
      filePath: 'src/app.ts',
      name: 'save',
      receiverType: { kind: 'nominal', text: 'Repo', name: 'Repo' },
    });

    assert.equal(outcome.certainty, 'exact');
    assert.deepEqual(outcome.candidates.map((item) => item.targetId), ['member:repo:save']);
  });

  it('preserves Python-style ambiguous publication as candidate-set', () => {
    const facts: SemanticFact[] = [
      decl('decl:user:one', 'UserService', { qualifiedName: 'pkg/a.py:UserService' }),
      { ...decl('decl:user:two', 'UserService', { qualifiedName: 'pkg/b.py:UserService' }), filePath: 'pkg/b.py' },
      { factId: 'pub:a', language: Language.Python, filePath: 'pkg/__init__.py', sourceRange: range, moduleRef: 'pkg', publicName: 'UserService', sourceRef: 'decl:user:one', publicationKind: 'definition' } as SemanticFact,
      { factId: 'pub:b', language: Language.Python, filePath: 'pkg/__init__.py', sourceRange: range, moduleRef: 'pkg', publicName: 'UserService', sourceRef: 'decl:user:two', publicationKind: 'definition' } as SemanticFact,
    ];
    const indexes = buildResolutionIndexes(facts);
    const outcome = resolveReference(indexes, { referenceId: 'py-ambiguous', filePath: 'pkg/client.py', name: 'UserService', moduleRef: 'pkg' });

    assert.equal(outcome.certainty, 'candidate-set');
    assert.deepEqual(outcome.candidates.map((item) => item.targetId).sort(), ['decl:user:one', 'decl:user:two']);
  });

  it('keeps unresolved outcomes non-exact when no supported class proves absence', () => {
    const indexes = buildResolutionIndexes([]);
    const outcome = resolveReference(indexes, { referenceId: 'empty-proof', filePath: 'src/app.ts', name: 'ghost' });
    assert.equal(outcome.certainty, 'unresolved');
    assert.equal(outcome.coverage.complete, true);
    assert.equal(outcome.candidates.length, 0);
  });

  it('supports C# extension-style receiver dispatch', () => {
    const facts: SemanticFact[] = [
      decl('decl:user-service', 'UserService', { type: { kind: 'nominal', text: 'UserService', name: 'UserService' } }),
      decl('decl:describe', 'Describe', { ownerRef: 'decl:user-service' }),
    ];
    const indexes = buildResolutionIndexes(facts);
    const outcome = resolveReference(indexes, {
      referenceId: 'csharp-extension',
      filePath: 'UserService.cs',
      name: 'Describe',
      receiverType: { kind: 'nominal', text: 'UserService', name: 'UserService' },
    });

    assert.equal(outcome.certainty, 'exact');
    assert.deepEqual(outcome.candidates.map((item) => item.targetId), ['decl:describe']);
  });

  it('supports Go-style embedded promotion candidate sets', () => {
    const facts: SemanticFact[] = [
      decl('decl:base', 'Base', { type: { kind: 'nominal', text: 'Base', name: 'Base' } }),
      decl('decl:service', 'Service', { type: { kind: 'nominal', text: 'Service', name: 'Service' } }),
      { factId: 'herit:embed', language: Language.Go, filePath: 'service.go', sourceRange: range, declarationRef: 'decl:service', heritageKind: 'mixes-in', target: { kind: 'nominal', text: 'Base', name: 'Base' } } as SemanticFact,
      decl('member:base:start', 'Start', { ownerRef: 'decl:base' }),
    ];
    const indexes = buildResolutionIndexes(facts);
    const outcome = resolveInheritanceDispatch(indexes, {
      referenceId: 'go-dispatch',
      filePath: 'service.go',
      name: 'Start',
      receiverType: { kind: 'nominal', text: 'Base', name: 'Base' },
    });

    assert.ok(outcome);
    assert.equal(outcome?.certainty, 'exact');
    assert.deepEqual(outcome?.candidates.map((item) => item.targetId), ['member:base:start']);
  });

  it('returns truncated candidate-set metadata for bounded inheritance dispatch fan-out', () => {
    const facts: SemanticFact[] = [
      decl('decl:iface', 'Service', { type: { kind: 'nominal', text: 'Service', name: 'Service' } }),
      ...Array.from({ length: 4 }, (_, index) => decl(`impl:${index}`, `Impl${index}`)),
      ...Array.from({ length: 4 }, (_, index) => ({
        factId: `herit:${index}`,
        language: Language.TypeScript,
        filePath: 'src/app.ts',
        sourceRange: range,
        declarationRef: `impl:${index}`,
        heritageKind: 'implements' as const,
        target: { kind: 'nominal' as const, text: 'Service', name: 'Service' },
      } as SemanticFact)),
      ...Array.from({ length: 4 }, (_, index) => decl(`member:${index}`, 'run', { ownerRef: `impl:${index}` })),
    ];
    const indexes = buildResolutionIndexes(facts);
    const outcome = resolveInheritanceDispatch(indexes, {
      referenceId: 'dispatch-1',
      filePath: 'src/app.ts',
      name: 'run',
      receiverType: { kind: 'nominal', text: 'Service', name: 'Service' },
      dispatchLimit: 2,
    });

    assert.ok(outcome);
    assert.equal(outcome?.certainty, 'truncated');
    assert.equal(outcome?.coverage.complete, false);
    assert.equal(outcome?.coverage.totalKnownCandidates, 4);
    assert.equal(outcome?.coverage.emittedCandidates, 2);
    assert.deepEqual(outcome?.coverage.incompleteReasons, ['dispatch-candidate-limit']);
  });

  it('resolves registration and event-style dispatch from proven static facts', () => {
    const facts: SemanticFact[] = [
      decl('decl:handler', 'handleClick'),
      {
        factId: 'reg:click',
        language: Language.TypeScript,
        filePath: 'src/app.ts',
        sourceRange: range,
        registrationKind: 'event',
        subjectRef: 'decl:handler',
        targetText: 'click',
      },
    ];
    const indexes = buildResolutionIndexes(facts);

    const direct = resolveRegistrationDispatch(indexes, { referenceId: 'ref-reg', filePath: 'src/app.ts', name: 'click' });
    assert.equal(direct.length, 1);
    assert.equal(direct[0]?.targetId, 'decl:handler');

    const outcome = resolveReference(indexes, { referenceId: 'ref-reg-2', filePath: 'src/app.ts', name: 'click' });
    assert.equal(outcome.certainty, 'exact');
  });

  it('stops re-export traversal on cycles', () => {
    const facts: SemanticFact[] = [
      {
        factId: 'pub:a', language: Language.TypeScript, filePath: 'src/a.ts', sourceRange: range,
        moduleRef: './a', publicName: 'foo', sourceRef: './b', publicationKind: 'reexport',
      },
      {
        factId: 'pub:b', language: Language.TypeScript, filePath: 'src/b.ts', sourceRange: range,
        moduleRef: './b', publicName: 'foo', sourceRef: './a', publicationKind: 'reexport',
      },
    ];
    const indexes = buildResolutionIndexes(facts);
    const surface = resolvePublicSurface(indexes, { referenceId: 'ref4', filePath: 'src/app.ts', name: 'foo', moduleRef: './a', maxDepth: 4 });
    assert.deepEqual(surface, []);
  });
});
