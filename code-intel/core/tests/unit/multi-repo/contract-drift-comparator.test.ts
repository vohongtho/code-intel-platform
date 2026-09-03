import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { compareContractVersions } from '../../../src/multi-repo/contract-drift/comparator.js';
import type { Contract, ContractConsumerRef, GroupContractVersion } from '../../../src/multi-repo/types.js';

function version(overrides: Partial<GroupContractVersion> & Pick<GroupContractVersion, 'contractId' | 'kind' | 'repositoryId' | 'snapshotId' | 'semanticFingerprint' | 'role' | 'certainty' | 'coverage'>): GroupContractVersion {
  return {
    repositoryName: overrides.repositoryName ?? overrides.repositoryId,
    ...overrides,
  };
}

function contract(overrides: Partial<Contract> & Pick<Contract, 'repoName' | 'repoPath' | 'kind' | 'name' | 'nodeId' | 'nodeKind' | 'filePath'>): Contract {
  return { ...overrides } as Contract;
}

function consumer(key: string): ContractConsumerRef {
  return {
    repositoryId: 'consumer-repo',
    repositoryName: 'consumer-repo',
    consumerId: `consumer:${key}`,
    sourceCanonicalId: `consumer:${key}`,
    consumedFields: [key],
    callSites: [`consumer:${key}`],
    certainty: 'exact',
    coverage: { complete: true, examinedCount: 1, incompleteReasons: [] },
  };
}

