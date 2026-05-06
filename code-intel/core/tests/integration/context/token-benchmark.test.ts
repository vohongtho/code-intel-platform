/**
 * token-benchmark.test.ts — B.7.2
 *
 * CI gate: context builder output must stay within token targets
 * for 4 representative query scenarios against a fixture graph (100 nodes).
 *
 * Targets (from plan):
 *   Simple lookup     ≤ 1,000 tokens
 *   Blast radius      ≤ 2,000 tokens
 *   Code review       ≤ 3,000 tokens
 *   Architecture      ≤ 3,500 tokens
 *
 * CI fails if any scenario exceeds target by > 10%.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build, detectQueryIntent } from '../../../src/context/builder.js';
import { measureBlocks } from '../../../src/context/token-counter.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { CodeNode } from '../../../src/shared/index.js';

// ── Fixture graph builder ─────────────────────────────────────────────────────

function buildFixtureGraph() {
  const g = createKnowledgeGraph();

  // 20 auth-related symbols
  const authFiles = ['service', 'controller', 'middleware', 'guard', 'policy'];
  const authNodes: CodeNode[] = [];
  for (const f of authFiles) {
    const fnId = `auth-fn-${f}`;
    const classId = `auth-class-${f}`;
    const fn: CodeNode = {
      id: fnId, kind: 'function', name: `${f}Handler`, filePath: `src/auth/${f}.ts`,
      startLine: 10,
      content: Array.from({ length: 15 }, (_, i) => `  const step${i} = process(${i});`).join('\n'),
      metadata: { summary: `Handles ${f} logic for authentication.` },
    };
    const cls: CodeNode = {
      id: classId, kind: 'class', name: `${f.charAt(0).toUpperCase() + f.slice(1)}Service`, filePath: `src/auth/${f}.ts`,
      startLine: 1,
      content: Array.from({ length: 25 }, (_, i) => `  method${i}() { return ${i}; }`).join('\n'),
      metadata: { summary: `${f} service class.` },
    };
    g.addNode(fn);
    g.addNode(cls);
    authNodes.push(fn, cls);
  }

  // 30 service symbols
  const services = ['user', 'payment', 'order', 'product', 'notification', 'email'];
  const serviceNodes: CodeNode[] = [];
  for (const s of services) {
    for (const suffix of ['Service', 'Repository']) {
      const id = `${s}-${suffix}`;
      const node: CodeNode = {
        id, kind: suffix === 'Service' ? 'class' : 'interface',
        name: `${s.charAt(0).toUpperCase() + s.slice(1)}${suffix}`,
        filePath: `src/services/${s}.ts`,
        startLine: 5,
        content: Array.from({ length: 20 }, (_, i) => `  operation${i}() {}`).join('\n'),
        metadata: { summary: `${suffix} for ${s} domain.` },
      };
      g.addNode(node);
      serviceNodes.push(node);
    }
  }

  // 20 utility symbols
  for (let i = 0; i < 20; i++) {
    const node: CodeNode = {
      id: `util-${i}`, kind: 'function', name: `util${i}`,
      filePath: `src/utils/helper${Math.floor(i / 5)}.ts`,
      content: `function util${i}(x) { return x + ${i}; }`,
    };
    g.addNode(node);
  }

  // 30 API route symbols
  for (let i = 0; i < 30; i++) {
    const node: CodeNode = {
      id: `route-${i}`, kind: 'function', name: `handleRoute${i}`,
      filePath: `src/api/routes/route${i}.ts`,
      startLine: 1,
      content: Array.from({ length: 10 }, (_, j) => `  ctx.body = await service.doOp${j}();`).join('\n'),
      metadata: { summary: `HTTP handler for route ${i}.` },
    };
    g.addNode(node);
  }

  // Wire call edges: auth → services
  for (const authNode of authNodes.slice(0, 5)) {
    for (const svc of serviceNodes.slice(0, 3)) {
      g.addEdge({ id: `${authNode.id}-calls-${svc.id}`, source: authNode.id, target: svc.id, kind: 'calls' });
    }
  }

  // Wire callers → UserService (to test blast radius)
  const userSvc = serviceNodes.find((n) => n.name === 'UserService');
  if (userSvc) {
    for (const authNode of authNodes) {
      g.addEdge({ id: `${authNode.id}-calls-usersvc`, source: authNode.id, target: userSvc.id, kind: 'calls' });
    }
  }

  return { g, authNodes, serviceNodes };
}

const { g, authNodes, serviceNodes } = buildFixtureGraph();
const TOLERANCE = 1.10; // 10% over-budget allowed before CI fail

// ── Scenario 1: Simple lookup ─────────────────────────────────────────────────

describe('B.7.2 CI Benchmark — Simple lookup (≤ 1,000 tokens)', () => {
  it('build for a single symbol stays within 1,000 tokens', () => {
    const seed = [{ nodeId: authNodes[0].id, refinedScore: 0.9 }];
    const intent = detectQueryIntent('what does serviceHandler do?');
    const doc = build(seed, g, { queryIntent: intent, maxTokens: 1000 });
    const counts = measureBlocks(doc);
    const limit = Math.floor(1000 * TOLERANCE);
    assert.ok(
      counts.total <= limit,
      `Simple lookup: ${counts.total} tokens exceeds limit ${limit} (target 1,000 + 10%)`,
    );
  });
});

// ── Scenario 2: Blast radius / callers ───────────────────────────────────────

describe('B.7.2 CI Benchmark — Blast radius query (≤ 2,000 tokens)', () => {
  it('build for 5 seeds with callers intent stays within 2,000 tokens', () => {
    const seeds = authNodes.slice(0, 5).map((n) => ({ nodeId: n.id, refinedScore: 0.7 }));
    const intent = detectQueryIntent('who calls UserService and what is the blast radius?');
    const doc = build(seeds, g, { queryIntent: intent, maxTokens: 2000 });
    const counts = measureBlocks(doc);
    const limit = Math.floor(2000 * TOLERANCE);
    assert.ok(
      counts.total <= limit,
      `Blast radius: ${counts.total} tokens exceeds limit ${limit} (target 2,000 + 10%)`,
    );
  });
});

// ── Scenario 3: Code review ───────────────────────────────────────────────────

describe('B.7.2 CI Benchmark — Code review (≤ 3,000 tokens)', () => {
  it('build for 8 seeds with code intent stays within 3,000 tokens', () => {
    const seeds = [
      ...authNodes.slice(0, 4),
      ...serviceNodes.slice(0, 4),
    ].map((n) => ({ nodeId: n.id, refinedScore: 0.85 }));
    const intent = detectQueryIntent('show me the payment handler code');
    const doc = build(seeds, g, { queryIntent: intent, maxTokens: 3000 });
    const counts = measureBlocks(doc);
    const limit = Math.floor(3000 * TOLERANCE);
    assert.ok(
      counts.total <= limit,
      `Code review: ${counts.total} tokens exceeds limit ${limit} (target 3,000 + 10%)`,
    );
  });
});

// ── Scenario 4: Architecture overview ────────────────────────────────────────

describe('B.7.2 CI Benchmark — Architecture overview (≤ 3,500 tokens)', () => {
  it('build for 10 diverse seeds with architecture intent stays within 3,500 tokens', () => {
    const seeds: import('../../../src/context/builder.js').SeedSymbol[] = [
      ...authNodes.slice(0, 4).map((n) => ({ nodeId: n.id, refinedScore: 0.85 })),
      ...serviceNodes.slice(0, 4).map((n) => ({ nodeId: n.id, refinedScore: 0.85 })),
      { nodeId: 'route-0', refinedScore: 0.5 },
      { nodeId: 'util-0', refinedScore: 0.4 },
    ];
    const intent = detectQueryIntent('how is the auth system structured and what is the overall architecture?');
    const doc = build(seeds, g, { queryIntent: intent, maxTokens: 3500 });
    const counts = measureBlocks(doc);
    const limit = Math.floor(3500 * TOLERANCE);
    assert.ok(
      counts.total <= limit,
      `Architecture: ${counts.total} tokens exceeds limit ${limit} (target 3,500 + 10%)`,
    );
  });
});

// ── Key facts present in context (quality check) ─────────────────────────────

describe('B.7.2 Quality — key facts present in context', () => {
  it('seed symbol name always appears in context output', () => {
    const seed = [{ nodeId: authNodes[0].id, refinedScore: 1.0 }];
    const doc = build(seed, g);
    const full = [doc.summary, doc.logic, doc.relation, doc.focusCode].join('\n');
    assert.ok(full.includes(authNodes[0].name), `Symbol name ${authNodes[0].name} should appear in context`);
  });

  it('truncated=false when small graph fits comfortably in budget', () => {
    const g2 = createKnowledgeGraph();
    g2.addNode({ id: 'n1', kind: 'function', name: 'smallFn', filePath: 'src/small.ts', content: 'function smallFn() { return 1; }' });
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }], g2, { maxTokens: 6000 });
    assert.equal(doc.truncated, false);
  });
});
