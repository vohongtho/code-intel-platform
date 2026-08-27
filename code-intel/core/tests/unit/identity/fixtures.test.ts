import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getLanguageFactAdapter } from '../../../src/semantic/adapters/registry.js';
import { Language } from '../../../src/shared/languages.js';
import { projectFactBundle } from '../../../src/semantic/graph-projector.js';

const FIXTURES = path.resolve('tests/fixtures/identity');

function source(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('identity fixtures', () => {
  it('keeps overload-like TypeScript declarations distinct', () => {
    const bundle = getLanguageFactAdapter(Language.TypeScript).extract({ language: Language.TypeScript, filePath: 'overloads.ts', workspaceRoot: FIXTURES, source: source('overloads.ts') });
    const projected = projectFactBundle(bundle);
    const loginNodes = projected.nodes.filter((node) => node.name === 'login');
    assert.ok(loginNodes.length >= 2);
    assert.equal(new Set(loginNodes.map((node) => node.id)).size, loginNodes.length);
  });

  it('keeps repeated call-like Java/C#/Kotlin declarations distinct via generic adapters', () => {
    for (const [language, file] of [[Language.Java, 'overloads.java'], [Language.CSharp, 'overloads.cs'], [Language.Kotlin, 'overloads.kt']] as const) {
      const bundle = getLanguageFactAdapter(language).extract({ language, filePath: file, workspaceRoot: FIXTURES, source: source(file) });
      const projected = projectFactBundle(bundle);
      const loginNodes = projected.nodes.filter((node) => /Login|login/.test(node.name));
      assert.ok(loginNodes.length >= 2, `${file} should yield multiple login symbols`);
      const distinctLoginIds = new Set(loginNodes.filter((node) => /Login|login/.test(node.name)).map((node) => node.id));
      assert.ok(distinctLoginIds.size >= 2, `${file} should keep at least two distinct login ids`);
    }
  });
});
