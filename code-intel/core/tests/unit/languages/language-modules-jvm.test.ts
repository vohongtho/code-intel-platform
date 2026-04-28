import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { javaModule } from '../../../src/languages/modules/java.js';
import { rustModule } from '../../../src/languages/modules/rust.js';
import { kotlinModule } from '../../../src/languages/modules/kotlin.js';
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
    text: string;
    childForFieldName: (name: string) => { text: string } | null;
  }> = {},
): Node {
  return {
    text: '',
    childForFieldName: (_name: string) => null,
    ...overrides,
  } as unknown as Node;
}

// ── Java module ───────────────────────────────────────────────────────────────

describe('javaModule', () => {
  it('has lang "java"', () => {
    assert.equal(javaModule.lang, 'java');
  });

  it('has .java in fileExtensions', () => {
    assert.ok(javaModule.fileExtensions.includes('.java'));
  });

  it('importStyle is explicit', () => {
    assert.equal(javaModule.importStyle, 'explicit');
  });

  it('inheritanceStrategy is depth-first', () => {
    assert.equal(javaModule.inheritanceStrategy, 'depth-first');
  });

  it('resolveImport — converts dotted package to file path', () => {
    const ws = makeFileSet(['/src/com/example/MyClass.java']);
    const result = javaModule.resolveImport('com.example.MyClass', '/src/Main.java', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('MyClass'));
  });

  it('resolveImport — returns null for unknown package', () => {
    const ws = makeFileSet([]);
    const result = javaModule.resolveImport('unknown.Class', '/src/Main.java', ws);
    assert.equal(result, null);
  });

  it('isExported — returns true for "public" node text', () => {
    const node = makeNode({ text: 'public class MyClass {}' });
    assert.equal(javaModule.isExported(node), true);
  });

  it('isExported — returns false for non-public node text', () => {
    const node = makeNode({ text: 'private void doWork() {}' });
    assert.equal(javaModule.isExported(node), false);
  });

  it('extractType — returns null when no type field', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(javaModule.extractType(node), null);
  });

  it('extractType — returns type text when present', () => {
    const node = makeNode({ childForFieldName: (n) => n === 'type' ? { text: 'String' } : null });
    assert.equal(javaModule.extractType(node), 'String');
  });
});

// ── Rust module ───────────────────────────────────────────────────────────────

describe('rustModule', () => {
  it('has lang "rust"', () => {
    assert.equal(rustModule.lang, 'rust');
  });

  it('has .rs in fileExtensions', () => {
    assert.ok(rustModule.fileExtensions.includes('.rs'));
  });

  it('importStyle is explicit', () => {
    assert.equal(rustModule.importStyle, 'explicit');
  });

  it('inheritanceStrategy is none', () => {
    assert.equal(rustModule.inheritanceStrategy, 'none');
  });

  it('resolveImport — converts :: path to file path', () => {
    const ws = makeFileSet(['/src/utils/helper.rs']);
    const result = rustModule.resolveImport('utils::helper', '/src/main.rs', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('helper'));
  });

  it('resolveImport — returns null for unknown crate path', () => {
    const ws = makeFileSet([]);
    const result = rustModule.resolveImport('unknown::module', '/src/main.rs', ws);
    assert.equal(result, null);
  });

  it('isExported — returns true for "pub " prefix', () => {
    const node = makeNode({ text: 'pub fn my_func() {}' });
    assert.equal(rustModule.isExported(node), true);
  });

  it('isExported — returns true for "pub(" prefix (pub(crate))', () => {
    const node = makeNode({ text: 'pub(crate) fn internal() {}' });
    assert.equal(rustModule.isExported(node), true);
  });

  it('isExported — returns false for private fn', () => {
    const node = makeNode({ text: 'fn private_func() {}' });
    assert.equal(rustModule.isExported(node), false);
  });

  it('extractType — returns null when no return_type field', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(rustModule.extractType(node), null);
  });

  it('extractType — returns return type text when present', () => {
    const node = makeNode({ childForFieldName: (n) => n === 'return_type' ? { text: 'Result<(), Error>' } : null });
    assert.equal(rustModule.extractType(node), 'Result<(), Error>');
  });
});

// ── Kotlin module ─────────────────────────────────────────────────────────────

describe('kotlinModule', () => {
  it('has lang "kotlin"', () => {
    assert.equal(kotlinModule.lang, 'kotlin');
  });

  it('has .kt in fileExtensions', () => {
    assert.ok(kotlinModule.fileExtensions.includes('.kt'));
  });

  it('has .kts in fileExtensions', () => {
    assert.ok(kotlinModule.fileExtensions.includes('.kts'));
  });

  it('importStyle is explicit', () => {
    assert.equal(kotlinModule.importStyle, 'explicit');
  });

  it('inheritanceStrategy is depth-first', () => {
    assert.equal(kotlinModule.inheritanceStrategy, 'depth-first');
  });

  it('resolveImport — converts dotted package to .kt file path', () => {
    const ws = makeFileSet(['/src/com/example/MyClass.kt']);
    const result = kotlinModule.resolveImport('com.example.MyClass', '/src/Main.kt', ws);
    assert.ok(result !== null);
    assert.ok(result!.includes('MyClass'));
  });

  it('resolveImport — returns null for unknown package', () => {
    const ws = makeFileSet([]);
    const result = kotlinModule.resolveImport('unknown.Class', '/src/Main.kt', ws);
    assert.equal(result, null);
  });

  it('isExported — returns true for public function', () => {
    const node = makeNode({ text: 'fun myFunc(): String {}' });
    assert.equal(kotlinModule.isExported(node), true);
  });

  it('isExported — returns false for private function', () => {
    const node = makeNode({ text: 'private fun myFunc(): String {}' });
    assert.equal(kotlinModule.isExported(node), false);
  });

  it('isExported — returns false for internal function', () => {
    const node = makeNode({ text: 'internal fun myFunc(): String {}' });
    assert.equal(kotlinModule.isExported(node), false);
  });

  it('extractType — returns null when no type field', () => {
    const node = makeNode({ childForFieldName: () => null });
    assert.equal(kotlinModule.extractType(node), null);
  });

  it('extractType — returns type text when present', () => {
    const node = makeNode({ childForFieldName: (n) => n === 'type' ? { text: 'String' } : null });
    assert.equal(kotlinModule.extractType(node), 'String');
  });
});
