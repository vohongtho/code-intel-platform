import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, getSupportedExtensions } from 'code-intel-shared';
import { Language } from 'code-intel-shared';

const EXPECTED_EXTENSIONS: Array<[string, Language]> = [
  ['.ts', Language.TypeScript],
  ['.tsx', Language.TypeScript],
  ['.mts', Language.TypeScript],
  ['.cts', Language.TypeScript],
  ['.js', Language.JavaScript],
  ['.jsx', Language.JavaScript],
  ['.mjs', Language.JavaScript],
  ['.cjs', Language.JavaScript],
  ['.py', Language.Python],
  ['.pyi', Language.Python],
  ['.java', Language.Java],
  ['.go', Language.Go],
  ['.c', Language.C],
  ['.h', Language.C],
  ['.cpp', Language.Cpp],
  ['.cxx', Language.Cpp],
  ['.cc', Language.Cpp],
  ['.hpp', Language.Cpp],
  ['.hxx', Language.Cpp],
  ['.cs', Language.CSharp],
  ['.rs', Language.Rust],
  ['.php', Language.PHP],
  ['.kt', Language.Kotlin],
  ['.kts', Language.Kotlin],
  ['.rb', Language.Ruby],
  ['.swift', Language.Swift],
  ['.dart', Language.Dart],
  ['.html', Language.HTML],
];

describe('Language Detection', () => {
  it('should preserve extension parity for every supported extension', () => {
    for (const [extension, language] of EXPECTED_EXTENSIONS) {
      assert.equal(detectLanguage(`fixture${extension}`), language, `expected ${extension} -> ${language}`);
    }
  });

  it('should return null for unknown extensions', () => {
    assert.equal(detectLanguage('readme.md'), null);
    assert.equal(detectLanguage('data.json'), null);
  });

  it('should list supported extensions', () => {
    const exts = getSupportedExtensions();
    assert.deepEqual(exts, EXPECTED_EXTENSIONS.map(([extension]) => extension));
  });
});
