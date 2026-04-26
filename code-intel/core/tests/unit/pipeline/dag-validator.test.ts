import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDAG, topologicalSort } from '../../../src/pipeline/dag-validator.js';
import type { Phase } from '../../../src/pipeline/types.js';

function makePhase(name: string, deps: string[]): Phase {
  return {
    name,
    dependencies: deps,
    async execute() {
      return { status: 'completed', duration: 0 };
    },
  };
}

describe('DAG Validator', () => {
  it('should accept valid DAG', () => {
    const phases = [makePhase('a', []), makePhase('b', ['a']), makePhase('c', ['b'])];
    const errors = validateDAG(phases);
    assert.equal(errors.length, 0);
  });

  it('should detect duplicate names', () => {
    const phases = [makePhase('a', []), makePhase('a', [])];
    const errors = validateDAG(phases);
    assert.ok(errors.some((e) => e.type === 'duplicate'));
  });

  it('should detect missing dependencies', () => {
    const phases = [makePhase('a', ['z'])];
    const errors = validateDAG(phases);
    assert.ok(errors.some((e) => e.type === 'missing-dep'));
  });

  it('should detect cycles', () => {
    const phases = [makePhase('a', ['b']), makePhase('b', ['a'])];
    const errors = validateDAG(phases);
    assert.ok(errors.some((e) => e.type === 'cycle'));
  });
});

describe('Topological Sort', () => {
  it('should sort phases in dependency order', () => {
    const phases = [makePhase('c', ['b']), makePhase('a', []), makePhase('b', ['a'])];
    const sorted = topologicalSort(phases);
    const names = sorted.map((p) => p.name);
    assert.equal(names.indexOf('a') < names.indexOf('b'), true);
    assert.equal(names.indexOf('b') < names.indexOf('c'), true);
  });
});
