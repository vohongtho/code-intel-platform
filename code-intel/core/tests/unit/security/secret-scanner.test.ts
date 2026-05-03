import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { SecretScanner } from '../../../src/security/secret-scanner.js';

describe('SecretScanner', () => {
  it('flags node with API_KEY = "sk-abc123..."', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/config.ts',
      metadata: { value: '[REDACTED:sk-secret]' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].symbol, 'API_KEY');
    assert.equal(findings[0].pattern, 'openai-api-key');
    assert.equal(findings[0].severity, 'HIGH');
  });

  it('does NOT flag node with API_KEY = process.env.API_KEY', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/config.ts',
      metadata: { value: 'process.env.API_KEY' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.equal(findings.length, 0, 'process.env references should not be flagged');
  });

  it('does NOT flag node with API_KEY = ""', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/config.ts',
      metadata: { value: '' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.equal(findings.length, 0, 'empty value should not be flagged');
  });

  it('does NOT flag test file node by default', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/config.test.ts',
      metadata: { value: '[REDACTED:sk-secret]' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.equal(findings.length, 0, 'test file nodes should not be flagged by default');
  });

  it('does NOT flag fixture directory node by default', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'tests/fixtures/config.ts',
      metadata: { value: '[REDACTED:sk-secret]' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.equal(findings.length, 0, 'fixture directory nodes should not be flagged by default');
  });

  it('flags test file when includeTestFiles: true', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/config.test.ts',
      metadata: { value: '[REDACTED:sk-secret]' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph, { includeTestFiles: true });
    assert.equal(findings.length, 1, 'test file nodes should be flagged when includeTestFiles is true');
  });

  it('flags Stripe key pattern', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n2',
      kind: 'variable',
      name: 'STRIPE_KEY',
      filePath: 'src/payment.ts',
      metadata: { value: 'pk_live_abcdefghijklmnopqrstuvwx' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, 'stripe-key');
  });

  it('flags AWS access key pattern', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n3',
      kind: 'variable',
      name: 'AWS_ACCESS_KEY',
      filePath: 'src/aws.ts',
      metadata: { value: '[REDACTED:aws-access-key-id]' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, 'aws-access-key');
  });

  it('flags DB URL with credentials', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n4',
      kind: 'variable',
      name: 'DATABASE_URL',
      filePath: 'src/db.ts',
      metadata: { value: 'postgres://admin:password123@localhost:5432/mydb' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, 'db-url-with-credentials');
  });

  it('flags sensitive variable name with non-empty literal value', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n5',
      kind: 'variable',
      name: 'DB_PASSWORD',
      filePath: 'src/db.ts',
      metadata: { value: 'mysecretpassword' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.ok(findings.length >= 1);
    const f = findings.find((x) => x.symbol === 'DB_PASSWORD');
    assert.ok(f, 'DB_PASSWORD should be flagged');
  });

  it('applies scope filter correctly', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/api/config.ts',
      metadata: { value: '[REDACTED:sk-secret]' },
    });
    graph.addNode({
      id: 'n2',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/auth/config.ts',
      metadata: { value: '[REDACTED:sk-secret]' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph, { scope: 'src/api/' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'src/api/config.ts');
  });

  it('tags node metadata when secret is found', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/config.ts',
      metadata: { value: '[REDACTED:sk-secret]' },
    });
    const scanner = new SecretScanner();
    scanner.scan(graph);
    const node = graph.getNode('n1');
    const security = (node?.metadata?.security as { secretRisk?: boolean } | undefined);
    assert.ok(security?.secretRisk === true, 'node metadata should have secretRisk: true');
  });

  it('does NOT flag when path matches ignorePatterns', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'n1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/generated/config.ts',
      metadata: { value: 'sk-abc123longvalue' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph, { ignorePatterns: ['generated/'] });
    assert.equal(findings.length, 0, 'files matching ignorePatterns should be excluded');
  });

  it('flags node with [REDACTED:api-key] literal by sensitive name pattern', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'redacted1',
      kind: 'variable',
      name: 'API_KEY',
      filePath: 'src/config.ts',
      metadata: { value: '[REDACTED:api-key]' },
    });
    const scanner = new SecretScanner();
    const findings = scanner.scan(graph);
    assert.ok(findings.length >= 1, '[REDACTED:api-key] with sensitive name should be flagged');
  });
});
