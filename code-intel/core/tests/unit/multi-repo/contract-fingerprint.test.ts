import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSemanticContractFingerprint, contractFingerprintFromContract, semanticFingerprintPayloadFromNode } from '../../../src/multi-repo/contract-fingerprint.js';
import type { Contract } from '../../../src/multi-repo/types.js';
import type { CodeNode } from '../../../src/shared/index.js';

describe('contract fingerprint', () => {
  it('ignores parameter row order', () => {
    const a: Contract = {
      repoName: 'repo',
      repoPath: '/tmp/a',
      kind: 'export',
      name: 'fn',
      nodeId: 'a',
      nodeKind: 'function',
      filePath: '/abs/path/src/a.ts',
      parameters: [{ name: 'b', type: 'string' }, { name: 'a', type: 'number' }],
      returnType: 'void',
    };
    const b: Contract = { ...a, repoPath: '/tmp/other', filePath: '/different/machine/src/a.ts', parameters: [...a.parameters!].reverse() };
    assert.equal(
      computeSemanticContractFingerprint(contractFingerprintFromContract(a)),
      computeSemanticContractFingerprint(contractFingerprintFromContract(b)),
    );
  });

  it('includes schema version in fingerprint input', () => {
    const contract: Contract = {
      repoName: 'backend',
      repoPath: '/backend',
      kind: 'route',
      name: 'GET /users/{id}',
      nodeId: 'route-1',
      nodeKind: 'route',
      filePath: 'src/app.ts',
      method: 'GET',
      normalizedPath: '/users/{}',
    };
    const fingerprint = computeSemanticContractFingerprint(contractFingerprintFromContract(contract));
    assert.match(fingerprint, /^group-contract-fingerprint:/);
  });

  it('captures schema field content so a removed field changes the fingerprint even when the signature line is unchanged', () => {
    const contract: Contract = {
      repoName: 'shared', repoPath: '/shared', kind: 'schema', name: 'UserDto', nodeId: 'schema-node', nodeKind: 'interface', filePath: 'src/user.ts', sourceCanonicalId: 'schema:user',
    };
    const baseNode: CodeNode = { id: 'schema-node', kind: 'interface', name: 'UserDto', filePath: 'src/user.ts', content: 'export interface UserDto {\n  id: string;\n  email?: string;\n}' };
    const headNode: CodeNode = { ...baseNode, content: 'export interface UserDto {\n  id: string;\n}' };

    const baseFingerprint = computeSemanticContractFingerprint({ ...contractFingerprintFromContract(contract), semantic: semanticFingerprintPayloadFromNode(baseNode, contract.kind) });
    const headFingerprint = computeSemanticContractFingerprint({ ...contractFingerprintFromContract(contract), semantic: semanticFingerprintPayloadFromNode(headNode, contract.kind) });
    assert.notEqual(baseFingerprint, headFingerprint);
  });

  it('captures route response shape refs so a response field removal changes the fingerprint even when method/path are unchanged', () => {
    const contract: Contract = {
      repoName: 'backend', repoPath: '/backend', kind: 'route', name: 'GET /users', nodeId: 'route-node', nodeKind: 'route', filePath: 'src/routes.ts', method: 'GET', normalizedPath: '/users',
    };
    const baseNode: CodeNode = {
      id: 'route-node', kind: 'route', name: 'GET /users', filePath: 'src/routes.ts',
      metadata: { apiContract: { factId: 'route-fact', language: 'typescript', method: 'GET', path: '/users', normalizedPath: '/users', framework: 'express', coverage: { complete: true, boundaryReasons: [] }, responses: [{ status: 200, responseShapeRef: 'shape-a', evidence: 'exact' }] } },
    };
    const headNode: CodeNode = {
      ...baseNode,
      metadata: { apiContract: { ...(baseNode.metadata!['apiContract'] as Record<string, unknown>), responses: [{ status: 200, responseShapeRef: 'shape-b', evidence: 'exact' }] } },
    };

    const baseFingerprint = computeSemanticContractFingerprint({ ...contractFingerprintFromContract(contract), semantic: semanticFingerprintPayloadFromNode(baseNode, contract.kind) });
    const headFingerprint = computeSemanticContractFingerprint({ ...contractFingerprintFromContract(contract), semantic: semanticFingerprintPayloadFromNode(headNode, contract.kind) });
    assert.notEqual(baseFingerprint, headFingerprint);
  });
});
