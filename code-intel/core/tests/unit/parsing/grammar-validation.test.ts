import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Query } from 'web-tree-sitter';
import { Language } from '../../../src/shared/index.js';
import { initParser, getLanguage } from '../../../src/parsing/index.js';
import { getLanguageCapabilityDescriptors, getLanguageQuery } from '../../../src/languages/capability-registry.js';

describe('grammar query validation', () => {
  it('compiles every shipped query against its grammar when grammar is available', async () => {
    await initParser();
    const unavailable: Language[] = [];

    const descriptors = getLanguageCapabilityDescriptors();

    for (const { language: lang } of descriptors) {
      const querySource = getLanguageQuery(lang);
      assert.ok(querySource, `${lang} query source should not be empty`);
      const grammar = await getLanguage(lang);
      if (!grammar) {
        unavailable.push(lang);
        continue;
      }
      assert.ok(querySource.trim().length > 0, `${lang} query source should not be empty`);
      assert.doesNotThrow(() => new Query(grammar, querySource), `${lang} query should compile`);
    }

    assert.ok(unavailable.length < descriptors.length, `expected some grammars to be available; unavailable: ${unavailable.join(', ')}`);
  });
});
