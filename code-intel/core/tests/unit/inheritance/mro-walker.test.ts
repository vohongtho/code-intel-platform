import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeMRO } from '../../../src/inheritance/mro-walker.js';

describe('MRO Walker', () => {
  it('should compute depth-first MRO', () => {
    const parentMap = new Map<string, string[]>();
    parentMap.set('C', ['B', 'A']);
    parentMap.set('B', ['A']);
    parentMap.set('A', []);

    const mro = computeMRO('C', parentMap, 'depth-first');
    assert.equal(mro[0], 'C');
    assert.ok(mro.includes('B'));
    assert.ok(mro.includes('A'));
  });

  it('should compute C3 linearization', () => {
    // Diamond: D extends B, C; B extends A; C extends A
    const parentMap = new Map<string, string[]>();
    parentMap.set('D', ['B', 'C']);
    parentMap.set('B', ['A']);
    parentMap.set('C', ['A']);
    parentMap.set('A', []);

    const mro = computeMRO('D', parentMap, 'c3');
    assert.equal(mro[0], 'D');
    // A should appear only once and after B and C
    const aIdx = mro.indexOf('A');
    const bIdx = mro.indexOf('B');
    const cIdx = mro.indexOf('C');
    assert.ok(bIdx < aIdx);
    assert.ok(cIdx < aIdx);
    // A should appear only once
    assert.equal(mro.filter((x) => x === 'A').length, 1);
  });

  it('should handle single class', () => {
    const parentMap = new Map<string, string[]>();
    parentMap.set('A', []);
    const mro = computeMRO('A', parentMap, 'none');
    assert.deepEqual(mro, ['A']);
  });

  it('should handle cycle gracefully', () => {
    const parentMap = new Map<string, string[]>();
    parentMap.set('A', ['B']);
    parentMap.set('B', ['A']);
    const mro = computeMRO('A', parentMap, 'c3');
    // Should not infinite loop, just return something
    assert.ok(mro.length > 0);
  });
});
