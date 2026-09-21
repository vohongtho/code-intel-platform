/**
 * Task 10.2: scaling benchmarks for contract drift. Contracts are processed via plain Map/object
 * lookups keyed by contractId (no SQL query text is ever built from a contract/consumer id set —
 * see contract-drift/service.ts and contract-consumer-index.ts), so the assertions here are
 * correctness-at-scale plus a generous wall-clock ceiling to catch an accidental quadratic
 * regression, not tight timing (timing budgets on shared CI hardware are inherently noisy).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { DbManager } from '../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../src/storage/graph-loader.js';
import { saveRegistry } from '../../src/storage/repo-registry.js';
import { saveGroup, saveSyncResult, deleteGroup } from '../../src/multi-repo/group-registry.js';
import { getGroupContractDrift } from '../../src/multi-repo/contract-drift/service.js';
import { buildContractConsumerIndex } from '../../src/multi-repo/contract-consumer-index.js';
import { DEFAULT_CANDIDATE_CAP } from '../../src/semantic/api-contracts/matcher.js';
import type { Contract, ContractLink } from '../../src/multi-repo/types.js';

function mkRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  fs.mkdirSync(path.join(dir, '.code-intel', 'snapshots'), { recursive: true });
  return dir;
}

async function writeSnapshotGraph(repoPath: string, snapshotId: string, graph: KnowledgeGraph): Promise<void> {
  const dir = path.join(repoPath, '.code-intel', 'snapshots', snapshotId);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DbManager(path.join(dir, 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
}

function schemaGraphAtScale(count: number, addRequiredFieldTo: (index: number) => boolean): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  for (let i = 0; i < count; i++) {
    const body = addRequiredFieldTo(i) ? 'id: string;\n  email: string;' : 'id: string;';
    graph.addNode({
      id: `schema-${i}`,
      identityId: `schema:user-${i}`,
      kind: 'interface',
      name: `Schema${i}`,
      filePath: `src/schema${i}.ts`,
      content: `export interface Schema${i} {\n  ${body}\n}`,
      metadata: {},
    });
  }
  return graph;
}

describe('contract drift performance at scale', () => {
  for (const size of [10, 100, 1000]) {
    it(`compares ${size} contracts with half genuinely changed, in bounded time`, async () => {
      const repoId = `bench-${size}`;
      const repoPath = mkRepo(repoId);
      await writeSnapshotGraph(repoPath, 'base', schemaGraphAtScale(size, () => false));
      await writeSnapshotGraph(repoPath, 'head', schemaGraphAtScale(size, (i) => i % 2 === 0));
      saveRegistry([{ id: repoId, name: repoId, path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: size, edges: 0, files: size } }]);

      const groupName = `bench-group-${size}`;
      deleteGroup(groupName);
      saveGroup({ name: groupName, createdAt: new Date().toISOString(), members: [{ groupPath: 'bench', repoId, registryName: repoId }] });
      saveSyncResult({ groupName, syncedAt: new Date().toISOString(), memberCount: 1, contracts: [], links: [], consumerIndex: { byContractId: {}, bySemanticFingerprint: {} } });

      const startedAt = Date.now();
      const result = await getGroupContractDrift({ groupName, baseSnapshotIds: { [repoId]: 'base' }, headSnapshotIds: { [repoId]: 'head' } });
      const elapsedMs = Date.now() - startedAt;

      const expectedChanged = Math.ceil(size / 2);
      assert.equal(result.metrics.contractsLoaded, size);
      assert.equal(result.metrics.fingerprintsChanged, expectedChanged);
      assert.equal(result.metrics.fingerprintsUnchangedSkipped, size - expectedChanged);
      assert.equal(result.totalFindings, expectedChanged, `expected exactly ${expectedChanged} findings among: ${result.findings.length} returned`);
      assert.ok(elapsedMs < 20_000, `drift over ${size} contracts took ${elapsedMs}ms — expected well under 20s`);

      deleteGroup(groupName);
      fs.rmSync(repoPath, { recursive: true, force: true });
    });
  }

  it('bounds reverse consumer expansion for 1000 candidate consumers rather than growing output unboundedly', () => {
    const producer: Contract = {
      repositoryId: 'repo-a', repoName: 'repo-a', repoPath: '/a', kind: 'event', name: 'BigEvent',
      nodeId: 'sym:a:event', nodeKind: 'interface', filePath: 'src/event.ts', sourceCanonicalId: 'sym:a:event',
      contractId: 'contract-a', semanticFingerprint: 'fingerprint-a',
    };
    const consumers: Contract[] = Array.from({ length: 1000 }, (_, i) => ({
      repositoryId: `repo-${i}`, repoName: `repo-${i}`, repoPath: `/repo-${i}`, kind: 'event' as const, name: 'BigEvent',
      nodeId: `sym:${i}:event`, nodeKind: 'interface', filePath: 'src/event.ts', sourceCanonicalId: `sym:${i}:event`,
      contractId: `contract-${i}`, semanticFingerprint: `fingerprint-${i}`,
    }));
    const links: ContractLink[] = consumers.map((consumer) => ({
      providerRepo: 'repo-a', providerContract: 'BigEvent', consumerRepo: consumer.repositoryId!, consumerContract: 'BigEvent',
      matchKind: 'name-match', confidence: 1, providerContractId: 'contract-a', consumerContractId: consumer.contractId,
      providerSourceCanonicalId: 'sym:a:event', consumerSourceCanonicalId: consumer.sourceCanonicalId,
      certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] },
    }));

    const startedAt = Date.now();
    const index = buildContractConsumerIndex({ contracts: [producer, ...consumers], links, memberFacts: [] });
    const elapsedMs = Date.now() - startedAt;

    const refs = index.byContractId['contract-a'] ?? [];
    assert.equal(refs.length, DEFAULT_CANDIDATE_CAP);
    assert.ok(refs.every((ref) => ref.coverage?.incompleteReasons.includes('consumer-cap-exceeded')));
    assert.ok(refs.every((ref) => ref.certainty === 'lower-bound'), 'a cap hit must lower-bound certainty, never claim exact/complete coverage');
    assert.ok(elapsedMs < 5_000, `consumer index build over 1000 candidates took ${elapsedMs}ms`);
  });
});
