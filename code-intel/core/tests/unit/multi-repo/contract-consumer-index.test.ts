import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildContractConsumerIndex } from '../../../src/multi-repo/contract-consumer-index.js';
import type { Contract, ContractLink } from '../../../src/multi-repo/types.js';

describe('buildContractConsumerIndex', () => {
  it('prefers exact linked schema/event refs over display-name-only matching', () => {
    const producer: Contract = {
      repositoryId: 'repo-a',
      repoName: 'repo-a',
      repoPath: '/a',
      kind: 'schema',
      name: 'User',
      nodeId: 'sym:a:user',
      nodeKind: 'interface',
      filePath: 'src/user.ts',
      sourceCanonicalId: 'sym:a:user',
      contractId: 'contract-a',
      semanticFingerprint: 'fingerprint-a',
    };
    const exactConsumer: Contract = {
      repositoryId: 'repo-b',
      repoName: 'repo-b',
      repoPath: '/b',
      kind: 'schema',
      name: 'User',
      nodeId: 'sym:b:user',
      nodeKind: 'interface',
      filePath: 'src/user.ts',
      sourceCanonicalId: 'sym:b:user',
      contractId: 'contract-b',
      semanticFingerprint: 'fingerprint-b',
    };
    const ambiguousSameName: Contract = {
      repositoryId: 'repo-c',
      repoName: 'repo-c',
      repoPath: '/c',
      kind: 'schema',
      name: 'User',
      nodeId: 'sym:c:user',
      nodeKind: 'interface',
      filePath: 'src/user.ts',
      sourceCanonicalId: 'sym:c:user',
      contractId: 'contract-c',
      semanticFingerprint: 'fingerprint-c',
    };

    const links: ContractLink[] = [{
      providerRepo: 'repo-a',
      providerContract: 'User',
      consumerRepo: 'repo-b',
      consumerContract: 'User',
      matchKind: 'name-match',
      confidence: 1,
      providerContractId: 'contract-a',
      consumerContractId: 'contract-b',
      providerSourceCanonicalId: 'sym:a:user',
      consumerSourceCanonicalId: 'sym:b:user',
      certainty: 'exact',
      coverage: { complete: true, examinedCount: 1, incompleteReasons: [] },
    }];

    const index = buildContractConsumerIndex({
      contracts: [producer, exactConsumer, ambiguousSameName],
      links,
      memberFacts: [],
    });

    assert.deepEqual(index.byContractId['contract-a']?.map((ref) => ref.repositoryId), ['repo-b']);
    assert.deepEqual(index.bySemanticFingerprint['fingerprint-a']?.map((ref) => ref.sourceCanonicalId), ['sym:b:user']);
  });

  it('caps reverse expansion deterministically and marks retained refs lower-bound', () => {
    const producer: Contract = {
      repositoryId: 'repo-a',
      repoName: 'repo-a',
      repoPath: '/a',
      kind: 'event',
      name: 'UserEvent',
      nodeId: 'sym:a:event',
      nodeKind: 'interface',
      filePath: 'src/event.ts',
      sourceCanonicalId: 'sym:a:event',
      contractId: 'contract-a',
      semanticFingerprint: 'fingerprint-a',
    };
    const consumers: Contract[] = ['repo-c', 'repo-b', 'repo-d'].map((repoId) => ({
      repositoryId: repoId,
      repoName: repoId,
      repoPath: `/${repoId}`,
      kind: 'event' as const,
      name: 'UserEvent',
      nodeId: `sym:${repoId}:event`,
      nodeKind: 'interface',
      filePath: 'src/event.ts',
      sourceCanonicalId: `sym:${repoId}:event`,
      contractId: `contract-${repoId}`,
      semanticFingerprint: `fingerprint-${repoId}`,
    }));
    const links: ContractLink[] = consumers.map((consumer) => ({
      providerRepo: 'repo-a',
      providerContract: 'UserEvent',
      consumerRepo: consumer.repositoryId!,
      consumerContract: 'UserEvent',
      matchKind: 'name-match',
      confidence: 1,
      providerContractId: 'contract-a',
      consumerContractId: consumer.contractId,
      providerSourceCanonicalId: 'sym:a:event',
      consumerSourceCanonicalId: consumer.sourceCanonicalId,
      certainty: 'exact',
      coverage: { complete: true, examinedCount: 1, incompleteReasons: [] },
    }));

    const index = buildContractConsumerIndex({
      contracts: [producer, ...consumers],
      links,
      memberFacts: [],
      maxConsumersPerContract: 2,
    });

    assert.deepEqual(index.byContractId['contract-a']?.map((ref) => ref.repositoryId), ['repo-b', 'repo-c']);
    assert.deepEqual(index.byContractId['contract-a']?.map((ref) => ref.certainty), ['lower-bound', 'lower-bound']);
    assert.deepEqual(index.byContractId['contract-a']?.map((ref) => ref.coverage), [
      { complete: false, examinedCount: 1, totalKnownCount: 3, incompleteReasons: ['consumer-cap-exceeded'] },
      { complete: false, examinedCount: 1, totalKnownCount: 3, incompleteReasons: ['consumer-cap-exceeded'] },
    ]);
  });
});
