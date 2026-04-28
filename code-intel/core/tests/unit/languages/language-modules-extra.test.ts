import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cModule } from '../../../src/languages/modules/c.js';
import { goModule } from '../../../src/languages/modules/go.js';
import { dartModule } from '../../../src/languages/modules/dart.js';
import type { FileSet } from '../../../src/languages/types.js';
import type { Node } from 'web-tree-sitter';

function makeFileSet(files: string[]): FileSet {
  return {
    has: (f) => files.includes(f),
    resolve: (_fromDir: string, rel: string) =>
      files.find((f) => f.endsWith(rel.replace(/^\.\//, ''))) ?? null,
    findByPackage: (pkg: string) =>
      files.find((f) => f.includes(pkg)) ?? null,
  };
}

function makeNode(
  overrides: Partial<{
    type: string;
    parent: Partial<{ type: string }> | null;
    childForFieldName: (name: string) => { text: string } | null;
  }> = {},
): Node {
  return {
    type: 'identifier',
    parent: null,
    childForFieldName: (_name: string) => null,
    ...overrides,
  } as unknown as Node;
}

// ── C module ──────────────────────────────────────────────────────────────────

describe('cModule', () => {
  it('has lang "c"', () => {
    assert.equal(cModule.lang, 'c');
  });

  it('has .c and .h in fileExtensions', () => {
    assert.ok(cModule.fileExtensions.includes('.c'));
    assert.ok(cModule.fileExtensions.includes('.h'));
  });

  it('importStyle is include', () => {
    assert.equal(cModule.importStyle, 'include');
  });

  it('inheritanceStrategy is none', () => {
    assert.equal(cModule.inheritanceStrategy, 'none');
  });

  it('resolveImport — strips angle brackets and resolves', () => {
    const ws = makeFileSet(['/src/utils.h']);
    const result = cModule.resolveImport('<utils.h>', '/src/main.c', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('utils'));
  });

  it('resolveImport — strips double quotes', () => {
    const ws = makeFileSet(['/src/helper.h']);
    const result = cModule.resolveImport('"helper.h"', '/src/main.c', ws);
    assert.ok(result !== null);
  });

  it('resolveImport — returns null for unresolvable include', () => {
    const ws = makeFileSet([]);
    const result = cModule.resolveImport('<stdio.h>', '/src/main.c', ws);
    assert.equal(result, null);
  });

  it('isExported — always returns true', () => {
    const node = makeNode();
    assert.equal(cModule.isExported(node), true);
  });

  it('extractType — returns null when no type field', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(cModule.extractType(node), null);
  });

  it('extractType — returns type text when field exists', () => {
    const node = makeNode({ childForFieldName: (name) => name === 'type' ? { text: 'int' } : null });
    assert.equal(cModule.extractType(node), 'int');
  });
});

// ── Go module ─────────────────────────────────────────────────────────────────

describe('goModule', () => {
  it('has lang "go"', () => {
    assert.equal(goModule.lang, 'go');
  });

  it('has .go in fileExtensions', () => {
    assert.ok(goModule.fileExtensions.includes('.go'));
  });

  it('importStyle is wildcard', () => {
    assert.equal(goModule.importStyle, 'wildcard');
  });

  it('resolveImport — strips quotes and calls findByPackage', () => {
    const ws = makeFileSet(['/go/pkg/fmt/fmt.go']);
    const result = goModule.resolveImport('"fmt"', '/src/main.go', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('fmt'));
  });

  it('resolveImport — returns null for unknown package', () => {
    const ws = makeFileSet([]);
    const result = goModule.resolveImport('"unknown/pkg"', '/src/main.go', ws);
    assert.equal(result, null);
  });

  it('isExported — returns true for PascalCase name', () => {
    const node = makeNode({ childForFieldName: (n) => n === 'name' ? { text: 'MyFunc' } : null });
    assert.equal(goModule.isExported(node), true);
  });

  it('isExported — returns false for lowercase name', () => {
    const node = makeNode({ childForFieldName: (n) => n === 'name' ? { text: 'myFunc' } : null });
    assert.equal(goModule.isExported(node), false);
  });

  it('isExported — returns false when no name field', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(goModule.isExported(node), false);
  });

  it('extractType — returns null when no type field', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(goModule.extractType(node), null);
  });

  it('extractType — returns type text when present', () => {
    const node = makeNode({ childForFieldName: (n) => n === 'type' ? { text: 'string' } : null });
    assert.equal(goModule.extractType(node), 'string');
  });
});

// ── Dart module ───────────────────────────────────────────────────────────────

describe('dartModule', () => {
  it('has lang "dart"', () => {
    assert.equal(dartModule.lang, 'dart');
  });

  it('has .dart in fileExtensions', () => {
    assert.ok(dartModule.fileExtensions.includes('.dart'));
  });

  it('importStyle is wildcard', () => {
    assert.equal(dartModule.importStyle, 'wildcard');
  });

  it('inheritanceStrategy is depth-first', () => {
    assert.equal(dartModule.inheritanceStrategy, 'depth-first');
  });

  it('resolveImport — resolves package: import via findByPackage', () => {
    const ws = makeFileSet(['/lib/flutter/flutter.dart']);
    const result = dartModule.resolveImport('package:flutter/flutter.dart', '/lib/main.dart', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('flutter'));
  });

  it('resolveImport — resolves relative path', () => {
    const ws = makeFileSet(['/lib/utils.dart']);
    const result = dartModule.resolveImport('./utils.dart', '/lib/main.dart', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('utils'));
  });

  it('resolveImport — returns null for unknown package', () => {
    const ws = makeFileSet([]);
    const result = dartModule.resolveImport('package:unknown/lib.dart', '/lib/main.dart', ws);
    assert.equal(result, null);
  });

  it('isExported — returns true for public names', () => {
    const node = makeNode({ childForFieldName: (n) => n === 'name' ? { text: 'MyWidget' } : null });
    assert.equal(dartModule.isExported(node), true);
  });

  it('isExported — returns false for private names (starts with _)', () => {
    const node = makeNode({ childForFieldName: (n) => n === 'name' ? { text: '_internalState' } : null });
    assert.equal(dartModule.isExported(node), false);
  });

  it('isExported — returns true when no name field', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(dartModule.isExported(node), true);
  });

  it('extractType — returns null when no type field', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(dartModule.extractType(node), null);
  });

  it('extractType — returns type text when present', () => {
    const node = makeNode({ childForFieldName: (n) => n === 'type' ? { text: 'Widget' } : null });
    assert.equal(dartModule.extractType(node), 'Widget');
  });
});
