import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BindingTracker } from '../../../src/resolver/binding-tracker.js';
import { resolveImports } from '../../../src/resolver/import-resolver.js';
import type { LanguageModule, FileSet } from '../../../src/languages/types.js';

// ── BindingTracker ────────────────────────────────────────────────────────────

describe('BindingTracker', () => {
  it('addBinding + getBinding — round-trip', () => {
    const tracker = new BindingTracker();
    tracker.addBinding('/a/foo.ts', {
      localName: 'Foo',
      sourcePath: '/a/lib.ts',
      exportedName: 'Foo',
      isDefault: false,
      isNamespace: false,
    });
    const b = tracker.getBinding('/a/foo.ts', 'Foo');
    assert.ok(b !== undefined);
    assert.equal(b!.sourcePath, '/a/lib.ts');
  });

  it('getBinding — returns undefined for unknown file', () => {
    const tracker = new BindingTracker();
    assert.equal(tracker.getBinding('/nowhere.ts', 'X'), undefined);
  });

  it('getBinding — returns undefined for unknown local name', () => {
    const tracker = new BindingTracker();
    tracker.addBinding('/a.ts', {
      localName: 'A',
      sourcePath: '/b.ts',
      exportedName: 'A',
      isDefault: false,
      isNamespace: false,
    });
    assert.equal(tracker.getBinding('/a.ts', 'B'), undefined);
  });

  it('getFileBindings — returns all bindings for a file', () => {
    const tracker = new BindingTracker();
    tracker.addBinding('/a.ts', {
      localName: 'X',
      sourcePath: '/lib.ts',
      exportedName: 'X',
      isDefault: false,
      isNamespace: false,
    });
    tracker.addBinding('/a.ts', {
      localName: 'Y',
      sourcePath: '/lib.ts',
      exportedName: 'Y',
      isDefault: false,
      isNamespace: false,
    });
    const bindings = tracker.getFileBindings('/a.ts');
    assert.equal(bindings.length, 2);
    assert.ok(bindings.some((b) => b.localName === 'X'));
    assert.ok(bindings.some((b) => b.localName === 'Y'));
  });

  it('getFileBindings — returns empty array for unknown file', () => {
    const tracker = new BindingTracker();
    assert.deepEqual(tracker.getFileBindings('/unknown.ts'), []);
  });

  it('clear — removes all bindings', () => {
    const tracker = new BindingTracker();
    tracker.addBinding('/a.ts', {
      localName: 'Z',
      sourcePath: '/b.ts',
      exportedName: 'Z',
      isDefault: false,
      isNamespace: false,
    });
    tracker.clear();
    assert.deepEqual(tracker.getFileBindings('/a.ts'), []);
  });

  it('addBinding — overrides previous binding with same localName', () => {
    const tracker = new BindingTracker();
    tracker.addBinding('/a.ts', {
      localName: 'X',
      sourcePath: '/first.ts',
      exportedName: 'X',
      isDefault: false,
      isNamespace: false,
    });
    tracker.addBinding('/a.ts', {
      localName: 'X',
      sourcePath: '/second.ts',
      exportedName: 'X',
      isDefault: false,
      isNamespace: false,
    });
    const b = tracker.getBinding('/a.ts', 'X');
    assert.equal(b!.sourcePath, '/second.ts');
  });
});

// ── resolveImports ────────────────────────────────────────────────────────────

function makeMockLangModule(resolvedPath: string | null): LanguageModule {
  return {
    lang: 'typescript',
    fileExtensions: ['.ts'],
    queries: '',
    importStyle: 'explicit',
    inheritanceStrategy: 'single',
    isExported: () => false,
    extractType: () => null,
    resolveImport: () => resolvedPath,
  } as unknown as LanguageModule;
}

function makeFileSet(files: string[]): FileSet {
  const set = new Set(files);
  return {
    has: (f: string) => set.has(f),
    resolve: (_fromDir: string, rel: string) => files.find((f) => f.endsWith(rel)) ?? null,
    findByPackage: () => null,
  };
}

describe('resolveImports', () => {
  it('creates import edges for resolvable imports', () => {
    const lang = makeMockLangModule('/repo/src/lib.ts');
    const workspace = makeFileSet(['/repo/src/lib.ts']);

    const result = resolveImports(
      '/repo/src/main.ts',
      'file:/repo/src/main.ts:/repo/src/main.ts',
      [{ rawPath: './lib', localNames: ['Foo'], isDefault: false, isNamespace: false }],
      lang,
      workspace,
    );

    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0]!.kind, 'imports');
    assert.equal(result.edges[0]!.label, './lib');
  });

  it('skips unresolvable imports', () => {
    const lang = makeMockLangModule(null);
    const workspace = makeFileSet([]);

    const result = resolveImports(
      '/repo/src/main.ts',
      'file:/repo/src/main.ts:/repo/src/main.ts',
      [{ rawPath: 'some-npm-package', localNames: ['foo'], isDefault: false, isNamespace: false }],
      lang,
      workspace,
    );

    assert.equal(result.edges.length, 0);
  });

  it('creates bindings for all local names', () => {
    const lang = makeMockLangModule('/repo/src/utils.ts');
    const workspace = makeFileSet(['/repo/src/utils.ts']);

    const result = resolveImports(
      '/repo/src/main.ts',
      'file:/repo/src/main.ts:/repo/src/main.ts',
      [{ rawPath: './utils', localNames: ['a', 'b', 'c'], isDefault: false, isNamespace: false }],
      lang,
      workspace,
    );

    const bindings = result.bindings.getFileBindings('/repo/src/main.ts');
    assert.equal(bindings.length, 3);
  });

  it('handles empty imports array', () => {
    const lang = makeMockLangModule('/repo/src/lib.ts');
    const workspace = makeFileSet([]);
    const result = resolveImports('/a.ts', 'file:/a.ts:/a.ts', [], lang, workspace);
    assert.equal(result.edges.length, 0);
  });

  it('handles namespace imports', () => {
    const lang = makeMockLangModule('/repo/src/ns.ts');
    const workspace = makeFileSet(['/repo/src/ns.ts']);
    const result = resolveImports(
      '/repo/src/main.ts',
      'file:/repo/src/main.ts:/repo/src/main.ts',
      [{ rawPath: './ns', localNames: ['NS'], isDefault: false, isNamespace: true, namespaceName: 'NS' }],
      lang,
      workspace,
    );
    assert.equal(result.edges.length, 1);
    const binding = result.bindings.getBinding('/repo/src/main.ts', 'NS');
    assert.ok(binding !== undefined);
    assert.equal(binding!.isNamespace, true);
  });
});
