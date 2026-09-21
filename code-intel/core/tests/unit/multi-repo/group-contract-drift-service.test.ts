import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { saveRegistry } from '../../../src/storage/repo-registry.js';
import { saveGroup, saveSyncResult } from '../../../src/multi-repo/group-registry.js';
import { getGroupContractDrift } from '../../../src/multi-repo/contract-drift/service.js';
import type { GroupSyncResult } from '../../../src/multi-repo/types.js';

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

function routeGraph(responseFields: readonly string[]): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  const shapeId = `shape-fact:${responseFields.join(',')}`;
  graph.addNode({
    id: 'route-node',
    identityId: 'route-fact',
    kind: 'route',
    name: 'GET /users',
    filePath: 'src/routes.ts',
    metadata: { apiContract: { factId: 'route-fact', language: 'typescript', method: 'GET', path: '/users', normalizedPath: '/users', framework: 'express', coverage: { complete: true, boundaryReasons: [] }, responses: [{ status: 200, responseShapeRef: shapeId, evidence: 'exact' }] } },
  });
  graph.addNode({
    id: shapeId,
    identityId: shapeId,
    kind: 'api_shape',
    name: 'UsersResponse',
    filePath: 'src/routes.ts',
    metadata: { semantic: { factId: shapeId, language: 'typescript', shapeFactKind: 'http-response-shape', shapeFingerprint: shapeId, status: 200, origin: { kind: 'inline', fields: responseFields.map((key) => ({ key, required: true })) }, coverage: { complete: true, boundaryReasons: [] } } },
  });
  return graph;
}

function schemaGraph(content: string): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  graph.addNode({ id: 'schema-node', identityId: 'schema:user', kind: 'interface', name: 'UserDto', filePath: 'src/user.ts', content, metadata: {} });
  return graph;
}

function consumerFlowGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  graph.addNode({ id: 'caller-node', kind: 'function', name: 'handleRequest', filePath: 'src/handler.ts', metadata: {} });
  graph.addNode({ id: 'consumer-node', kind: 'function', name: 'loadUser', filePath: 'src/client.ts', metadata: {} });
  graph.addNode({ id: 'flow-1', kind: 'flow', name: 'handleRequest flow 0', filePath: 'src/handler.ts', metadata: { steps: ['caller-node', 'consumer-node'], entryPoint: 'handleRequest' } });
  graph.addEdge({ id: 'edge-calls', source: 'caller-node', target: 'consumer-node', kind: 'calls', weight: 1 });
  graph.addEdge({ id: 'edge-step-caller', source: 'caller-node', target: 'flow-1', kind: 'step_of', weight: 1, label: 'step 1' });
  graph.addEdge({ id: 'edge-step-consumer', source: 'consumer-node', target: 'flow-1', kind: 'step_of', weight: 1, label: 'step 2' });
  return graph;
}

