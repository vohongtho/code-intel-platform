import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectExactRenameOccurrences, isGeneratedPath, languageForPath } from '../../../src/refactoring/edit-spans.js';
import type { RenameOccurrence } from '../../../src/refactoring/contracts.js';

function ctx(files: Record<string, string>, hasPathAliases = false) {
  return {
    files: new Set(Object.keys(files)),
    readFile: (filePath: string) => {
      const text = files[filePath];
      if (text === undefined) throw new Error(`missing fixture ${filePath}`);
      return text;
    },
    hasPathAliases,
  };
}

function exact(occurrences: RenameOccurrence[]) {
  return occurrences.filter((o) => o.category === 'exact-definition' || o.category === 'exact-semantic');
}

function at(files: Record<string, string>, o: RenameOccurrence): string {
  return files[o.filePath].slice(o.startOffset, o.endOffset);
}

describe('edit-spans — language and generated detection', () => {
  it('maps TS/JS extensions only', () => {
    assert.equal(languageForPath('a/b.ts'), 'typescript');
    assert.equal(languageForPath('a/b.mjs'), 'javascript');
    assert.equal(languageForPath('a/b.py'), null);
  });
  it('flags generated and vendored paths', () => {
    assert.equal(isGeneratedPath('node_modules/x/index.js'), true);
    assert.equal(isGeneratedPath('src/api.generated.ts'), true);
    assert.equal(isGeneratedPath('types/global.d.ts'), true);
    assert.equal(isGeneratedPath('src/service.ts'), false);
  });
});

describe('edit-spans — module-scope rename', () => {
  it('renames definition, named imports, aliased imports, re-exports and namespace members', async () => {
    const files = {
      'src/user.ts': 'export class UserService {\n  run(): UserService { return this; }\n}\nexport const make = () => new UserService();\n',
      'src/use.ts': "import { UserService } from './user.js';\nconst s: UserService = new UserService();\n",
      'src/alias.ts': "import { UserService as US } from './user';\nexport const t = new US();\n",
      'src/barrel.ts': "export { UserService } from './user.js';\n",
      'src/via-barrel.ts': "import { UserService } from './barrel.js';\nnew UserService();\n",
      'src/ns.ts': "import * as users from './user.js';\nnew users.UserService();\n",
    };
    const result = await collectExactRenameOccurrences({ filePath: 'src/user.ts', name: 'UserService', line: 1 }, 'AccountService', ctx(files));
    assert.equal(result.moduleScope, true);
    assert.deepEqual(result.boundaries, []);
    const edits = exact(result.occurrences);
    for (const o of edits) assert.equal(at(files, o), 'UserService');
    const byFile = (f: string) => edits.filter((o) => o.filePath === f).length;
    assert.equal(byFile('src/user.ts'), 3);
    assert.equal(byFile('src/use.ts'), 3);
    // The aliased import renames only the imported name; the local alias `US` stays.
    assert.equal(byFile('src/alias.ts'), 1);
    assert.equal(edits.find((o) => o.filePath === 'src/alias.ts')?.role, 'import-specifier');
    assert.equal(byFile('src/barrel.ts'), 1);
    assert.equal(byFile('src/via-barrel.ts'), 2);
    assert.equal(edits.find((o) => o.filePath === 'src/ns.ts')?.role, 'namespace-member');
    assert.deepEqual(result.editedFiles, ['src/alias.ts', 'src/barrel.ts', 'src/ns.ts', 'src/use.ts', 'src/user.ts', 'src/via-barrel.ts']);
  });

  it('follows `export *` barrels but stops at an aliased re-export', async () => {
    const files = {
      'src/a.ts': 'export function load() {}\n',
      'src/index.ts': "export * from './a.js';\n",
      'src/renamed.ts': "export { load as fetchAll } from './a.js';\n",
      'src/c.ts': "import { load } from './index.js';\nload();\n",
      'src/d.ts': "import { fetchAll } from './renamed.js';\nfetchAll();\n",
    };
    const result = await collectExactRenameOccurrences({ filePath: 'src/a.ts', name: 'load', line: 1 }, 'loadAll', ctx(files));
    const files_ = new Set(exact(result.occurrences).map((o) => o.filePath));
    assert.ok(files_.has('src/c.ts'));
    assert.ok(files_.has('src/renamed.ts'), 'the imported side of an aliased re-export is renamed');
    assert.ok(!files_.has('src/d.ts'), 'consumers of the alias are untouched');
  });

  it('does not touch shadowing locals, parameters or same-named symbols in other modules', async () => {
    const files = {
      'src/a.ts': 'export function load() {}\nfunction other(load: number) { return load + 1; }\nfunction third() { const load = 2; return load; }\nload();\n',
      'src/b.ts': 'export function load() {}\nload();\n',
      'src/c.ts': "import { load } from './b.js';\nload();\n",
    };
    const result = await collectExactRenameOccurrences({ filePath: 'src/a.ts', name: 'load', line: 1 }, 'loadAll', ctx(files));
    const edits = exact(result.occurrences);
    assert.deepEqual(edits.map((o) => `${o.filePath}:${o.range.startLine}`), ['src/a.ts:1', 'src/a.ts:4']);
  });

  it('reports strings, comments and unrelated properties as candidates, never edits', async () => {
    const files = {
      'src/a.ts': "// UserService is the entry point\nexport class UserService {}\nconst cfg = { name: 'UserService' };\nconst o = { UserService: 1 };\nother.UserService;\n",
    };
    const result = await collectExactRenameOccurrences({ filePath: 'src/a.ts', name: 'UserService', line: 2 }, 'AccountService', ctx(files));
    assert.equal(exact(result.occurrences).length, 1);
    const candidates = result.occurrences.filter((o) => o.category === 'candidate-text');
    assert.deepEqual(candidates.map((o) => o.role).sort(), ['comment', 'property', 'property', 'string']);
    for (const c of candidates) assert.equal(c.startOffset, undefined);
  });

  it('refuses members and locals as non-module-scope', async () => {
    const files = { 'src/a.ts': 'export class A {\n  run() {}\n}\n' };
    const result = await collectExactRenameOccurrences({ filePath: 'src/a.ts', name: 'run', line: 2 }, 'go', ctx(files));
    assert.equal(result.moduleScope, false);
    assert.equal(result.boundaries[0]?.kind, 'non-module-scope');
  });

  it('blocks overloads/merged declarations instead of splitting the binding', async () => {
    const files = { 'src/a.ts': 'export function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: unknown) {}\n' };
    const result = await collectExactRenameOccurrences({ filePath: 'src/a.ts', name: 'f', line: 3 }, 'g', ctx(files));
    assert.ok(result.boundaries.some((b) => b.kind === 'merged-declaration'));
  });

  it('blocks on name collision, shorthand properties, CommonJS loads and unresolved path aliases', async () => {
    const collision = await collectExactRenameOccurrences(
      { filePath: 'src/a.ts', name: 'load', line: 1 }, 'save',
      ctx({ 'src/a.ts': 'export function load() {}\nfunction save() {}\n' }),
    );
    assert.ok(collision.boundaries.some((b) => b.kind === 'name-collision'));

    const shorthand = await collectExactRenameOccurrences(
      { filePath: 'src/a.ts', name: 'load', line: 1 }, 'loadAll',
      ctx({ 'src/a.ts': 'export function load() {}\nexport const api = { load };\n' }),
    );
    assert.ok(shorthand.boundaries.some((b) => b.kind === 'unsupported-occurrence'));

    const cjs = await collectExactRenameOccurrences(
      { filePath: 'src/a.ts', name: 'load', line: 1 }, 'loadAll',
      ctx({ 'src/a.ts': 'export function load() {}\n', 'src/b.js': "const a = require('./a');\na.load();\n" }),
    );
    assert.ok(cjs.boundaries.some((b) => b.kind === 'unsupported-occurrence' && b.filePath === 'src/b.js'));

    const aliased = await collectExactRenameOccurrences(
      { filePath: 'src/a.ts', name: 'load', line: 1 }, 'loadAll',
      ctx({ 'src/a.ts': 'export function load() {}\n', 'src/b.ts': "import { load } from '@app/a';\nload();\n" }, true),
    );
    assert.ok(aliased.boundaries.some((b) => b.kind === 'unsupported-occurrence' && b.filePath === 'src/b.ts'));
  });

  it('marks generated-file occurrences as generated and blocks apply', async () => {
    const files = { 'src/a.ts': 'export function load() {}\n', 'src/api.generated.ts': "import { load } from './a.js';\nload();\n" };
    const result = await collectExactRenameOccurrences({ filePath: 'src/a.ts', name: 'load', line: 1 }, 'loadAll', ctx(files));
    assert.ok(result.occurrences.some((o) => o.category === 'generated' && o.filePath === 'src/api.generated.ts'));
    assert.ok(result.boundaries.some((b) => b.kind === 'generated-file'));
  });

  it('ignores external package imports of the same name', async () => {
    const files = { 'src/a.ts': 'export function load() {}\n', 'src/b.ts': "import { load } from 'some-pkg';\nload();\n" };
    const result = await collectExactRenameOccurrences({ filePath: 'src/a.ts', name: 'load', line: 1 }, 'loadAll', ctx(files));
    assert.ok(!result.occurrences.some((o) => o.filePath === 'src/b.ts' && o.category !== 'candidate-text'));
    assert.deepEqual(result.boundaries, []);
  });
});

