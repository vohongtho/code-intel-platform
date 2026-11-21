import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getResolutionLanguageStrategy, RESOLUTION_LANGUAGE_STRATEGIES } from '../../../src/resolution/languages.js';
import { Language } from '../../../src/shared/languages.js';
import { RECEIVER_TYPE_LANGUAGE_ADAPTERS } from '../../../src/resolution/receiver-types.js';
import { PROGRAM_ANALYSIS_CAPABILITY_REGISTRY } from '../../../src/program-analysis/languages/capability-registry.js';

describe('resolution language strategies', () => {
  it('covers all 15 registered languages', () => {
    const languages = Object.values(Language);
    assert.equal(languages.length, 15);
    assert.deepEqual(Object.keys(RESOLUTION_LANGUAGE_STRATEGIES).sort(), [...languages].sort());
  });

  it('declares capability state and unsupported boundaries for each language', () => {
    for (const language of Object.values(Language)) {
      const strategy = getResolutionLanguageStrategy(language);
      assert.ok(strategy);
      assert.equal(strategy.language, language);
      assert.ok(strategy.supportedStrategies.length > 0);
      assert.ok(strategy.unsupportedBoundaries.length > 0);
    }
  });

  it('keeps semantic-first status for ts/js/python/go/rust', () => {
    for (const language of [Language.TypeScript, Language.JavaScript, Language.Python, Language.Go, Language.Rust]) {
      assert.equal(getResolutionLanguageStrategy(language).capabilityState, 'semantic-first');
    }
  });
});

describe('dispatch evidence capability matrix', () => {
  it('declares dispatch evidence for all 15 languages without claiming unproduced receiver facts', () => {
    for (const language of Object.values(Language)) {
      const evidence = getResolutionLanguageStrategy(language).dispatchEvidence;
      assert.ok(evidence, language);
      assert.notEqual(evidence.receiverFacts, 'supported', `${language} must not claim receiver facts no adapter emits`);
      assert.ok(evidence.notes.length > 0, language);
    }
  });

  it('marks the receiver-type engine supported exactly for languages with a modeled adapter', () => {
    const supported = Object.values(Language).filter((language) => getResolutionLanguageStrategy(language).dispatchEvidence.engine === 'supported').sort();
    assert.deepEqual(supported, [Language.CSharp, Language.Go, Language.Java, Language.JavaScript, Language.Python, Language.Rust, Language.TypeScript].sort());
    assert.deepEqual(Object.keys(RECEIVER_TYPE_LANGUAGE_ADAPTERS).sort(), supported);
  });

  it('limits heritage and registration evidence to languages whose producers emit it', () => {
    const heritage = Object.values(Language).filter((language) => getResolutionLanguageStrategy(language).dispatchEvidence.heritageFacts === 'partial').sort();
    assert.deepEqual(heritage, [Language.CSharp, Language.Go, Language.Python].sort());
    const narrowing = Object.values(Language).filter((language) => getResolutionLanguageStrategy(language).dispatchEvidence.registrationNarrowing === 'partial');
    assert.deepEqual(narrowing, [Language.CSharp]);
  });

  it('never rates interprocedural taint above partial', () => {
    for (const entry of PROGRAM_ANALYSIS_CAPABILITY_REGISTRY) {
      assert.notEqual(entry.capabilities.interproceduralTaint, 'supported', entry.language);
      if (entry.capabilities.taint === 'not-applicable') assert.equal(entry.capabilities.interproceduralTaint, 'not-applicable');
    }
  });
});
