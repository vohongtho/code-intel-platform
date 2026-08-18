import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLanguageFactAdapter } from '../../../src/semantic/adapters/registry.js';
import { Language } from '../../../src/shared/languages.js';
import { TRAITS } from '../../../src/semantic/adapters/common.js';

describe('language fact adapters', () => {
  it('registers all supported languages explicitly', () => {
    for (const language of Object.values(Language)) {
      const adapter = getLanguageFactAdapter(language);
      assert.equal(adapter.language, language);
      assert.equal(typeof adapter.extract, 'function');
      assert.equal(typeof adapter.validate, 'function');
    }
  });

  it('returns explicit capability diagnostics instead of silent fallback', () => {
    const adapter = getLanguageFactAdapter(Language.C);
    const bundle = adapter.extract({
      language: Language.C,
      filePath: 'src/a.c',
      workspaceRoot: '/repo',
      source: 'int main() { return 0; }',
    });

    assert.ok(bundle.diagnostics.length > 0);
    assert.ok(bundle.diagnostics.every((diagnostic) => diagnostic.affectedCapability.length > 0));
  });

  it('extracts grouped declarations and exported names for TypeScript', () => {
    const adapter = getLanguageFactAdapter(Language.TypeScript);
    const bundle = adapter.extract({
      language: Language.TypeScript,
      filePath: 'grouped.ts',
      workspaceRoot: '/repo',
      source: 'export const ALPHA = 1, BETA = 2;\nclass PairOne {}\nclass PairTwo {}\n',
    });

    const names = bundle.facts.filter((fact) => 'name' in fact).map((fact) => ('name' in fact ? fact.name : '')).filter(Boolean);
    assert.ok(names.includes('ALPHA'));
    assert.ok(names.includes('BETA'));
  });

  it('extracts Python inheritance and private non-publication', () => {
    const adapter = getLanguageFactAdapter(Language.Python);
    const bundle = adapter.extract({
      language: Language.Python,
      filePath: 'main.py',
      workspaceRoot: '/repo',
      source: 'class UserService:\n    pass\nclass AdminService(UserService):\n    pass\ndef _private_helper():\n    return None\n',
    });

    const publicNames = bundle.facts.filter((fact) => 'publicName' in fact).map((fact) => ('publicName' in fact ? fact.publicName : ''));
    const heritage = bundle.facts.find((fact) => 'heritageKind' in fact);
    assert.ok(publicNames.includes('UserService'));
    assert.ok(!publicNames.includes('_private_helper'));
    assert.ok(heritage);
  });

  it('extracts Rust type-use and structured reference forms', () => {
    const adapter = getLanguageFactAdapter(Language.Rust);
    const bundle = adapter.extract({
      language: Language.Rust,
      filePath: 'main.rs',
      workspaceRoot: '/repo',
      source: 'pub fn parse_config(input: &str) -> Config { Config { port: 8080 } }\n',
    });

    const fnFact = bundle.facts.find((fact) => 'name' in fact && fact.name === 'parse_config');
    const typeUse = bundle.facts.find((fact) => 'operation' in fact && fact.operation === 'type-use');
    assert.ok(fnFact && 'signature' in fnFact && fnFact.signature?.parameters[0]?.type?.kind === 'reference');
    assert.ok(typeUse);
  });

  it('provides semantic kind traits without hard-coded consumer lists', () => {
    assert.equal(TRAITS.classLike.canImplementInterface, true);
    assert.equal(TRAITS.structLike.participatesInInheritance, false);
    assert.equal(TRAITS.interfaceLike.structuralShape, true);
    assert.equal(TRAITS.shapeLike.canReceiveDispatch, true);
  });
});