describe('edit-spans — exact ranges with Unicode, CRLF and multibyte text', () => {
  it('produces UTF-16 offsets that slice to the old name', async () => {
    const files = {
      'src/a.ts': '// 日本語 コメント 🎉\r\nconst ünï = "😀😀";\r\nexport function load() {}\r\n/* ✓ */ load();\r\n',
      'src/b.ts': "const s = '🚀🚀🚀';\r\nimport { load } from './a.js';\r\nload(); // é\r\n",
    };
    const result = await collectExactRenameOccurrences({ filePath: 'src/a.ts', name: 'load', line: 3 }, 'loadAll', ctx(files));
    assert.deepEqual(result.boundaries, []);
    const edits = exact(result.occurrences);
    assert.equal(edits.length, 4);
    for (const o of edits) {
      assert.equal(at(files, o), 'load');
      assert.equal(o.text, 'load');
    }
    const def = edits.find((o) => o.role === 'definition')!;
    assert.equal(def.range.startLine, 3);
    assert.equal(def.range.startColumn, 'export function '.length);
    const call = edits.find((o) => o.filePath === 'src/b.ts' && o.role === 'reference')!;
    assert.equal(call.range.startLine, 3);
    assert.equal(call.range.startColumn, 0);
  });

  it('matches identifiers containing non-ASCII letters exactly', async () => {
    const files = { 'src/a.ts': 'export const café = 1;\nconst cafe = café + 1;\n' };
    const result = await collectExactRenameOccurrences({ filePath: 'src/a.ts', name: 'café', line: 1 }, 'bistro', ctx(files));
    const edits = exact(result.occurrences);
    assert.equal(edits.length, 2);
    for (const o of edits) assert.equal(at(files, o), 'café');
  });
});
