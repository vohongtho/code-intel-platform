import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paramTypeSimilarity, returnTypeSimilarity, paramCountSimilarity, computeContractSimilarity } from '../../../src/multi-repo/type-similarity.js';

describe('paramTypeSimilarity', () => {
  it('identical type sets → 1.0', () => {
    const p = [{ type: 'string' }, { type: 'number' }];
    assert.equal(paramTypeSimilarity(p, p), 1.0);
  });
  it('disjoint types → 0.0', () => {
    assert.equal(paramTypeSimilarity([{ type: 'string' }], [{ type: 'boolean' }]), 0.0);
  });
  it('both empty → 1.0', () => {
    assert.equal(paramTypeSimilarity([], []), 1.0);
  });
  it('one empty → 0.0', () => {
    assert.equal(paramTypeSimilarity([{ type: 'string' }], []), 0.0);
  });
  it('partial overlap → between 0 and 1', () => {
    const a = [{ type: 'string' }, { type: 'number' }];
    const b = [{ type: 'string' }, { type: 'boolean' }];
    const sim = paramTypeSimilarity(a, b);
    assert.ok(sim > 0 && sim < 1);
  });
});

describe('returnTypeSimilarity', () => {
  it('exact match → 1.0', () => {
    assert.equal(returnTypeSimilarity('string', 'string'), 1.0);
  });
  it('compatible types → 0.8', () => {
    assert.equal(returnTypeSimilarity('boolean', 'bool'), 0.8);
  });
  it('different types → 0.0', () => {
    assert.equal(returnTypeSimilarity('string', 'number'), 0.0);
  });
  it('missing → 0.5', () => {
    assert.equal(returnTypeSimilarity(undefined, 'string'), 0.5);
  });
});

describe('computeContractSimilarity', () => {
  it('identical name + types → high confidence (≥ 0.9)', () => {
    const a = { name: 'getUser', parameters: [{ name: 'id', type: 'string' }], returnType: 'User' };
    const b = { name: 'getUser', parameters: [{ name: 'id', type: 'string' }], returnType: 'User' };
    const score = computeContractSimilarity(a, b, 1.0);
    assert.ok(score >= 0.9, `Expected ≥ 0.9, got ${score}`);
  });
  it('same name different return type → lower than name+types match', () => {
    const a = { name: 'getUser', parameters: [{ name: 'id', type: 'string' }], returnType: 'User' };
    const b = { name: 'getUser', parameters: [{ name: 'id', type: 'string' }], returnType: 'Admin' };
    const high = computeContractSimilarity(a, a, 1.0);
    const low = computeContractSimilarity(a, b, 1.0);
    assert.ok(low < high, `Expected ${low} < ${high}`);
  });
  it('different name identical signature → still scored above 0.5', () => {
    const a = { name: 'getUser', parameters: [{ name: 'id', type: 'string' }], returnType: 'User' };
    const b = { name: 'fetchUser', parameters: [{ name: 'id', type: 'string' }], returnType: 'User' };
    const score = computeContractSimilarity(a, b, 0.7);
    assert.ok(score > 0.5, `Expected > 0.5, got ${score}`);
  });
});
