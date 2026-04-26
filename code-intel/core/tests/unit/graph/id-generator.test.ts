import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateNodeId, generateEdgeId } from '../../../src/graph/id-generator.js';

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
});
