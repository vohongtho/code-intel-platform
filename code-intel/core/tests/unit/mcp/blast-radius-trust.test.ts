import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { createEvidenceStore } from '../../../src/evidence/store.js';
import { computeBlastRadiusWithTrust } from '../../../src/mcp-server/blast-radius-trust.js';

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-trust-'));
}

describe('computeBlastRadiusWithTrust', () => {
  it('keeps LOW risk for complete exact coverage', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'a', kind: 'function', name: 'a', filePath: 'a.ts' });
    graph.addNode({ id: 'b', kind: 'function', name: 'b', filePath: 'b.ts' });
    graph.addEdge({ id: 'e1', source: 'a', target: 'b', kind: 'calls', certainty: 'exact' });

    const result = computeBlastRadiusWithTrust({
      graph,
      targetId: 'a',
      targetName: 'a',
      direction: 'callees',
      maxHops: 2,
    });

    assert.equal(result.riskLevel, 'LOW');
    assert.equal(result.trust.certainty, 'exact');
    assert.equal(result.trust.coverage.complete, true);
  });

  it('treats empty blast radius as lower-bound, not exact proof', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'solo', kind: 'function', name: 'solo', filePath: 'solo.ts' });

    const result = computeBlastRadiusWithTrust({
      graph,
      targetId: 'solo',
      targetName: 'solo',
      direction: 'callees',
      maxHops: 2,
    });

    assert.equal(result.riskLevel, 'UNKNOWN');
    assert.equal(result.trust.certainty, 'lower-bound');
    assert.equal(result.trust.coverage.complete, false);
  });

  it('downgrades to UNKNOWN when coverage is incomplete', () => {
    const repo = tempRepo();
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'a', kind: 'function', name: 'a', filePath: 'a.ts' });
    graph.addNode({ id: 'b', kind: 'function', name: 'b', filePath: 'b.ts' });

    const store = createEvidenceStore(repo);
    store.put({
      id: 'ev:1',
      version: 1,
      referenceId: 'ref:1',
      resolverVersion: 'evidence-based-v1',
      strategy: 'semantic-call',
      coverage: { complete: false, examinedCount: 1, totalKnownCount: 4, incompleteReasons: ['analysis-limit'] },
      boundaries: [{ kind: 'analysis-limit', evidenceRefs: ['ev:1'] }],
      recordedAt: '2025-01-01T00:00:00.000Z',
    });
    store.close();

    graph.addEdge({ id: 'e1', source: 'a', target: 'b', kind: 'calls', certainty: 'candidate', evidenceRef: 'ev:1' });

    const result = computeBlastRadiusWithTrust({
      graph,
      targetId: 'a',
      targetName: 'a',
      direction: 'callees',
      maxHops: 2,
      repoDir: repo,
    });

    assert.equal(result.riskLevel, 'UNKNOWN');
    assert.equal(result.trust.certainty, 'lower-bound');
    assert.equal(result.trust.coverage.complete, false);
    assert.deepEqual(result.trust.boundaries.map((item) => item.kind), ['analysis-limit']);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
