import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDependencyAwareIncrementalEnabled, isEligibleForIncrementalPublication } from '../../../src/incremental/rollout-gate.js';

describe('isDependencyAwareIncrementalEnabled', () => {
  it('defaults to enabled with no env override (scoped by isEligibleForIncrementalPublication elsewhere)', () => {
    assert.equal(isDependencyAwareIncrementalEnabled({}), true);
  });

  it('honors an explicit "1"/"true" override', () => {
    assert.equal(isDependencyAwareIncrementalEnabled({ CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED: '1' }), true);
    assert.equal(isDependencyAwareIncrementalEnabled({ CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED: 'true' }), true);
  });

  it('honors an explicit "0"/"false" override', () => {
    assert.equal(isDependencyAwareIncrementalEnabled({ CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED: '0' }), false);
    assert.equal(isDependencyAwareIncrementalEnabled({ CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED: 'false' }), false);
  });
});

describe('isEligibleForIncrementalPublication', () => {
  it('allows a change set made up only of fact-based languages', () => {
    assert.equal(isEligibleForIncrementalPublication(['a.ts', 'b.js', 'c.py', 'd.rs', 'e.go', 'f.html']), true);
  });

  it('rejects a change set touching a language whose graph is not fact-derived (Java)', () => {
    assert.equal(isEligibleForIncrementalPublication(['a.ts', 'Service.java']), false);
  });

  it('rejects each of the 9 non-fact-based languages individually', () => {
    const nonFactBased = [
      'a.java', 'a.c', 'a.cpp', 'a.cs', 'a.php', 'a.kt', 'a.rb', 'a.swift', 'a.dart',
    ];
    for (const filePath of nonFactBased) {
      assert.equal(isEligibleForIncrementalPublication([filePath]), false, `${filePath} should be ineligible`);
    }
  });

  it('rejects a file with an undetectable language', () => {
    assert.equal(isEligibleForIncrementalPublication(['README.md']), false);
  });

  it('treats an empty change set as eligible (vacuously true)', () => {
    assert.equal(isEligibleForIncrementalPublication([]), true);
  });
});
