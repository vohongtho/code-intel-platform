import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLanguageModule, getAllLanguageModules } from '../../../src/languages/registry.js';
import { Language } from 'code-intel-shared';

describe('Language Registry', () => {
  it('should return module for all languages', () => {
    for (const lang of Object.values(Language)) {
      const mod = getLanguageModule(lang);
      assert.ok(mod, `Missing module for ${lang}`);
      assert.equal(mod.lang, lang);
      assert.ok(mod.fileExtensions.length > 0);
      assert.ok(mod.queries.length > 0);
    }
  });

  it('should have 14 modules', () => {
    const all = getAllLanguageModules();
    assert.equal(all.length, 14);
  });

  it('should have correct import styles', () => {
    assert.equal(getLanguageModule(Language.TypeScript).importStyle, 'explicit');
    assert.equal(getLanguageModule(Language.Python).importStyle, 'namespace');
    assert.equal(getLanguageModule(Language.Go).importStyle, 'wildcard');
    assert.equal(getLanguageModule(Language.C).importStyle, 'include');
  });

  it('should have correct inheritance strategies', () => {
    assert.equal(getLanguageModule(Language.Python).inheritanceStrategy, 'c3');
    assert.equal(getLanguageModule(Language.Ruby).inheritanceStrategy, 'mixin-aware');
    assert.equal(getLanguageModule(Language.Rust).inheritanceStrategy, 'none');
    assert.equal(getLanguageModule(Language.Java).inheritanceStrategy, 'depth-first');
  });
});
