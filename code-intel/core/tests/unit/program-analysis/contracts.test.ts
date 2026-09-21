import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRAM_ANALYSIS_VERSION,
  generateProgramAnalysisArtifactId,
  generateIrNodeId,
  isProgramAnalysisFingerprintCompatible,
  boundCertaintyByCallRelationship,
  type ProgramAnalysisFingerprint,
} from '../../../src/program-analysis/contracts.js';
import {
  DEFAULT_PROGRAM_ANALYSIS_LIMITS,
  truncatedOutcome,
  completeOutcome,
  startDeadline,
  isDeadlineExceeded,
} from '../../../src/program-analysis/limits.js';

function fingerprint(overrides: Partial<ProgramAnalysisFingerprint> = {}): ProgramAnalysisFingerprint {
  return {
    programAnalysisVersion: PROGRAM_ANALYSIS_VERSION,
    languageLoweringVersion: 'typescript-v1',
    resolverVersion: 'evidence-based-v1',
    ...overrides,
  };
}

describe('program-analysis contracts', () => {
  it('generates the same artifact id for identical inputs', () => {
    const input = {
      kind: 'cfg' as const,
      canonicalFunctionId: 'sym:v2:function:abc',
      bodyHash: 'hash-1',
      fingerprint: fingerprint(),
    };
    assert.equal(generateProgramAnalysisArtifactId(input), generateProgramAnalysisArtifactId({ ...input }));
  });

  it('changes artifact id when body hash changes', () => {
    const base = {
      kind: 'cfg' as const,
      canonicalFunctionId: 'sym:v2:function:abc',
      bodyHash: 'hash-1',
      fingerprint: fingerprint(),
    };
    const changed = { ...base, bodyHash: 'hash-2' };
    assert.notEqual(generateProgramAnalysisArtifactId(base), generateProgramAnalysisArtifactId(changed));
  });

  it('generates stable, scoped IR node ids', () => {
    assert.equal(generateIrNodeId('pa:v1:ir:abc', 0), 'pa:v1:ir:abc:n0');
    assert.notEqual(generateIrNodeId('pa:v1:ir:abc', 0), generateIrNodeId('pa:v1:ir:abc', 1));
  });

  it('treats fingerprints with matching required fields as compatible', () => {
    assert.equal(isProgramAnalysisFingerprintCompatible(fingerprint(), fingerprint()), true);
  });

  it('rejects fingerprints with mismatched resolver version', () => {
    assert.equal(
      isProgramAnalysisFingerprintCompatible(fingerprint(), fingerprint({ resolverVersion: 'evidence-based-v2' })),
      false,
    );
  });

  it('rejects fingerprints missing a required semantic graph fingerprint match', () => {
    const required = fingerprint({ semanticGraphFingerprint: 'graph-1' });
    assert.equal(isProgramAnalysisFingerprintCompatible(fingerprint(), required), false);
    assert.equal(
      isProgramAnalysisFingerprintCompatible(fingerprint({ semanticGraphFingerprint: 'graph-1' }), required),
      true,
    );
  });

  it('bounds interprocedural certainty down to the weaker call relationship certainty', () => {
    assert.equal(boundCertaintyByCallRelationship('exact', 'heuristic'), 'heuristic');
    assert.equal(boundCertaintyByCallRelationship('heuristic', 'exact'), 'heuristic');
    assert.equal(boundCertaintyByCallRelationship('unresolved', 'exact'), 'unresolved');
  });
});

describe('program-analysis limits', () => {
  it('produces a complete outcome by default', () => {
    assert.deepEqual(completeOutcome(), { truncated: false });
  });

  it('produces a truncated outcome carrying a reason', () => {
    assert.deepEqual(truncatedOutcome('exceeded max blocks'), { truncated: true, reason: 'exceeded max blocks' });
  });

  it('exposes positive default limits for every budget', () => {
    for (const value of Object.values(DEFAULT_PROGRAM_ANALYSIS_LIMITS)) {
      assert.equal(typeof value, 'number');
      assert.ok(value > 0);
    }
  });

  it('reports a deadline as exceeded only after its budget elapses', () => {
    const deadline = startDeadline(0);
    assert.equal(isDeadlineExceeded(deadline), true);
    const generousDeadline = startDeadline(60_000);
    assert.equal(isDeadlineExceeded(generousDeadline), false);
  });
});
