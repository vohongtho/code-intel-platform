import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Language } from '../../../src/shared/languages.js';
import {
  findLanguageCapabilityByExtension,
  getLanguageCapabilityDescriptor,
  getLanguageCapabilityDescriptors,
  getLanguageQuery,
  validateLanguageCapabilityRegistry,
} from '../../../src/languages/capability-registry.js';
import type { LanguageCapabilityDescriptor } from '../../../src/languages/capability-types.js';

describe('capability registry', () => {
  it('has exactly one descriptor per language in enum order', () => {
    const descriptors = getLanguageCapabilityDescriptors();
    assert.deepEqual(descriptors.map((entry) => entry.language), Object.values(Language));
  });

  it('resolves descriptor and query for every language', () => {
    for (const language of Object.values(Language)) {
      const descriptor = getLanguageCapabilityDescriptor(language);
      assert.equal(descriptor.language, language);
      assert.ok(descriptor.grammarArtifact.endsWith('.wasm'));
      assert.ok(descriptor.devGrammarPackage.includes('.wasm'));
      assert.ok(descriptor.extensions.length > 0);
      assert.ok(getLanguageQuery(language) !== null, `${language} should expose query source`);
    }
  });

  it('finds languages by extension', () => {
    assert.equal(findLanguageCapabilityByExtension('.html')?.language, Language.HTML);
    assert.equal(findLanguageCapabilityByExtension('.ts')?.language, Language.TypeScript);
    assert.equal(findLanguageCapabilityByExtension('.wat'), null);
  });

  it('rejects duplicate languages', () => {
    const [first] = getLanguageCapabilityDescriptors();
    const duplicate: readonly LanguageCapabilityDescriptor[] = [first, first];
    assert.throws(() => validateLanguageCapabilityRegistry(duplicate), /Duplicate language descriptor/);
  });

  it('rejects duplicate extensions', () => {
    const descriptors = getLanguageCapabilityDescriptors();
    const broken: readonly LanguageCapabilityDescriptor[] = [
      descriptors[0],
      { ...descriptors[1], extensions: [descriptors[0]!.extensions[0]!, '.uniq-js'] },
      ...descriptors.slice(2),
    ];
    assert.throws(() => validateLanguageCapabilityRegistry(broken), /Duplicate extension mapping/);
  });

  it('rejects invalid extensions', () => {
    const descriptors = getLanguageCapabilityDescriptors();
    const broken: readonly LanguageCapabilityDescriptor[] = [
      { ...descriptors[0], extensions: ['ts'] },
      ...descriptors.slice(1),
    ];
    assert.throws(() => validateLanguageCapabilityRegistry(broken), /invalid extension/);
  });
});