describe('compareContractVersions', () => {
  it('delegates HTTP route findings to semantic api compatibility', () => {
    const baseGraph = createKnowledgeGraph();
    const headGraph = createKnowledgeGraph();
    baseGraph.addNode({
      id: 'route:base',
      identityId: 'route:base',
      kind: 'route',
      name: 'GET /users',
      filePath: 'src/routes.ts',
      metadata: { apiContract: { factId: 'route:base', language: 'typescript', method: 'GET', path: '/users', normalizedPath: '/users', framework: 'express', coverage: { complete: true, boundaryReasons: [] }, responses: [{ status: 200, responseShapeRef: 'shape:base', evidence: 'exact' }] } },
    });
    baseGraph.addNode({
      id: 'shape:base',
      identityId: 'shape:base',
      kind: 'api_shape',
      name: 'UsersResponse',
      filePath: 'src/routes.ts',
      metadata: { semantic: { factId: 'shape:base', language: 'typescript', shapeFactKind: 'http-response-shape', shapeFingerprint: 'shape:base', status: 200, origin: { kind: 'inline', fields: [{ key: 'id', required: true }, { key: 'ssn', required: true }] }, coverage: { complete: true, boundaryReasons: [] } } },
    });
    headGraph.addNode({
      id: 'route:head',
      identityId: 'route:head',
      kind: 'route',
      name: 'GET /users',
      filePath: 'src/routes.ts',
      metadata: { apiContract: { factId: 'route:head', language: 'typescript', method: 'GET', path: '/users', normalizedPath: '/users', framework: 'express', coverage: { complete: true, boundaryReasons: [] }, responses: [{ status: 200, responseShapeRef: 'shape:head', evidence: 'exact' }] } },
    });
    headGraph.addNode({
      id: 'shape:head',
      identityId: 'shape:head',
      kind: 'api_shape',
      name: 'UsersResponse',
      filePath: 'src/routes.ts',
      metadata: { semantic: { factId: 'shape:head', language: 'typescript', shapeFactKind: 'http-response-shape', shapeFingerprint: 'shape:head', status: 200, origin: { kind: 'inline', fields: [{ key: 'id', required: true }] }, coverage: { complete: true, boundaryReasons: [] } } },
    });

    const findings = compareContractVersions({
      kind: 'route',
      baseVersion: version({ contractId: 'route-contract', kind: 'route', repositoryId: 'backend', snapshotId: 'base', semanticFingerprint: 'a', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }),
      headVersion: version({ contractId: 'route-contract', kind: 'route', repositoryId: 'backend', snapshotId: 'head', semanticFingerprint: 'b', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }),
      baseContract: contract({ repoName: 'backend', repoPath: '/backend', kind: 'route', name: 'GET /users', nodeId: 'route:base', nodeKind: 'route', filePath: 'src/routes.ts', sourceCanonicalId: 'route:base' }),
      headContract: contract({ repoName: 'backend', repoPath: '/backend', kind: 'route', name: 'GET /users', nodeId: 'route:head', nodeKind: 'route', filePath: 'src/routes.ts', sourceCanonicalId: 'route:head' }),
      baseGraph,
      headGraph,
      affectedConsumers: [consumer('ssn')],
    });

    assert.equal(findings.some((finding) => finding.changeKind === 'response-field-removed' && finding.compatibility === 'breaking'), true);
  });

  it('flags consumed schema field removal as breaking', () => {
    const baseGraph = createKnowledgeGraph();
    const headGraph = createKnowledgeGraph();
    baseGraph.addNode({ id: 'schema:base', identityId: 'schema:user', kind: 'interface', name: 'User', filePath: 'src/user.ts', content: 'export interface User {\n  id: string;\n  email?: string;\n}', metadata: {} });
    headGraph.addNode({ id: 'schema:head', identityId: 'schema:user', kind: 'interface', name: 'User', filePath: 'src/user.ts', content: 'export interface User {\n  id: string;\n}', metadata: {} });

    const findings = compareContractVersions({
      kind: 'schema',
      baseVersion: version({ contractId: 'schema-contract', kind: 'schema', repositoryId: 'shared', snapshotId: 'base', semanticFingerprint: 'a', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }),
      headVersion: version({ contractId: 'schema-contract', kind: 'schema', repositoryId: 'shared', snapshotId: 'head', semanticFingerprint: 'b', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }),
      baseContract: contract({ repoName: 'shared', repoPath: '/shared', kind: 'schema', name: 'User', nodeId: 'schema:base', nodeKind: 'interface', filePath: 'src/user.ts', sourceCanonicalId: 'schema:user' }),
      headContract: contract({ repoName: 'shared', repoPath: '/shared', kind: 'schema', name: 'User', nodeId: 'schema:head', nodeKind: 'interface', filePath: 'src/user.ts', sourceCanonicalId: 'schema:user' }),
      baseGraph,
      headGraph,
      affectedConsumers: [consumer('email')],
    });

    assert.equal(findings.some((finding) => finding.changeKind === 'schema-property-removed' && finding.compatibility === 'breaking'), true);
  });

  it('flags a newly-required schema field as potentially-breaking', () => {
    const baseGraph = createKnowledgeGraph();
    const headGraph = createKnowledgeGraph();
    baseGraph.addNode({ id: 'schema:base', identityId: 'schema:user', kind: 'interface', name: 'User', filePath: 'src/user.ts', content: 'export interface User {\n  id: string;\n  nickname?: string;\n}', metadata: {} });
    headGraph.addNode({ id: 'schema:head', identityId: 'schema:user', kind: 'interface', name: 'User', filePath: 'src/user.ts', content: 'export interface User {\n  id: string;\n  nickname: string;\n}', metadata: {} });

    const findings = compareContractVersions({
      kind: 'schema',
      baseVersion: version({ contractId: 'schema-contract', kind: 'schema', repositoryId: 'shared', snapshotId: 'base', semanticFingerprint: 'a', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }),
      headVersion: version({ contractId: 'schema-contract', kind: 'schema', repositoryId: 'shared', snapshotId: 'head', semanticFingerprint: 'b', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }),
      baseContract: contract({ repoName: 'shared', repoPath: '/shared', kind: 'schema', name: 'User', nodeId: 'schema:base', nodeKind: 'interface', filePath: 'src/user.ts', sourceCanonicalId: 'schema:user' }),
      headContract: contract({ repoName: 'shared', repoPath: '/shared', kind: 'schema', name: 'User', nodeId: 'schema:head', nodeKind: 'interface', filePath: 'src/user.ts', sourceCanonicalId: 'schema:user' }),
      baseGraph,
      headGraph,
      affectedConsumers: [consumer('id')],
    });

    assert.equal(findings.some((finding) => finding.changeKind === 'schema-property-became-required' && finding.compatibility === 'potentially-breaking'), true);
  });

  it('keeps dynamic event payloads unknown/partial', () => {
    const baseGraph = createKnowledgeGraph();
    const headGraph = createKnowledgeGraph();
    baseGraph.addNode({ id: 'event:base', identityId: 'event:user-created', kind: 'interface', name: 'UserCreatedEvent', filePath: 'src/events.ts', metadata: {} });
    headGraph.addNode({ id: 'event:head', identityId: 'event:user-created', kind: 'interface', name: 'UserCreatedEvent', filePath: 'src/events.ts', metadata: {} });

    const findings = compareContractVersions({
      kind: 'event',
      baseVersion: version({ contractId: 'event-contract', kind: 'event', repositoryId: 'events', snapshotId: 'base', semanticFingerprint: 'a', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }),
      headVersion: version({ contractId: 'event-contract', kind: 'event', repositoryId: 'events', snapshotId: 'head', semanticFingerprint: 'b', role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }),
      baseContract: contract({ repoName: 'events', repoPath: '/events', kind: 'event', name: 'UserCreatedEvent', nodeId: 'event:base', nodeKind: 'interface', filePath: 'src/events.ts', sourceCanonicalId: 'event:user-created' }),
      headContract: contract({ repoName: 'events', repoPath: '/events', kind: 'event', name: 'UserCreatedEvent', nodeId: 'event:head', nodeKind: 'interface', filePath: 'src/events.ts', sourceCanonicalId: 'event:user-created' }),
      baseGraph,
      headGraph,
      affectedConsumers: [consumer('email')],
    });

    assert.equal(findings[0]?.compatibility, 'unknown');
    assert.equal(findings[0]?.coverage.complete, false);
  });
});
