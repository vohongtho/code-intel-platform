import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { suggestTests } from '../../../src/query/suggest-tests.js';
import type { SuggestTestsResult } from '../../../src/query/suggest-tests.js';

function buildTestGraph(): KnowledgeGraph {
  const graph = createKnowledgeGraph();

  // The target symbol we want to test
  graph.addNode({ id: 'processPayment', kind: 'function', name: 'processPayment', filePath: 'src/payments/process.ts' });

  // Callers of processPayment (no tests for them)
  graph.addNode({ id: 'checkout', kind: 'function', name: 'checkout', filePath: 'src/orders/checkout.ts' });
  graph.addNode({ id: 'subscribe', kind: 'function', name: 'subscribe', filePath: 'src/subscriptions/subscribe.ts' });
  graph.addEdge({ id: 'e1', source: 'checkout', target: 'processPayment', kind: 'calls' });
  graph.addEdge({ id: 'e2', source: 'subscribe', target: 'processPayment', kind: 'calls' });

  // A test file that imports processPayment (existingTests)
  graph.addNode({ id: 'paymentTest', kind: 'file', name: 'process.test', filePath: 'src/payments/process.test.ts' });
  graph.addEdge({ id: 'e3', source: 'paymentTest', target: 'processPayment', kind: 'imports' });

  // validateInput: symbol with validate in name → specific suggestions
  graph.addNode({ id: 'validateInput', kind: 'function', name: 'validateInput', filePath: 'src/validate.ts' });

  // getUserById: symbol with get/find in name
  graph.addNode({ id: 'getUserById', kind: 'function', name: 'getUserById', filePath: 'src/users/get.ts' });

  // createOrder: symbol with create in name
  graph.addNode({ id: 'createOrder', kind: 'function', name: 'createOrder', filePath: 'src/orders/create.ts' });

  // deleteRecord: symbol with delete in name
  graph.addNode({ id: 'deleteRecord', kind: 'function', name: 'deleteRecord', filePath: 'src/data/delete.ts' });

  // Symbol with a tested caller (checkout has a test file that imports it)
  graph.addNode({ id: 'checkoutTest', kind: 'file', name: 'checkout.test', filePath: 'src/orders/checkout.test.ts' });
  graph.addEdge({ id: 'e4', source: 'checkoutTest', target: 'checkout', kind: 'imports' });

  return graph;
}

describe('suggestTests', () => {
  const graph = buildTestGraph();

  it('returns error for unknown symbol', () => {
    const result = suggestTests(graph, 'unknownSymbol');
    assert.ok('error' in result, 'should return error for unknown symbol');
    const r = result as { error: string };
    assert.ok(r.error.includes('unknownSymbol'), `error should mention symbol name, got: ${r.error}`);
  });

  it('generates suggested cases for "validate" pattern', () => {
    const result = suggestTests(graph, 'validateInput');
    assert.ok(!('error' in result), 'should not return error');
    const r = result as SuggestTestsResult;
    assert.ok(r.suggestedCases.length > 0, 'should have suggested cases');
    const casesText = r.suggestedCases.join(' ');
    assert.ok(
      casesText.includes('Valid input') || casesText.includes('Invalid input'),
      `should include validate-related cases, got: ${JSON.stringify(r.suggestedCases)}`,
    );
  });

  it('generates suggested cases for "get/find" pattern', () => {
    const result = suggestTests(graph, 'getUserById');
    assert.ok(!('error' in result));
    const r = result as SuggestTestsResult;
    const casesText = r.suggestedCases.join(' ');
    assert.ok(
      casesText.includes('Found') || casesText.includes('Not found'),
      `should include get-related cases, got: ${JSON.stringify(r.suggestedCases)}`,
    );
  });

  it('generates suggested cases for "create" pattern', () => {
    const result = suggestTests(graph, 'createOrder');
    assert.ok(!('error' in result));
    const r = result as SuggestTestsResult;
    const casesText = r.suggestedCases.join(' ');
    assert.ok(
      casesText.includes('created') || casesText.includes('Duplicate'),
      `should include create-related cases, got: ${JSON.stringify(r.suggestedCases)}`,
    );
  });

  it('generates suggested cases for "delete" pattern', () => {
    const result = suggestTests(graph, 'deleteRecord');
    assert.ok(!('error' in result));
    const r = result as SuggestTestsResult;
    const casesText = r.suggestedCases.join(' ');
    assert.ok(
      casesText.includes('deleted') || casesText.includes('Non-existent'),
      `should include delete-related cases, got: ${JSON.stringify(r.suggestedCases)}`,
    );
  });

  it('finds existing test files that import the symbol', () => {
    const result = suggestTests(graph, 'processPayment');
    assert.ok(!('error' in result));
    const r = result as SuggestTestsResult;
    assert.ok(r.existingTests.includes('src/payments/process.test.ts'),
      `existingTests should include process.test.ts, got: ${JSON.stringify(r.existingTests)}`);
  });

  it('untested callers: callers without test file importing them', () => {
    const result = suggestTests(graph, 'processPayment');
    assert.ok(!('error' in result));
    const r = result as SuggestTestsResult;

    // subscribe has no test file importing it → untested
    assert.ok(
      r.untestedCallers.includes('subscribe'),
      `subscribe should be an untested caller, got: ${JSON.stringify(r.untestedCallers)}`,
    );
  });

  it('tested caller is NOT in untested callers', () => {
    const result = suggestTests(graph, 'processPayment');
    assert.ok(!('error' in result));
    const r = result as SuggestTestsResult;

    // checkout has a test file importing it → not untested
    assert.ok(
      !r.untestedCallers.includes('checkout'),
      `checkout should NOT be in untestedCallers (has test coverage), got: ${JSON.stringify(r.untestedCallers)}`,
    );
  });

  it('symbol with no callers returns empty callPaths', () => {
    const result = suggestTests(graph, 'validateInput');
    assert.ok(!('error' in result));
    const r = result as SuggestTestsResult;
    // validateInput has no callers in the test graph
    assert.equal(r.callPaths.length, 0, 'should have no call paths for symbol with no callers');
    assert.equal(r.untestedCallers.length, 0, 'should have no untested callers');
    assert.equal(r.existingTests.length, 0, 'should have no existing tests');
  });

  it('call paths contain the target symbol as last element', () => {
    const result = suggestTests(graph, 'processPayment');
    assert.ok(!('error' in result));
    const r = result as SuggestTestsResult;
    for (const path of r.callPaths) {
      assert.ok(
        path[path.length - 1] === 'processPayment',
        `call path should end with processPayment, got: ${JSON.stringify(path)}`,
      );
    }
  });
});
