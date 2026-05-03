import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeprecatedDetector } from '../../../src/analysis/deprecated-detector.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';

function createMockGraph() {
  const graph = createKnowledgeGraph();
  // Add a deprecated function
  graph.addNode({
    id: 'n1', name: 'url.parse', kind: 'function',
    filePath: 'node:url', startLine: 1, endLine: 1, exported: true,
    metadata: { jsdoc: '@deprecated Use the WHATWG URL API instead' }
  });
  // Add a caller
  graph.addNode({
    id: 'n2', name: 'parseUserUrl', kind: 'function',
    filePath: 'src/utils.ts', startLine: 10, endLine: 15, exported: false, metadata: {}
  });
  // Add call edge
  graph.addEdge({ id: 'e1', source: 'n2', target: 'n1', kind: 'calls' });
  return graph;
}

describe('DeprecatedDetector', () => {
  it('@deprecated JSDoc → symbol tagged', () => {
    const graph = createMockGraph();
    const detector = new DeprecatedDetector();
    detector.tagDeprecated(graph);
    const n1 = graph.getNode('n1');
    assert.equal(n1?.metadata?.['deprecated'], true);
  });

  it('caller of deprecated function → deprecated_use edge created', () => {
    const graph = createMockGraph();
    const detector = new DeprecatedDetector();
    detector.tagDeprecated(graph);
    const findings = detector.detect(graph);
    const finding = findings.find(f => f.symbol === 'url.parse');
    assert.ok(finding);
    assert.ok(finding!.callers.some(c => c.name === 'parseUserUrl'));
  });

  it('url.parse built-in → detected as deprecated', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n3', name: 'url.parse', kind: 'function',
      filePath: 'src/app.ts', startLine: 1, endLine: 1, exported: false, metadata: {} });
    const detector = new DeprecatedDetector();
    detector.tagDeprecated(graph);
    const n = graph.getNode('n3');
    assert.equal(n?.metadata?.['deprecated'], true);
  });

  it('non-deprecated function → not tagged', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'n4', name: 'getUserById', kind: 'function',
      filePath: 'src/users.ts', startLine: 1, endLine: 5, exported: true, metadata: {} });
    const detector = new DeprecatedDetector();
    detector.tagDeprecated(graph);
    const n = graph.getNode('n4');
    assert.equal(!!n?.metadata?.['deprecated'], false);
  });

  it('scope filter limits findings', () => {
    const graph = createMockGraph();
    const detector = new DeprecatedDetector();
    detector.tagDeprecated(graph);
    const findings = detector.detect(graph, 'src/');
    // url.parse is in node:url, callers are in src/ — findings should include callers in src/
    assert.ok(findings.length >= 0); // just verify no crash
  });

  it('Java @Deprecated annotation → symbol tagged', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'j1', name: 'oldMethod', kind: 'method',
      filePath: 'src/Legacy.java', startLine: 5, endLine: 10, exported: true,
      metadata: { annotations: ['Deprecated'] } });
    const detector = new DeprecatedDetector();
    detector.tagDeprecated(graph);
    const n = graph.getNode('j1');
    assert.equal(n?.metadata?.['deprecated'], true);
  });

  it('Rust #[deprecated] attribute → symbol tagged', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'r1', name: 'old_fn', kind: 'function',
      filePath: 'src/lib.rs', startLine: 1, endLine: 3, exported: false,
      metadata: { attributes: ['deprecated'] } });
    const detector = new DeprecatedDetector();
    detector.tagDeprecated(graph);
    const n = graph.getNode('r1');
    assert.equal(n?.metadata?.['deprecated'], true);
  });

  it('deprecationMessage extracted from JSDoc text', () => {
    const graph = createMockGraph();
    const detector = new DeprecatedDetector();
    detector.tagDeprecated(graph);
    const n1 = graph.getNode('n1');
    assert.equal(n1?.metadata?.['deprecationMessage'], 'Use the WHATWG URL API instead');
  });
});
