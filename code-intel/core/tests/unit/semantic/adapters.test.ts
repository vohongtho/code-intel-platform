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

  it('adds default identity metadata for capability adapters', () => {
    const adapter = getLanguageFactAdapter(Language.CSharp);
    const bundle = adapter.extract({
      language: Language.CSharp,
      filePath: 'src/UserService.cs',
      workspaceRoot: '/repo',
      source: 'public class UserService { }\npublic Task Login(string token) { }\n',
    });

    const decl = bundle.facts.find((fact) => 'name' in fact && fact.name === 'UserService');
    const fragment = bundle.facts.find((fact) => 'fragmentId' in fact);
    assert.ok(decl && 'qualifiedName' in decl && decl.qualifiedName === 'src/UserService.cs:UserService');
    assert.ok(decl && 'visibility' in decl && decl.visibility?.level === 'public');
    assert.ok(fragment && 'declarationRef' in fragment);
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

  it('adds identity qualifiers and fragments for TypeScript declarations', () => {
    const adapter = getLanguageFactAdapter(Language.TypeScript);
    const bundle = adapter.extract({
      language: Language.TypeScript,
      filePath: 'grouped.ts',
      workspaceRoot: '/repo',
      source: 'export function login(token: string): Promise<User> { return user; }\n',
    });

    const fnFact = bundle.facts.find((fact) => 'name' in fact && fact.name === 'login');
    const fragment = bundle.facts.find((fact) => 'fragmentId' in fact);
    assert.ok(fnFact && 'qualifiedName' in fnFact && fnFact.qualifiedName === 'grouped.ts:login');
    assert.ok(fnFact && 'visibility' in fnFact && fnFact.visibility?.level === 'public');
    assert.ok(fragment && 'declarationRef' in fragment && fragment.declarationRef === 'decl:login');
  });

  it('captures TS alias imports and re-exports for fixture-style resolution cases', () => {
    const adapter = getLanguageFactAdapter(Language.TypeScript);
    const bundle = adapter.extract({
      language: Language.TypeScript,
      filePath: 'index.ts',
      workspaceRoot: '/repo',
      source: "import { Foo as LocalFoo } from './foo'\nexport { Foo as PublicFoo } from './foo'\n",
    });

    const aliasImport = bundle.facts.find((fact) => 'bindingKind' in fact && fact.bindingKind === 'alias');
    const reexport = bundle.facts.find((fact) => 'publicationKind' in fact && fact.publicationKind === 'reexport');
    assert.ok(aliasImport && 'localName' in aliasImport && aliasImport.localName === 'LocalFoo');
    assert.ok(aliasImport && 'importedName' in aliasImport && aliasImport.importedName === 'Foo');
    assert.ok(reexport && 'publicName' in reexport && reexport.publicName === 'PublicFoo');
  });

  it('captures JS alias imports and re-exports for fixture-style resolution cases', () => {
    const adapter = getLanguageFactAdapter(Language.JavaScript);
    const bundle = adapter.extract({
      language: Language.JavaScript,
      filePath: 'index.js',
      workspaceRoot: '/repo',
      source: "import { foo as localFoo } from './foo.js'\nexport { foo as publicFoo } from './foo.js'\n",
    });

    const aliasImport = bundle.facts.find((fact) => 'bindingKind' in fact && fact.bindingKind === 'alias');
    const reexport = bundle.facts.find((fact) => 'publicationKind' in fact && fact.publicationKind === 'reexport');
    assert.ok(aliasImport && 'localName' in aliasImport && aliasImport.localName === 'localFoo');
    assert.ok(aliasImport && 'importedName' in aliasImport && aliasImport.importedName === 'foo');
    assert.ok(reexport && 'publicName' in reexport && reexport.publicName === 'publicFoo');
  });

  it('keeps callable and generic shape facts for TS/JS callback-style fixtures', () => {
    const tsAdapter = getLanguageFactAdapter(Language.TypeScript);
    const jsAdapter = getLanguageFactAdapter(Language.JavaScript);
    const tsBundle = tsAdapter.extract({
      language: Language.TypeScript,
      filePath: 'callbacks.ts',
      workspaceRoot: '/repo',
      source: 'export const onDone = () => {}\n',
    });
    const jsBundle = jsAdapter.extract({
      language: Language.JavaScript,
      filePath: 'shape.js',
      workspaceRoot: '/repo',
      source: '/** @type {Repo<User>} */\nexport const repo = factory()\n',
    });

    const callable = tsBundle.facts.find((fact) => 'type' in fact && fact.type?.kind === 'callable');
    const genericShape = jsBundle.facts.find((fact) => 'type' in fact && fact.type?.kind === 'generic-application');
    assert.ok(callable);
    assert.ok(genericShape && 'type' in genericShape && genericShape.type?.text === 'Repo<User>');
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

  it('extracts C# overload/interface/record/partial/delegate/event/extension fixtures', () => {
    const adapter = getLanguageFactAdapter(Language.CSharp);
    const bundle = adapter.extract({
      language: Language.CSharp,
      filePath: 'UserService.cs',
      workspaceRoot: '/repo',
      source: [
        'public interface IUserService {}',
        'public partial class UserService : IUserService {}',
        'public partial class UserService {}',
        'public record UserRecord(string Name);',
        'public delegate void UserHandler(string user);',
        'public event UserHandler Saved;',
        'public string Find(int id) => "";',
        'public string Find(string name) => "";',
        'public static string Describe(this UserService service, string prefix) => prefix;',
      ].join('\n'),
    });

    const iface = bundle.facts.find((fact) => 'name' in fact && fact.name === 'IUserService');
    const hasPartialFrag = bundle.facts.some((fact) => 'fragmentId' in fact && fact.fragmentId.includes('UserService') && fact.partial === true);
    const record = bundle.facts.find((fact) => 'name' in fact && fact.name === 'UserRecord');
    const delegate = bundle.facts.find((fact) => 'name' in fact && fact.name === 'UserHandler');
    const evt = bundle.facts.find((fact) => 'name' in fact && fact.name === 'Saved');
    const overloads = bundle.facts.filter((fact) => 'name' in fact && fact.name === 'Find');
    const extension = bundle.facts.find((fact) => 'name' in fact && fact.name === 'Describe');
    const heritageFact = bundle.facts.find((fact) => 'heritageKind' in fact);

    assert.ok(iface);
    assert.ok(hasPartialFrag);
    assert.ok(record);
    assert.ok(delegate && 'type' in delegate && delegate.type?.text === 'void');
    assert.ok(evt && 'type' in evt && evt.type?.text === 'UserHandler');
    assert.equal(overloads.length, 2);
    assert.ok(extension && 'type' in extension && extension.type?.text === 'UserService');
    assert.ok(heritageFact);
  });

  it('extracts Python direct/package re-export, cycle/alias/local import, and dynamic-boundary fixtures', () => {
    const adapter = getLanguageFactAdapter(Language.Python);
    const bundle = adapter.extract({
      language: Language.Python,
      filePath: 'pkg/module.py',
      workspaceRoot: '/repo',
      source: [
        'from pkg.service import UserService as ServiceAlias',
        'import pkg.repo as repo_alias',
        '__all__ = ["ServiceAlias", "repo_alias"]',
        'class UserService: pass',
        'def loader(self):',
        '    return importlib.import_module("pkg.dynamic")',
      ].join('\n'),
    });

    const aliasImports = bundle.facts.filter((fact) => 'bindingKind' in fact && fact.bindingKind === 'alias');
    const namespaceImport = bundle.facts.find((fact) => 'bindingKind' in fact && ('localName' in fact) && fact.localName === 'repo_alias');
    const implicitPub = bundle.facts.filter((fact) => 'publicationKind' in fact && fact.publicationKind === 'language-implicit');
    assert.ok(aliasImports.some((fact) => 'localName' in fact && fact.localName === 'ServiceAlias'));
    assert.ok(namespaceImport);
    assert.equal(implicitPub.length, 2);
  });

  it('extracts Go method-set, embedding, package visibility, generic interface, and interface-field fixtures', () => {
    const adapter = getLanguageFactAdapter(Language.Go);
    const bundle = adapter.extract({
      language: Language.Go,
      filePath: 'service.go',
      workspaceRoot: '/repo',
      source: [
        'type Base struct {',
        '}',
        'type Service struct {',
        '    *Base',
        '}',
        'type repo interface {',
        '    save(value string) error',
        '}',
        'type Reader[T any] interface {',
        '    Read(item T) error',
        '}',
        'func (s Service) Save(value string) error { return nil }',
        'func (s *Service) Start() error { return nil }',
        'func helper() {}',
      ].join('\n'),
    });

    const saveMethod = bundle.facts.find((fact) => 'name' in fact && fact.name === 'Save');
    const startMethod = bundle.facts.find((fact) => 'name' in fact && fact.name === 'Start');
    const helper = bundle.facts.find((fact) => 'name' in fact && fact.name === 'helper');
    const mixin = bundle.facts.find((fact) => 'heritageKind' in fact && fact.heritageKind === 'mixes-in');
    const genericIface = bundle.facts.find((fact) => 'name' in fact && fact.name === 'Reader');
    const ifaceMember = bundle.facts.find((fact) => 'name' in fact && fact.name === 'save');

    assert.ok(saveMethod && 'type' in saveMethod && saveMethod.type?.kind === 'nominal');
    assert.ok(startMethod && 'type' in startMethod && startMethod.type?.kind === 'pointer');
    assert.ok(helper && 'visibility' in helper && helper.visibility?.level === 'package');
    assert.ok(mixin);
    assert.ok(genericIface && 'type' in genericIface && genericIface.type?.kind === 'generic-application');
    assert.ok(ifaceMember && 'ownerRef' in ifaceMember);
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
