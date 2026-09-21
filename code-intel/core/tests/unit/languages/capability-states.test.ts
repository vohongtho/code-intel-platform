import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLanguageCapabilityDescriptor } from '../../../src/languages/capability-registry.js';
import { Language } from '../../../src/shared/languages.js';

describe('capability states are truthful', () => {
  it('marks known lower-confidence languages as partial', () => {
    for (const language of [
      Language.C,
      Language.Cpp,
      Language.CSharp,
      Language.PHP,
      Language.Kotlin,
      Language.Ruby,
      Language.Swift,
      Language.Dart,
    ]) {
      const descriptor = getLanguageCapabilityDescriptor(language);
      assert.equal(descriptor.capabilities.calls, 'partial', `${language} calls should be partial`);
      assert.equal(descriptor.capabilities.exports, 'partial', `${language} exports should be partial`);
    }
  });

  it('keeps HTML control flow and data flow not-applicable', () => {
    const descriptor = getLanguageCapabilityDescriptor(Language.HTML);
    assert.equal(descriptor.capabilities.controlFlow, 'not-applicable');
    assert.equal(descriptor.capabilities.dataFlow, 'not-applicable');
    assert.equal(descriptor.capabilities.embeddedLanguages, 'partial');
  });

  it('keeps primary fully-supported rows marked supported', () => {
    for (const language of [
      Language.TypeScript,
      Language.JavaScript,
      Language.Python,
      Language.Java,
      Language.Go,
      Language.Rust,
    ]) {
      const descriptor = getLanguageCapabilityDescriptor(language);
      assert.equal(descriptor.capabilities.definitions, 'supported');
      assert.equal(descriptor.capabilities.ownership, 'supported');
      assert.equal(descriptor.capabilities.exports, 'supported');
    }
  });
});
