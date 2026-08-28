import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { createEvidenceStore } from '../../../src/evidence/store.js';
import { buildChangeContext } from '../../../src/query/change-context.js';

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'change-context-'));
}

describe('buildChangeContext', () => {
  it('returns impact, bounded context and test suggestions in one result', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'service', kind: 'function', name: 'createUser', filePath: 'src/user.ts', content: 'export function createUser() { return saveUser(); }' });
    graph.addNode({ id: 'repo', kind: 'function', name: 'saveUser', filePath: 'src/repo.ts', content: 'export function saveUser() { return true; }' });
    graph.addNode({ id: 'controller', kind: 'function', name: 'handleUser', filePath: 'src/controller.ts', content: 'export function handleUser() { return createUser(); }' });
    graph.addEdge({ id: 'service-repo', source: 'service', target: 'repo', kind: 'calls' });
    graph.addEdge({ id: 'controller-service', source: 'controller', target: 'service', kind: 'calls' });

    const result = buildChangeContext(graph, { changedFiles: ['src/user.ts'], maxTokens: 256 });

    assert.deepEqual(result.changedFiles, ['src/user.ts']);
    assert.equal(result.summary.changedSymbolCount, 1);
    assert.ok(result.summary.impactedSymbolCount >= 1);
    assert.ok((result.context.blockTokens?.total ?? Infinity) <= 256);
    assert.equal(result.testSuggestions[0]?.symbol, 'createUser');
  });

  it('normalizes and deduplicates changed paths', () => {
    const graph = createKnowledgeGraph();
    const result = buildChangeContext(graph, { changedFiles: ['src\\user.ts', 'src/user.ts', ''] });
    assert.deepEqual(result.changedFiles, ['src/user.ts']);
    assert.equal(result.summary.highestRisk, 'NONE');
  });

  it('preserves unknown trust from uncertain impact/test suggestions', () => {
    const repoDir = tempRepo();
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'target', kind: 'function', name: 'target', filePath: 'src/target.ts', content: 'export function target() {}' });
    graph.addNode({ id: 'caller', kind: 'function', name: 'caller', filePath: 'src/caller.ts', content: 'export function caller() { target(); }' });
    const store = createEvidenceStore(repoDir);
    store.put({
      id: 'ev:ctx-1',
      version: 1,
      referenceId: 'ref:ctx-1',
      resolverVersion: 'evidence-based-v1',
      strategy: 'semantic-call',
      coverage: { complete: false, examinedCount: 1, totalKnownCount: 2, incompleteReasons: ['analysis-limit'] },
      boundaries: [{ kind: 'analysis-limit', evidenceRefs: ['ev:ctx-1'] }],
      recordedAt: '2025-01-01T00:00:00.000Z',
    });
    store.close();
    graph.addEdge({ id: 'e1', source: 'caller', target: 'target', kind: 'calls', certainty: 'candidate', evidenceRef: 'ev:ctx-1' });

    const result = buildChangeContext(graph, { changedFiles: ['src/target.ts'], repoDir });
    assert.equal(result.summary.highestRisk, 'UNKNOWN');
    assert.equal(result.certainty, 'lower-bound');
    assert.equal(result.coverage?.complete, false);
    assert.deepEqual(result.boundaries?.map((item) => item.kind), ['analysis-limit']);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });
});
