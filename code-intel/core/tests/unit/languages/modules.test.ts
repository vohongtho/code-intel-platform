import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { typescriptModule, javascriptModule } from '../../../src/languages/modules/typescript.js';
import { pythonModule } from '../../../src/languages/modules/python.js';
import type { FileSet } from '../../../src/languages/types.js';
import type { Node } from 'web-tree-sitter';

function makeFileSet(files: string[]): FileSet {
  const set = new Set(files);
  return {
    has: (f) => set.has(f),
    resolve: (_fromDir: string, rel: string) => files.find((f) => f.endsWith(rel.replace(/^\.\//, ''))) ?? null,
    findByPackage: (pkg: string) => files.find((f) => f.includes(pkg)) ?? null,
  };
}

function makeNode(overrides: Partial<{ type: string; parent: Partial<{ type: string }> | null; childForFieldName: (name: string) => { text: string } | null }> = {}): Node {
  return {
    type: 'function_declaration',
    parent: null,
    childForFieldName: (_name: string) => null,
    ...overrides,
  } as unknown as Node;
}

// ── TypeScript module ─────────────────────────────────────────────────────────

describe('typescriptModule', () => {
  it('has correct lang', () => {
    assert.equal(typescriptModule.lang, 'typescript');
  });

  it('has .ts in fileExtensions', () => {
    assert.ok(typescriptModule.fileExtensions.includes('.ts'));
  });

  it('has .tsx in fileExtensions', () => {
    assert.ok(typescriptModule.fileExtensions.includes('.tsx'));
  });

  it('importStyle is explicit', () => {
    assert.equal(typescriptModule.importStyle, 'explicit');
  });

  it('inheritanceStrategy is depth-first', () => {
    assert.equal(typescriptModule.inheritanceStrategy, 'depth-first');
  });

  it('resolveImport — resolves relative path', () => {
    const ws = makeFileSet(['/src/utils.ts']);
    const result = typescriptModule.resolveImport('./utils.ts', '/src/main.ts', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('utils'));
  });

  it('resolveImport — returns null for unresolvable relative path', () => {
    const ws = makeFileSet([]);
    const result = typescriptModule.resolveImport('./nonexistent', '/src/main.ts', ws);
    assert.equal(result, null);
  });

  it('resolveImport — resolves package via findByPackage', () => {
    const ws = makeFileSet(['/node_modules/lodash/index.ts']);
    const result = typescriptModule.resolveImport('lodash', '/src/main.ts', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('lodash'));
  });

  it('resolveImport — returns null for unknown package', () => {
    const ws = makeFileSet([]);
    const result = typescriptModule.resolveImport('unknown-pkg', '/src/main.ts', ws);
    assert.equal(result, null);
  });

  it('isExported — returns true when parent is export_statement', () => {
    const node = makeNode({ parent: { type: 'export_statement' } });
    assert.equal(typescriptModule.isExported(node), true);
  });

  it('isExported — returns false when no parent', () => {
    const node = makeNode({ parent: null });
    assert.equal(typescriptModule.isExported(node), false);
  });

  it('isExported — returns false for non-export parent', () => {
    const node = makeNode({ parent: { type: 'program' } });
    assert.equal(typescriptModule.isExported(node), false);
  });

  it('extractType — returns null when no type annotation', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(typescriptModule.extractType(node), null);
  });

  it('extractType — returns type text when annotation exists', () => {
    const node = makeNode({ childForFieldName: (name) => name === 'type' ? { text: 'string' } : null });
    assert.equal(typescriptModule.extractType(node), 'string');
  });
});

// ── JavaScript module (extends TypeScript) ────────────────────────────────────

describe('javascriptModule', () => {
  it('has correct lang', () => {
    assert.equal(javascriptModule.lang, 'javascript');
  });

  it('has .js in fileExtensions', () => {
    assert.ok(javascriptModule.fileExtensions.includes('.js'));
  });

  it('has .jsx in fileExtensions', () => {
    assert.ok(javascriptModule.fileExtensions.includes('.jsx'));
  });

  it('importStyle is explicit', () => {
    assert.equal(javascriptModule.importStyle, 'explicit');
  });

  it('resolveImport — resolves relative path', () => {
    const ws = makeFileSet(['/src/helper.js']);
    const result = javascriptModule.resolveImport('./helper.js', '/src/main.js', ws);
    assert.ok(result !== null);
  });
});

// ── Python module ─────────────────────────────────────────────────────────────

describe('pythonModule', () => {
  it('has correct lang', () => {
    assert.equal(pythonModule.lang, 'python');
  });

  it('has .py in fileExtensions', () => {
    assert.ok(pythonModule.fileExtensions.includes('.py'));
  });

  it('importStyle is namespace', () => {
    assert.equal(pythonModule.importStyle, 'namespace');
  });

  it('inheritanceStrategy is c3', () => {
    assert.equal(pythonModule.inheritanceStrategy, 'c3');
  });

  it('resolveImport — resolves dotted package as __init__.py', () => {
    const ws = makeFileSet(['/src/mypackage/__init__.py']);
    const result = pythonModule.resolveImport('mypackage', '/src/main.py', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('mypackage'));
  });

  it('resolveImport — resolves dotted module as .py file', () => {
    const ws = makeFileSet(['/src/mymodule.py']);
    const result = pythonModule.resolveImport('mymodule', '/src/main.py', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('mymodule'));
  });

  it('resolveImport — returns null for unresolvable import', () => {
    const ws = makeFileSet([]);
    const result = pythonModule.resolveImport('nothing', '/src/main.py', ws);
    assert.equal(result, null);
  });

  it('isExported — returns true for public names', () => {
    const node = makeNode({ childForFieldName: (name) => name === 'name' ? { text: 'public_func' } : null });
    assert.equal(pythonModule.isExported(node), true);
  });

  it('isExported — returns false for names starting with _', () => {
    const node = makeNode({ childForFieldName: (name) => name === 'name' ? { text: '_private' } : null });
    assert.equal(pythonModule.isExported(node), false);
  });

  it('isExported — returns true when no name field', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(pythonModule.isExported(node), true);
  });

  it('extractType — returns null when no return_type', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(pythonModule.extractType(node), null);
  });

  it('extractType — returns type text when return_type exists', () => {
    const node = makeNode({ childForFieldName: (name) => name === 'return_type' ? { text: 'int' } : null });
    assert.equal(pythonModule.extractType(node), 'int');
  });
});
