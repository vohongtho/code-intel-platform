import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CodeEdge, CodeNode } from '../../../src/shared/graph-types.js';
import type { ResolutionEvidenceRecord } from '../../../src/evidence/store.js';
import { buildConvergenceSnapshot, diffConvergenceSnapshots } from '../../../src/incremental/convergence-snapshot.js';

function node(overrides: Partial<CodeNode> = {}): CodeNode {
  return { id: 'n1', kind: 'class', name: 'Widget', filePath: 'a.ts', identityId: 'sym:v2:class:abc', ...overrides };
}

function edge(overrides: Partial<CodeEdge> = {}): CodeEdge {
  return { id: 'e1', source: 'n1', target: 'n2', kind: 'calls', ...overrides };
}

function evidenceRecord(overrides: Partial<ResolutionEvidenceRecord> = {}): ResolutionEvidenceRecord {
  return {
    id: 'evidence:v1:x', version: 1, referenceId: 'callsite:v1:x',
    resolverVersion: 'evidence-based-v1', strategy: 'exact', recordedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('convergence-snapshot', () => {
  it('is deterministic regardless of node/edge input order', () => {
    const nodes = [node({ id: 'n2', name: 'B', identityId: 'sym:b' }), node({ id: 'n1', name: 'A', identityId: 'sym:a' })];
    const edges = [edge({ id: 'e2', source: 'n1', target: 'n2' })];
    const a = buildConvergenceSnapshot({ nodes, edges, evidenceRecords: [], bm25MemberIds: ['x', 'y'], vectorMemberIds: [] });
    const b = buildConvergenceSnapshot({ nodes: [...nodes].reverse(), edges, evidenceRecords: [], bm25MemberIds: ['y', 'x'], vectorMemberIds: [] });
    assert.equal(a.fingerprint, b.fingerprint);
  });

  it('normalizes node identity to the canonical symbol-identity-v2 id, not the raw graph id', () => {
    const nodes = [node({ id: 'raw-1', identityId: 'sym:v2:class:stable' })];
    const snapshot = buildConvergenceSnapshot({ nodes, edges: [], evidenceRecords: [], bm25MemberIds: [], vectorMemberIds: [] });
    assert.equal(snapshot.nodes[0]!.canonicalId, 'sym:v2:class:stable');
  });

  it('flags repeated call sites shared by an ambiguous candidate set', () => {
    const nodes = [node({ id: 'n1' }), node({ id: 'n2', identityId: 'sym:2' }), node({ id: 'n3', identityId: 'sym:3' })];
    const edges = [
      edge({ id: 'e1', target: 'n2', callSiteId: 'callsite:v1:shared', ambiguous: true }),
      edge({ id: 'e2', target: 'n3', callSiteId: 'callsite:v1:shared', ambiguous: true }),
    ];
    const snapshot = buildConvergenceSnapshot({ nodes, edges, evidenceRecords: [], bm25MemberIds: [], vectorMemberIds: [] });
    assert.deepEqual(snapshot.repeatedCallSites, ['callsite:v1:shared']);
  });

  it('reports which specific dimension diverged between full and incremental snapshots', () => {
    const nodes = [node()];
    const full = buildConvergenceSnapshot({ nodes, edges: [], evidenceRecords: [evidenceRecord()], bm25MemberIds: ['a'], vectorMemberIds: [] });
    const incremental = buildConvergenceSnapshot({ nodes, edges: [], evidenceRecords: [], bm25MemberIds: ['a'], vectorMemberIds: [] });
    const problems = diffConvergenceSnapshots(full, incremental);
    assert.ok(problems.some((p) => p.includes('evidence')));
    assert.ok(!problems.some((p) => p.includes('BM25')));
  });
});
