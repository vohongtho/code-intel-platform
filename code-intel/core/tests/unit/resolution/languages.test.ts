import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getResolutionLanguageStrategy, RESOLUTION_LANGUAGE_STRATEGIES } from '../../../src/resolution/languages.js';
import { Language } from '../../../src/shared/languages.js';

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
