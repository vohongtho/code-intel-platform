import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCallSiteEdgeId, generateEdgeId, generateLegacyEdgeId, generateLegacyNodeId, generateNodeId, generateNodeIdV2 } from '../../../src/graph/id-generator.js';
import { Language } from '../../../src/shared/languages.js';

describe('ID Generator', () => {
  it('should generate deterministic node IDs', () => {
    const id1 = generateNodeId('function', 'src/auth.ts', 'login');
    const id2 = generateNodeId('function', 'src/auth.ts', 'login');
    assert.equal(id1, id2);
    assert.equal(id1, 'function:src/auth.ts:login');
  });

  it('should generate different IDs for different inputs', () => {
    const id1 = generateNodeId('function', 'a.ts', 'foo');
    const id2 = generateNodeId('function', 'b.ts', 'foo');
    assert.notEqual(id1, id2);
  });

  it('should generate edge IDs', () => {
    const id = generateEdgeId('n1', 'n2', 'calls');
    assert.equal(id, 'calls:n1->n2');
  });

  it('retains explicit legacy helpers', () => {
    assert.equal(generateLegacyNodeId('function', 'src/auth.ts', 'login'), 'function:src/auth.ts:login');
    assert.equal(generateLegacyEdgeId('n1', 'n2', 'calls'), 'calls:n1->n2');
  });

  it('generates v2 node and callsite edge ids', () => {
    const nodeId = generateNodeIdV2({
      version: 2,
      language: Language.TypeScript,
      kind: 'function',
      filePath: 'src/auth.ts',
      qualifiedName: 'src/auth.ts:login',
      signatureDiscriminator: '():void',
    });
    const edgeId = generateCallSiteEdgeId('src', nodeId, 'calls', {
      version: 1,
      filePath: 'src/auth.ts',
      calleeText: 'login',
      range: { filePath: 'src/auth.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 5 },
    });
    assert.ok(nodeId.startsWith('sym:v2:function:'));
    assert.ok(edgeId.startsWith('edge:v2:calls:callsite:v1:'));
  });
});
