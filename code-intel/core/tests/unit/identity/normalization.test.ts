import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashIdentityPayload,
  normalizeRepoRelativePath,
  stableStringifyIdentity,
} from '../../../src/identity/normalization.js';

describe('identity normalization', () => {
  it('normalizes cross-platform relative paths deterministically', () => {
    assert.equal(normalizeRepoRelativePath('src\\foo\\..\\bar.ts'), 'src/bar.ts');
    assert.equal(normalizeRepoRelativePath('./src//nested/./file.ts'), 'src/nested/file.ts');
    assert.equal(normalizeRepoRelativePath('C:\\repo\\src\\app.ts'), 'repo/src/app.ts');
  });

  it('stable-stringifies objects with sorted keys', () => {
    const left = stableStringifyIdentity({ b: 2, a: { d: 4, c: 3 } });
    const right = stableStringifyIdentity({ a: { c: 3, d: 4 }, b: 2 });
    assert.equal(left, right);
  });

  it('hashes equal payloads equally', () => {
    assert.equal(
      hashIdentityPayload({ z: 1, a: ['x', 'y'] }),
      hashIdentityPayload({ a: ['x', 'y'], z: 1 }),
    );
  });
});