describe('getGroupContractDrift', () => {
  it('compares provided snapshots per repo and returns partial-safe summary', async () => {
    const backendPath = mkRepo('drift-backend');
    const sharedPath = mkRepo('drift-shared');
    await writeSnapshotGraph(backendPath, 'base-backend', routeGraph(['id', 'ssn']));
    await writeSnapshotGraph(backendPath, 'head-backend', routeGraph(['id']));
    await writeSnapshotGraph(sharedPath, 'base-shared', schemaGraph('export interface UserDto {\n  id: string;\n  email?: string;\n}'));
    await writeSnapshotGraph(sharedPath, 'head-shared', schemaGraph('export interface UserDto {\n  id: string;\n}'));

    saveRegistry([
      { id: 'backend', name: 'backend', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 2, edges: 0, files: 1 } },
      { id: 'shared', name: 'shared', path: sharedPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } },
    ]);
    saveGroup({
      name: 'drift-group',
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'backend', repoId: 'backend', registryName: 'backend' },
        { groupPath: 'shared', repoId: 'shared', registryName: 'shared' },
      ],
    });

    const syncResult: GroupSyncResult = {
      groupName: 'drift-group',
      syncedAt: new Date().toISOString(),
      memberCount: 2,
      contracts: [
        { repoName: 'backend', repoPath: backendPath, repositoryId: 'backend', kind: 'route', name: 'GET /users', nodeId: 'route-node', nodeKind: 'route', filePath: 'src/routes.ts', method: 'GET', normalizedPath: '/users', sourceCanonicalId: 'route-fact', contractId: 'backend-route', snapshotId: 'head-backend', semanticFingerprint: 'fp-route', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } },
        { repoName: 'shared', repoPath: sharedPath, repositoryId: 'shared', kind: 'schema', name: 'UserDto', nodeId: 'schema-node', nodeKind: 'interface', filePath: 'src/user.ts', sourceCanonicalId: 'schema:user', contractId: 'shared-schema', snapshotId: 'head-shared', semanticFingerprint: 'fp-schema', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } },
      ],
      links: [],
      schemaVersion: '1.0.11',
      contractVersions: [],
      consumerIndex: {
        byContractId: {
          'backend-route': [{ repositoryId: 'frontend', consumerId: 'consumer:ssn', sourceCanonicalId: 'consumer:ssn', certainty: 'exact', consumedFields: ['ssn'], callSites: ['consumer:ssn'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }],
          'shared-schema': [{ repositoryId: 'frontend', consumerId: 'consumer:email', sourceCanonicalId: 'consumer:email', certainty: 'exact', consumedFields: ['email'], callSites: ['consumer:email'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }],
        },
        bySemanticFingerprint: {
          a: [{ repositoryId: 'frontend', consumerId: 'consumer:ssn', sourceCanonicalId: 'consumer:ssn', certainty: 'exact', consumedFields: ['ssn'], callSites: ['consumer:ssn'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }],
          b: [{ repositoryId: 'frontend', consumerId: 'consumer:ssn', sourceCanonicalId: 'consumer:ssn', certainty: 'exact', consumedFields: ['ssn'], callSites: ['consumer:ssn'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }],
        },
      },
    };
    saveSyncResult(syncResult);

    const result = await getGroupContractDrift({
      groupName: 'drift-group',
      baseSnapshotIds: { backend: 'base-backend', shared: 'base-shared' },
      headSnapshotIds: { backend: 'head-backend', shared: 'head-shared' },
    });

    assert.equal(result.totalFindings >= 2, true);
    assert.equal(result.findings.some((finding) => finding.changeKind === 'response-field-removed' && finding.compatibility === 'breaking'), true);
    assert.equal(result.findings.some((finding) => finding.changeKind === 'schema-property-removed' && finding.compatibility === 'breaking'), true);
    assert.equal(result.summary.coverage.incompleteReasons.includes('output-truncated:1'), false);

    // task 10.1: observability counters — both contracts genuinely changed, so both went
    // through the full comparator (nothing was skip-eligible or fell back).
    assert.equal(result.metrics.contractsLoaded, 2);
    assert.equal(result.metrics.comparisonsExecuted, 2);
    assert.equal(result.metrics.fingerprintsUnchangedSkipped, 0);
    assert.equal(result.metrics.fingerprintsChanged, 2);
    assert.equal(result.metrics.fullFallbackCount, 0);
    assert.equal(result.metrics.partialRepositories, 0);
    assert.equal(typeof result.metrics.elapsedMs, 'number');

    fs.rmSync(backendPath, { recursive: true, force: true });
    fs.rmSync(sharedPath, { recursive: true, force: true });
  });

  it('returns partial coverage when one repo snapshot is missing', async () => {
    const repoPath = mkRepo('drift-missing');
    await writeSnapshotGraph(repoPath, 'head-only', schemaGraph('export interface UserDto {\n  id: string;\n}'));
    saveRegistry([{ id: 'shared-missing', name: 'shared-missing', path: repoPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);
    saveGroup({ name: 'drift-group-missing', createdAt: new Date().toISOString(), members: [{ groupPath: 'shared', repoId: 'shared-missing', registryName: 'shared-missing' }] });
    saveSyncResult({ groupName: 'drift-group-missing', syncedAt: new Date().toISOString(), memberCount: 1, contracts: [], links: [], consumerIndex: { byContractId: {}, bySemanticFingerprint: {} } });

    const result = await getGroupContractDrift({
      groupName: 'drift-group-missing',
      baseSnapshotIds: { 'shared-missing': 'base-missing' },
      headSnapshotIds: { 'shared-missing': 'head-only' },
    });

    assert.equal(result.summary.coverage.complete, false);
    assert.equal(result.summary.coverage.incompleteReasons.some((reason) => reason.includes('base unavailable for shared-missing')), true);
    assert.equal(result.metrics.partialRepositories, 1);

    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('attaches flow/test guidance only for exact-certainty consumers of breaking findings', async () => {
    const backendPath = mkRepo('drift-backend-flow');
    const frontendPath = mkRepo('drift-frontend-flow');
    await writeSnapshotGraph(backendPath, 'base-backend', routeGraph(['id', 'ssn']));
    await writeSnapshotGraph(backendPath, 'head-backend', routeGraph(['id']));
    const frontendGraph = consumerFlowGraph();
    await writeSnapshotGraph(frontendPath, 'base-frontend', frontendGraph);
    await writeSnapshotGraph(frontendPath, 'head-frontend', frontendGraph);

    saveRegistry([
      { id: 'backend-flow', name: 'backend-flow', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 2, edges: 0, files: 1 } },
      { id: 'frontend-flow', name: 'frontend-flow', path: frontendPath, indexedAt: new Date().toISOString(), stats: { nodes: 3, edges: 3, files: 1 } },
    ]);
    saveGroup({
      name: 'drift-flow-group',
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'backend', repoId: 'backend-flow', registryName: 'backend-flow' },
        { groupPath: 'frontend', repoId: 'frontend-flow', registryName: 'frontend-flow' },
      ],
    });

    const syncResult: GroupSyncResult = {
      groupName: 'drift-flow-group',
      syncedAt: new Date().toISOString(),
      memberCount: 2,
      contracts: [
        { repoName: 'backend-flow', repoPath: backendPath, repositoryId: 'backend-flow', kind: 'route', name: 'GET /users', nodeId: 'route-node', nodeKind: 'route', filePath: 'src/routes.ts', method: 'GET', normalizedPath: '/users', sourceCanonicalId: 'route-fact', contractId: 'backend-route', snapshotId: 'head-backend', semanticFingerprint: 'fp-route', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } },
      ],
      links: [],
      schemaVersion: '1.0.11',
      contractVersions: [],
      consumerIndex: {
        byContractId: {
          'backend-route': [
            { repositoryId: 'frontend-flow', consumerId: 'consumer-node', sourceCanonicalId: 'consumer-node', certainty: 'exact', consumedFields: ['ssn'], callSites: ['consumer-node'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } },
            { repositoryId: 'frontend-flow', consumerId: 'heuristic-consumer', sourceCanonicalId: 'heuristic-consumer', certainty: 'heuristic', confidence: 0.4, coverage: { complete: false, examinedCount: 1, incompleteReasons: ['name-match-only'] } },
          ],
        },
        bySemanticFingerprint: {},
      },
    };
    saveSyncResult(syncResult);

    const result = await getGroupContractDrift({
      groupName: 'drift-flow-group',
      baseSnapshotIds: { 'backend-flow': 'base-backend', 'frontend-flow': 'base-frontend' },
      headSnapshotIds: { 'backend-flow': 'head-backend', 'frontend-flow': 'head-frontend' },
    });

    const breaking = result.findings.find((finding) => finding.changeKind === 'response-field-removed');
    assert.ok(breaking, `expected a response-field-removed finding among: ${JSON.stringify(result.findings)}`);
    assert.equal(breaking!.suggestedTests?.length, 1);
    assert.equal(breaking!.suggestedTests?.[0]?.symbol, 'loadUser');
    assert.equal(breaking!.suggestedTests?.[0]?.consumerId, 'consumer-node');
    assert.deepEqual([...(breaking!.suggestedTests?.[0]?.relatedFlowIds ?? [])], ['flow-1']);
    assert.equal((breaking!.suggestedTests?.[0]?.suggestedCases.length ?? 0) > 0, true);
    assert.equal(breaking!.suggestedTests?.some((s) => s.consumerId === 'heuristic-consumer'), false);

    fs.rmSync(backendPath, { recursive: true, force: true });
    fs.rmSync(frontendPath, { recursive: true, force: true });
  });

  it('reports no findings for a route/schema pair that is byte-for-byte unchanged between base and head (incremental skip path)', async () => {
    const backendPath = mkRepo('drift-backend-unchanged');
    const sharedPath = mkRepo('drift-shared-unchanged');
    await writeSnapshotGraph(backendPath, 'base-backend', routeGraph(['id', 'name']));
    await writeSnapshotGraph(backendPath, 'head-backend', routeGraph(['id', 'name']));
    await writeSnapshotGraph(sharedPath, 'base-shared', schemaGraph('export interface UserDto {\n  id: string;\n  name: string;\n}'));
    await writeSnapshotGraph(sharedPath, 'head-shared', schemaGraph('export interface UserDto {\n  id: string;\n  name: string;\n}'));

    saveRegistry([
      { id: 'backend-unchanged', name: 'backend-unchanged', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 2, edges: 0, files: 1 } },
      { id: 'shared-unchanged', name: 'shared-unchanged', path: sharedPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } },
    ]);
    saveGroup({
      name: 'drift-unchanged-group',
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'backend', repoId: 'backend-unchanged', registryName: 'backend-unchanged' },
        { groupPath: 'shared', repoId: 'shared-unchanged', registryName: 'shared-unchanged' },
      ],
    });
    saveSyncResult({
      groupName: 'drift-unchanged-group',
      syncedAt: new Date().toISOString(),
      memberCount: 2,
      contracts: [],
      links: [],
      consumerIndex: { byContractId: {}, bySemanticFingerprint: {} },
    });

    const result = await getGroupContractDrift({
      groupName: 'drift-unchanged-group',
      baseSnapshotIds: { 'backend-unchanged': 'base-backend', 'shared-unchanged': 'base-shared' },
      headSnapshotIds: { 'backend-unchanged': 'head-backend', 'shared-unchanged': 'head-shared' },
    });

    assert.equal(result.totalFindings, 0);
    assert.equal(result.summary.byCompatibility.breaking, 0);
    assert.equal(result.summary.byCompatibility['potentially-breaking'], 0);
    assert.equal(result.summary.byCompatibility.unknown, 0);

    // task 10.1/8.2: both contracts were provably unchanged, so both were skip-eligible —
    // the deep comparator never ran.
    assert.equal(result.metrics.contractsLoaded, 2);
    assert.equal(result.metrics.fingerprintsUnchangedSkipped, 2);
    assert.equal(result.metrics.comparisonsExecuted, 0);
    assert.equal(result.metrics.fullFallbackCount, 0);

    fs.rmSync(backendPath, { recursive: true, force: true });
    fs.rmSync(sharedPath, { recursive: true, force: true });
  });

  it('reports partial coverage — not a crash or a silently-clean result — for a group member that was never synchronized (not in the repo registry)', async () => {
    const backendPath = mkRepo('drift-backend-unsynced');
    await writeSnapshotGraph(backendPath, 'base-backend', routeGraph(['id']));
    await writeSnapshotGraph(backendPath, 'head-backend', routeGraph(['id']));
    saveRegistry([{ id: 'backend-unsynced', name: 'backend-unsynced', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } }]);
    saveGroup({
      name: 'drift-unsynced-group',
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'backend', repoId: 'backend-unsynced', registryName: 'backend-unsynced' },
        // "missing" member was added to the group but never analyzed/registered.
        { groupPath: 'missing', repoId: 'never-registered', registryName: 'never-registered' },
      ],
    });
    saveSyncResult({ groupName: 'drift-unsynced-group', syncedAt: new Date().toISOString(), memberCount: 2, contracts: [], links: [], consumerIndex: { byContractId: {}, bySemanticFingerprint: {} } });

    const result = await getGroupContractDrift({
      groupName: 'drift-unsynced-group',
      baseSnapshotIds: { 'backend-unsynced': 'base-backend' },
      headSnapshotIds: { 'backend-unsynced': 'head-backend' },
    });

    assert.equal(result.summary.coverage.complete, false);
    assert.equal(result.summary.coverage.incompleteReasons.some((reason) => reason.includes('missing repo registry entry: never-registered')), true);

    fs.rmSync(backendPath, { recursive: true, force: true });
  });

  it('sorts findings deterministically and sorts affectedConsumers within a finding, stably across repeated identical requests (tasks 10.3/12.4)', async () => {
    const backendPath = mkRepo('drift-backend-sort');
    const sharedPath = mkRepo('drift-shared-sort');
    await writeSnapshotGraph(backendPath, 'base-backend', routeGraph(['id', 'ssn']));
    await writeSnapshotGraph(backendPath, 'head-backend', routeGraph(['id']));
    await writeSnapshotGraph(sharedPath, 'base-shared', schemaGraph('export interface UserDto {\n  id: string;\n  email: string;\n}'));
    await writeSnapshotGraph(sharedPath, 'head-shared', schemaGraph('export interface UserDto {\n  id: string;\n}'));

    saveRegistry([
      { id: 'sort-backend', name: 'sort-backend', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 2, edges: 0, files: 1 } },
      { id: 'sort-shared', name: 'sort-shared', path: sharedPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } },
    ]);
    saveGroup({
      name: 'drift-sort-group',
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'backend', repoId: 'sort-backend', registryName: 'sort-backend' },
        { groupPath: 'shared', repoId: 'sort-shared', registryName: 'sort-shared' },
      ],
    });
    saveSyncResult({
      groupName: 'drift-sort-group',
      syncedAt: new Date().toISOString(),
      memberCount: 2,
      // contractId here is an arbitrary but stable label — the lookup below resolves this sync
      // snapshot to the freshly re-extracted contract via matching sourceCanonicalId, then keys
      // the consumer index off this contractId (see getGroupContractDrift's syncContract
      // fallback chain), exactly as group-sync.ts would have persisted it at sync time.
      contracts: [
        { repoName: 'sort-backend', repoPath: backendPath, repositoryId: 'sort-backend', kind: 'route', name: 'GET /users', nodeId: 'route-node', nodeKind: 'route', filePath: 'src/routes.ts', method: 'GET', normalizedPath: '/users', sourceCanonicalId: 'route-fact', contractId: 'sort-route' },
        { repoName: 'sort-shared', repoPath: sharedPath, repositoryId: 'sort-shared', kind: 'schema', name: 'UserDto', nodeId: 'schema-node', nodeKind: 'interface', filePath: 'src/user.ts', sourceCanonicalId: 'schema:user', contractId: 'sort-schema' },
      ],
      links: [],
      consumerIndex: {
        // Deliberately out of order (repo-z before repo-a, and within a repo, consumer:zzz
        // before consumer:aaa) — the returned affectedConsumers must come back sorted
        // regardless of this input order.
        byContractId: {
          'sort-route': [
            { repositoryId: 'repo-z', consumerId: 'consumer:zzz', sourceCanonicalId: 'consumer:zzz', certainty: 'exact', consumedFields: ['ssn'], callSites: ['consumer:zzz'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } },
            { repositoryId: 'repo-a', consumerId: 'consumer:zzz', sourceCanonicalId: 'consumer:zzz', certainty: 'exact', consumedFields: ['ssn'], callSites: ['consumer:zzz'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } },
            { repositoryId: 'repo-a', consumerId: 'consumer:aaa', sourceCanonicalId: 'consumer:aaa', certainty: 'exact', consumedFields: ['ssn'], callSites: ['consumer:aaa'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } },
          ],
          'sort-schema': [{ repositoryId: 'repo-a', consumerId: 'consumer:email', sourceCanonicalId: 'consumer:email', certainty: 'exact', consumedFields: ['email'], callSites: ['consumer:email'], coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }],
        },
        bySemanticFingerprint: {},
      },
    });

    const request = {
      groupName: 'drift-sort-group',
      baseSnapshotIds: { 'sort-backend': 'base-backend', 'sort-shared': 'base-shared' },
      headSnapshotIds: { 'sort-backend': 'head-backend', 'sort-shared': 'head-shared' },
    };
    const first = await getGroupContractDrift(request);
    const second = await getGroupContractDrift(request);

    // Repeated identical requests must produce byte-identical output (elapsedMs is the one
    // legitimately-varying field — a wall-clock timer, not part of the analysis result).
    assert.deepEqual({ ...first, metrics: { ...first.metrics, elapsedMs: 0 } }, { ...second, metrics: { ...second.metrics, elapsedMs: 0 } });

    // Top-level findings sorted by repositoryId, then kind, then contractId, then changeKind,
    // then summary — verify the array is already in that order (not just deepEqual to itself).
    const expectedOrder = [...first.findings].sort((a, b) =>
      a.repositoryId.localeCompare(b.repositoryId)
      || a.kind.localeCompare(b.kind)
      || a.contractId.localeCompare(b.contractId)
      || a.changeKind.localeCompare(b.changeKind)
      || a.summary.localeCompare(b.summary),
    );
    assert.deepEqual(first.findings, expectedOrder);

    // Within a finding, affectedConsumers sorted by repositoryId, then consumerId, then
    // sourceAnchor — never left in whatever order the sync-time consumer index happened to list.
    for (const finding of first.findings) {
      const expectedConsumerOrder = [...finding.affectedConsumers].sort((a, b) =>
        a.repositoryId.localeCompare(b.repositoryId)
        || a.consumerId.localeCompare(b.consumerId)
        || (a.sourceAnchor ?? '').localeCompare(b.sourceAnchor ?? ''),
      );
      assert.deepEqual(finding.affectedConsumers, expectedConsumerOrder);
    }

    fs.rmSync(backendPath, { recursive: true, force: true });
    fs.rmSync(sharedPath, { recursive: true, force: true });
  });

  it('narrows analysis with kind/repositoryId filters while still loading every member repo', async () => {
    const backendPath = mkRepo('drift-backend-filter');
    const sharedPath = mkRepo('drift-shared-filter');
    await writeSnapshotGraph(backendPath, 'base-backend', routeGraph(['id', 'ssn']));
    await writeSnapshotGraph(backendPath, 'head-backend', routeGraph(['id']));
    await writeSnapshotGraph(sharedPath, 'base-shared', schemaGraph('export interface UserDto {\n  id: string;\n  email?: string;\n}'));
    await writeSnapshotGraph(sharedPath, 'head-shared', schemaGraph('export interface UserDto {\n  id: string;\n}'));

    saveRegistry([
      { id: 'filter-backend', name: 'filter-backend', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 2, edges: 0, files: 1 } },
      { id: 'filter-shared', name: 'filter-shared', path: sharedPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } },
    ]);
    saveGroup({
      name: 'drift-filter-group',
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'backend', repoId: 'filter-backend', registryName: 'filter-backend' },
        { groupPath: 'shared', repoId: 'filter-shared', registryName: 'filter-shared' },
      ],
    });
    saveSyncResult({
      groupName: 'drift-filter-group',
      syncedAt: new Date().toISOString(),
      memberCount: 2,
      contracts: [],
      links: [],
      consumerIndex: { byContractId: {}, bySemanticFingerprint: {} },
    });

    const baseSnapshotIds = { 'filter-backend': 'base-backend', 'filter-shared': 'base-shared' };
    const headSnapshotIds = { 'filter-backend': 'head-backend', 'filter-shared': 'head-shared' };

    const schemaOnly = await getGroupContractDrift({ groupName: 'drift-filter-group', baseSnapshotIds, headSnapshotIds, kind: 'schema' });
    assert.equal(schemaOnly.findings.length > 0, true);
    assert.equal(schemaOnly.findings.every((finding) => finding.kind === 'schema'), true);
    assert.equal(schemaOnly.findings.some((finding) => finding.changeKind === 'response-field-removed'), false);

    const backendRepoOnly = await getGroupContractDrift({ groupName: 'drift-filter-group', baseSnapshotIds, headSnapshotIds, repositoryId: 'filter-backend' });
    assert.equal(backendRepoOnly.findings.length > 0, true);
    assert.equal(backendRepoOnly.findings.every((finding) => finding.repositoryId === 'filter-backend'), true);
    assert.equal(backendRepoOnly.findings.some((finding) => finding.changeKind === 'schema-property-removed'), false);

    // metrics.contractsLoaded reflects the filtered set, not the group's raw total.
    const unfiltered = await getGroupContractDrift({ groupName: 'drift-filter-group', baseSnapshotIds, headSnapshotIds });
    assert.equal(schemaOnly.metrics.contractsLoaded < unfiltered.metrics.contractsLoaded, true);

    fs.rmSync(backendPath, { recursive: true, force: true });
    fs.rmSync(sharedPath, { recursive: true, force: true });
  });

  it('truncates presented findings under a limit while totalFindings still reflects the full analysis (spec: presentation limits must not alter analysis truth)', async () => {
    const backendPath = mkRepo('drift-backend-truncate');
    const sharedPath = mkRepo('drift-shared-truncate');
    await writeSnapshotGraph(backendPath, 'base-backend', routeGraph(['id', 'ssn']));
    await writeSnapshotGraph(backendPath, 'head-backend', routeGraph(['id']));
    await writeSnapshotGraph(sharedPath, 'base-shared', schemaGraph('export interface UserDto {\n  id: string;\n  email?: string;\n}'));
    await writeSnapshotGraph(sharedPath, 'head-shared', schemaGraph('export interface UserDto {\n  id: string;\n}'));

    saveRegistry([
      { id: 'trunc-backend', name: 'trunc-backend', path: backendPath, indexedAt: new Date().toISOString(), stats: { nodes: 2, edges: 0, files: 1 } },
      { id: 'trunc-shared', name: 'trunc-shared', path: sharedPath, indexedAt: new Date().toISOString(), stats: { nodes: 1, edges: 0, files: 1 } },
    ]);
    saveGroup({
      name: 'drift-truncate-group',
      createdAt: new Date().toISOString(),
      members: [
        { groupPath: 'backend', repoId: 'trunc-backend', registryName: 'trunc-backend' },
        { groupPath: 'shared', repoId: 'trunc-shared', registryName: 'trunc-shared' },
      ],
    });
    saveSyncResult({
      groupName: 'drift-truncate-group',
      syncedAt: new Date().toISOString(),
      memberCount: 2,
      contracts: [],
      links: [],
      consumerIndex: { byContractId: {}, bySemanticFingerprint: {} },
    });

    const baseSnapshotIds = { 'trunc-backend': 'base-backend', 'trunc-shared': 'base-shared' };
    const headSnapshotIds = { 'trunc-backend': 'head-backend', 'trunc-shared': 'head-shared' };

    const full = await getGroupContractDrift({ groupName: 'drift-truncate-group', baseSnapshotIds, headSnapshotIds });
    assert.equal(full.totalFindings >= 2, true, 'fixture must produce at least 2 findings for truncation to be meaningful');

    const truncated = await getGroupContractDrift({ groupName: 'drift-truncate-group', baseSnapshotIds, headSnapshotIds, limit: 1 });
    assert.equal(truncated.findings.length, 1);
    assert.equal(truncated.totalFindings, full.totalFindings, 'totalFindings must reflect the full analysis, not the presented page');
    assert.equal(truncated.summary.totalFindings, full.totalFindings, 'the summary itself must also reflect full analysis truth');
    assert.equal(truncated.summary.coverage.incompleteReasons.includes('output-truncated:1'), true);

    fs.rmSync(backendPath, { recursive: true, force: true });
    fs.rmSync(sharedPath, { recursive: true, force: true });
  });
});
