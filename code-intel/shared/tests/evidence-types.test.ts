import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RELATIONSHIP_CERTAINTIES,
  ANALYSIS_CERTAINTIES,
  ANALYSIS_BOUNDARY_KINDS,
  type RelationshipTrust,
  type AnalysisCoverage,
  type AnalysisBoundary,
} from '../dist/index.js';

describe('evidence-types', () => {
  it('exports expected certainty enums', () => {
    assert.deepEqual(RELATIONSHIP_CERTAINTIES, ['exact', 'candidate', 'heuristic']);
    assert.deepEqual(ANALYSIS_CERTAINTIES, ['exact', 'lower-bound', 'heuristic', 'truncated', 'unavailable']);
    assert.deepEqual(ANALYSIS_BOUNDARY_KINDS, [
      'external-library',
      'dynamic-dispatch',
      'unresolved-receiver',
      'ambiguous-target',
      'analysis-limit',
      'stale-index',
      'unavailable-index',
      'legacy-resolver',
      'unsupported-semantics',
    ]);
  });

  it('supports discriminated boundary kinds', () => {
    const boundary: AnalysisBoundary = {
      kind: 'dynamic-dispatch',
      evidenceRefs: ['ev:1'],
    };
    assert.equal(boundary.kind, 'dynamic-dispatch');
  });

  it('supports relationship trust contract', () => {
    const trust: RelationshipTrust = {
      callSiteId: 'callsite:v1:1',
      confidence: 0.9,
      certainty: 'candidate',
      strategy: 'imported',
      resolverVersion: 'resolver-v1',
      evidenceRef: 'ev:1',
      ambiguous: true,
    };
    assert.equal(trust.certainty, 'candidate');
    assert.equal(trust.ambiguous, true);
  });

  it('supports coverage contract', () => {
    const coverage: AnalysisCoverage = {
      complete: false,
      examinedCount: 2,
      totalKnownCount: 5,
      incompleteReasons: ['analysis-limit'],
    };
    assert.equal(coverage.complete, false);
    assert.deepEqual(coverage.incompleteReasons, ['analysis-limit']);
  });
});
