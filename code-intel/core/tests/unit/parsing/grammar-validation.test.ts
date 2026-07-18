import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Query } from 'web-tree-sitter';
import { Language } from '../../../src/shared/index.js';
import { initParser, getLanguage } from '../../../src/parsing/index.js';
import {
  typescriptQueries,
  javascriptQueries,
  pythonQueries,
  javaQueries,
  goQueries,
  cQueries,
  cppQueries,
  csharpQueries,
  rustQueries,
  phpQueries,
  kotlinQueries,
  rubyQueries,
  swiftQueries,
  dartQueries,
} from '../../../src/parsing/queries/index.js';

const QUERY_BY_LANGUAGE: Record<Language, string> = {
  [Language.TypeScript]: typescriptQueries,
  [Language.JavaScript]: javascriptQueries,
  [Language.Python]: pythonQueries,
  [Language.Java]: javaQueries,
  [Language.Go]: goQueries,
  [Language.C]: cQueries,
  [Language.Cpp]: cppQueries,
  [Language.CSharp]: csharpQueries,
  [Language.Rust]: rustQueries,
  [Language.PHP]: phpQueries,
  [Language.Kotlin]: kotlinQueries,
  [Language.Ruby]: rubyQueries,
  [Language.Swift]: swiftQueries,
  [Language.Dart]: dartQueries,
};

describe('grammar query validation', () => {
  it('compiles every shipped query against its grammar when grammar is available', async () => {
    await initParser();
    const unavailable: Language[] = [];

    for (const [lang, querySource] of Object.entries(QUERY_BY_LANGUAGE) as Array<[Language, string]>) {
      const grammar = await getLanguage(lang);
      if (!grammar) {
        unavailable.push(lang);
        continue;
      }
      assert.ok(querySource.trim().length > 0, `${lang} query source should not be empty`);
      assert.doesNotThrow(() => new Query(grammar, querySource), `${lang} query should compile`);
    }

    assert.ok(unavailable.length < Object.keys(QUERY_BY_LANGUAGE).length, 'at least one grammar should be available for validation');
  });
});
