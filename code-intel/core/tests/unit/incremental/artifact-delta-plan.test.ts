import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifactDeltaPlan } from '../../../src/incremental/artifact-delta-plan.js';
import type { SemanticDelta } from '../../../src/incremental/semantic-delta.js';

function baseDelta(overrides: Partial<SemanticDelta> = {}): SemanticDelta {
  return {
    changedFiles: [],
    deletedFiles: [],
    addedFacts: [],
    removedFacts: [],
    changedFacts: [],
    bodyOnlyFiles: [],
    invalidatedReferences: [],
    invalidatedCallSites: [],
    invalidatedSymbols: [],
    affectedArtifacts: new Set(),
    requiresFullResolution: false,
    ...overrides,
  };
}

describe('artifact-delta-plan', () => {
  it('forces every artifact to full when the delta requires full resolution', () => {
    const plan = buildArtifactDeltaPlan({
      delta: baseDelta({ requiresFullResolution: true, reason: 'closure truncated', changedFiles: ['a.ts'] }),
      vector: { enabled: true, force: false, hasVectorDb: true, embeddingsNeedRebuild: false },
    });
    assert.equal(plan.graph, 'full');
    assert.equal(plan.bm25, 'full');
    assert.equal(plan.evidence, 'full');
    assert.equal(plan.flows, 'full');
    assert.equal(plan.clusters, 'full');
    assert.equal(plan.programAnalysis, 'full');
    assert.equal(plan.vector.mode, 'full');
    assert.equal(plan.reason, 'closure truncated');
  });

  it('drives per-artifact incremental/preserve modes from affectedArtifacts', () => {
    const delta = baseDelta({
      changedFiles: ['a.ts'],
      changedFacts: ['decl:a.ts:Widget'],
      affectedArtifacts: new Set(['graph', 'bm25', 'evidence', 'vector']),
    });
    const plan = buildArtifactDeltaPlan({
      delta,
      vector: { enabled: true, force: false, hasVectorDb: true, embeddingsNeedRebuild: false },
    });
    assert.equal(plan.graph, 'incremental');
    assert.equal(plan.bm25, 'incremental');
    assert.equal(plan.evidence, 'incremental');
    assert.equal(plan.flows, 'preserve');
    assert.equal(plan.clusters, 'preserve');
    assert.equal(plan.vector.mode, 'incremental');
    if (plan.vector.mode === 'incremental') assert.deepEqual(plan.vector.paths, ['a.ts']);
  });

  it('reports affected files as the union of changed and deleted paths', () => {
    const plan = buildArtifactDeltaPlan({
      delta: baseDelta({ changedFiles: ['a.ts'], deletedFiles: ['b.ts'] }),
      vector: { enabled: false, force: false, hasVectorDb: false, embeddingsNeedRebuild: false },
    });
    assert.deepEqual(plan.affectedFiles, ['a.ts', 'b.ts']);
    assert.equal(plan.vector.mode, 'skip');
  });
});
