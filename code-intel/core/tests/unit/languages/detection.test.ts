import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, getSupportedExtensions } from '@code-intel/shared';
import { Language } from '@code-intel/shared';

describe('Language Detection', () => {
  it('should detect TypeScript', () => {
    assert.equal(detectLanguage('src/app.ts'), Language.TypeScript);
    assert.equal(detectLanguage('src/app.tsx'), Language.TypeScript);
  });

  it('should detect Python', () => {
    assert.equal(detectLanguage('main.py'), Language.Python);
  });

  it('should detect Go', () => {
    assert.equal(detectLanguage('main.go'), Language.Go);
  });

  it('should detect Java', () => {
    assert.equal(detectLanguage('App.java'), Language.Java);
  });

  it('should detect Rust', () => {
    assert.equal(detectLanguage('main.rs'), Language.Rust);
  });

  it('should return null for unknown extensions', () => {
    assert.equal(detectLanguage('readme.md'), null);
    assert.equal(detectLanguage('data.json'), null);
  });

  it('should list supported extensions', () => {
    const exts = getSupportedExtensions();
    assert.ok(exts.includes('.ts'));
    assert.ok(exts.includes('.py'));
    assert.ok(exts.includes('.go'));
    assert.ok(exts.length > 10);
  });
});
