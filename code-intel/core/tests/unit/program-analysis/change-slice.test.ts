import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ProgramDependenceGraph } from '../../../src/program-analysis/pdg/contracts.js';
import { buildChangeSlice } from '../../../src/program-analysis/change-slice.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS } from '../../../src/program-analysis/limits.js';

function pdg(overrides: Partial<ProgramDependenceGraph> = {}): ProgramDependenceGraph {
  return {
    version: 'pdg-v1',
    functionId: 'fn:test',
    statementIds: ['s0', 's1', 's2', 's3'],
    edges: [
      { kind: 'data', fromStatementId: 's0', toStatementId: 's1' },
      { kind: 'data', fromStatementId: 's1', toStatementId: 's2' },
      { kind: 'control', fromStatementId: 's2', toStatementId: 's3' },
    ],
    truncated: false,
    ...overrides,
  };
}

describe('buildChangeSlice', () => {
  it('walks forward dependencies and an optional explanatory backward slice', () => {
    const result = buildChangeSlice({ pdg: pdg(), seedStatementIds: ['s1'], includeBackward: true });

    assert.equal(result.supported, true);
    assert.deepEqual(result.seedStatementIds, ['s1']);
    assert.deepEqual(result.forward.map((node) => node.statementId), ['s2', 's3']);
    assert.deepEqual(result.backward?.map((node) => node.statementId), ['s0']);
    assert.equal(result.dataDependencies, 2);
    assert.equal(result.controlDependencies, 1);
    assert.equal(result.truncated, false);
    assert.equal(result.certainty, 'exact');
  });

  it('returns unsupported rather than no impact when no seed belongs to the PDG', () => {
    const result = buildChangeSlice({ pdg: pdg(), seedStatementIds: ['missing'] });

    assert.equal(result.supported, false);
    assert.deepEqual(result.forward, []);
    assert.equal(result.certainty, 'unresolved');
    assert.match(result.reason ?? '', /seed statement/i);
  });

  it('propagates a partial PDG as a truncated lower-bound result', () => {
    const result = buildChangeSlice({
      pdg: pdg({ truncated: true, reason: 'lowering statement budget exceeded' }),
      seedStatementIds: ['s1'],
    });

    assert.equal(result.supported, true);
    assert.equal(result.truncated, true);
    assert.equal(result.certainty, 'truncated');
    assert.match(result.reason ?? '', /statement budget/);
  });

  it('stops at the existing worklist budget and reports truncation', () => {
    const result = buildChangeSlice({
      pdg: pdg(),
      seedStatementIds: ['s0'],
      limits: { ...DEFAULT_PROGRAM_ANALYSIS_LIMITS, maxWorklistIterations: 1 },
    });

    assert.equal(result.truncated, true);
    assert.deepEqual(result.forward.map((node) => node.statementId), ['s1']);
    assert.match(result.reason ?? '', /worklist/i);
  });

  it('is deterministic across equivalent cached and freshly-built PDGs', () => {
    const fresh = buildChangeSlice({ pdg: pdg(), seedStatementIds: ['s1'], includeBackward: true });
    const cached = buildChangeSlice({ pdg: structuredClone(pdg()), seedStatementIds: ['s1'], includeBackward: true });
    assert.deepEqual(cached, fresh);
  });
});
