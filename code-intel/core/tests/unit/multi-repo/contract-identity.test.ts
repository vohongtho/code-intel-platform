import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStableContractId, contractIdentityFromContract } from '../../../src/multi-repo/contract-identity.js';
import type { Contract } from '../../../src/multi-repo/types.js';

describe('contract identity', () => {
  it('uses repository identity for same-name schemas in different repos', () => {
    const shared: Omit<Contract, 'repoName' | 'repoPath'> = {
      kind: 'schema',
      name: 'User',
      nodeId: 'sym:v2:User',
      nodeKind: 'interface',
      filePath: 'src/user.ts',
    };
    const a = getStableContractId(contractIdentityFromContract({ ...shared, repoName: 'repo-a', repoPath: '/a' }, 'repo-a-id'));
    const b = getStableContractId(contractIdentityFromContract({ ...shared, repoName: 'repo-b', repoPath: '/b' }, 'repo-b-id'));
    assert.notEqual(a, b);
  });

  it('uses repository identity for same-name events in different repos', () => {
    const shared: Omit<Contract, 'repoName' | 'repoPath'> = {
      kind: 'event',
      name: 'UserCreatedEvent',
      nodeId: 'sym:v2:UserCreatedEvent',
      nodeKind: 'interface',
      filePath: 'src/events.ts',
    };
    const a = getStableContractId(contractIdentityFromContract({ ...shared, repoName: 'repo-a', repoPath: '/a' }, 'repo-a-id'));
    const b = getStableContractId(contractIdentityFromContract({ ...shared, repoName: 'repo-b', repoPath: '/b' }, 'repo-b-id'));
    assert.notEqual(a, b);
  });

  it('uses method plus normalized path for routes instead of display name alone', () => {
    const base: Contract = {
      repoName: 'backend',
      repoPath: '/backend',
      kind: 'route',
      name: 'getUserRoute',
      nodeId: 'route-1',
      nodeKind: 'route',
      filePath: 'src/app.ts',
      method: 'GET',
      normalizedPath: '/users/{}',
    };
    const sameSemanticsDifferentName: Contract = { ...base, name: 'users.show' };
    const idA = getStableContractId(contractIdentityFromContract(base, 'backend-id'));
    const idB = getStableContractId(contractIdentityFromContract(sameSemanticsDifferentName, 'backend-id'));
    assert.equal(idA, idB);
  });

  it('does not collide same-name routes across services', () => {
    const route: Contract = {
      repoName: 'backend-a',
      repoPath: '/backend-a',
      kind: 'route',
      name: 'getUserRoute',
      nodeId: 'route-1',
      nodeKind: 'route',
      filePath: 'src/app.ts',
      method: 'GET',
      normalizedPath: '/users/{}',
    };
    const a = getStableContractId(contractIdentityFromContract(route, 'backend-a-id'));
    const b = getStableContractId(contractIdentityFromContract({ ...route, repoName: 'backend-b', repoPath: '/backend-b' }, 'backend-b-id'));
    assert.notEqual(a, b);
  });
});
