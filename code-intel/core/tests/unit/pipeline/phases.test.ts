import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { clusterPhase } from '../../../src/pipeline/phases/cluster-phase.js';
import { flowPhase } from '../../../src/pipeline/phases/flow-phase.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';

function makeContext(filePaths: string[] = []): PipelineContext {
  return {
    workspaceRoot: '/workspace',
    graph: createKnowledgeGraph(),
    filePaths,
  };
}

// ── clusterPhase ──────────────────────────────────────────────────────────────

describe('clusterPhase', () => {
  it('returns completed status', async () => {
    const ctx = makeContext();
    const result = await clusterPhase.execute(ctx, new Map());
    assert.equal(result.status, 'completed');
    assert.ok(result.duration >= 0);
  });

  it('creates no clusters for empty graph', async () => {
    const ctx = makeContext();
    const result = await clusterPhase.execute(ctx, new Map());
    assert.ok(result.message?.includes('0'));
  });

  it('creates no clusters when all dirs have < 2 members', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'fn1', kind: 'function', name: 'fn1', filePath: '/src/a/foo.ts' });
    const result = await clusterPhase.execute(ctx, new Map());
    assert.ok(result.message?.includes('0'));
  });

  it('creates cluster for dir with >= 2 relevant members', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'fn1', kind: 'function', name: 'fn1', filePath: '/src/utils/a.ts' });
    ctx.graph.addNode({ id: 'fn2', kind: 'function', name: 'fn2', filePath: '/src/utils/b.ts' });
    const result = await clusterPhase.execute(ctx, new Map());
    assert.ok(result.message?.includes('1'));
    // Cluster node added to graph
    let hasCluster = false;
    for (const node of ctx.graph.allNodes()) {
      if (node.kind === 'cluster') hasCluster = true;
    }
    assert.ok(hasCluster);
  });

  it('skips non-relevant node kinds (file, variable)', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'f1', kind: 'file', name: 'f1.ts', filePath: '/src/utils/a.ts' });
    ctx.graph.addNode({ id: 'v1', kind: 'variable', name: 'v1', filePath: '/src/utils/b.ts' });
    const result = await clusterPhase.execute(ctx, new Map());
    assert.ok(result.message?.includes('0'));
  });

  it('creates belongs_to edges for cluster members', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'fn1', kind: 'function', name: 'fn1', filePath: '/src/mod/a.ts' });
    ctx.graph.addNode({ id: 'cls1', kind: 'class', name: 'Cls1', filePath: '/src/mod/b.ts' });
    await clusterPhase.execute(ctx, new Map());
    let belongsToCount = 0;
    for (const edge of ctx.graph.findEdgesByKind('belongs_to')) {
      belongsToCount++;
    }
    assert.ok(belongsToCount >= 2);
  });

  it('calls onPhaseProgress callback', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'fn1', kind: 'function', name: 'fn1', filePath: '/src/mod/a.ts' });
    ctx.graph.addNode({ id: 'fn2', kind: 'function', name: 'fn2', filePath: '/src/mod/b.ts' });
    const calls: string[] = [];
    ctx.onPhaseProgress = (phase, done, total) => calls.push(`${phase}:${done}/${total}`);
    await clusterPhase.execute(ctx, new Map());
    assert.ok(calls.some((c) => c.startsWith('cluster:')));
  });

  it('creates multiple clusters for different dirs', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'a1', kind: 'function', name: 'a1', filePath: '/src/mod1/a.ts' });
    ctx.graph.addNode({ id: 'a2', kind: 'function', name: 'a2', filePath: '/src/mod1/b.ts' });
    ctx.graph.addNode({ id: 'b1', kind: 'class', name: 'b1', filePath: '/src/mod2/a.ts' });
    ctx.graph.addNode({ id: 'b2', kind: 'class', name: 'b2', filePath: '/src/mod2/b.ts' });
    const result = await clusterPhase.execute(ctx, new Map());
    assert.ok(result.message?.includes('2'));
  });
});

// ── flowPhase ─────────────────────────────────────────────────────────────────

describe('flowPhase', () => {
  it('returns completed status', async () => {
    const ctx = makeContext();
    const result = await flowPhase.execute(ctx, new Map());
    assert.equal(result.status, 'completed');
    assert.ok(result.duration >= 0);
  });

  it('returns 0 flows for empty graph', async () => {
    const ctx = makeContext();
    const result = await flowPhase.execute(ctx, new Map());
    assert.ok(result.message?.includes('0'));
  });

  it('returns 0 flows when no functions exist', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'f1', kind: 'file', name: 'a.ts', filePath: '/src/a.ts' });
    const result = await flowPhase.execute(ctx, new Map());
    assert.ok(result.message?.includes('0 entry'));
  });

  it('traces flow for exported function calling another', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'ep', kind: 'function', name: 'main', filePath: '/src/index.ts', exported: true });
    ctx.graph.addNode({ id: 'fn2', kind: 'function', name: 'helper', filePath: '/src/index.ts' });
    ctx.graph.addNode({ id: 'fn3', kind: 'function', name: 'detail', filePath: '/src/index.ts' });
    ctx.graph.addEdge({ id: 'e1', source: 'ep', target: 'fn2', kind: 'calls', weight: 1 });
    ctx.graph.addEdge({ id: 'e2', source: 'fn2', target: 'fn3', kind: 'calls', weight: 1 });
    const result = await flowPhase.execute(ctx, new Map());
    assert.equal(result.status, 'completed');
    // Should have created flow nodes
    let flowCount = 0;
    for (const node of ctx.graph.allNodes()) {
      if (node.kind === 'flow') flowCount++;
    }
    assert.ok(flowCount > 0);
  });

  it('filters out test file entry points', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'ep', kind: 'function', name: 'runTests', filePath: '/src/foo.test.ts', exported: true });
    ctx.graph.addNode({ id: 'fn2', kind: 'function', name: 'helper', filePath: '/src/foo.test.ts' });
    ctx.graph.addEdge({ id: 'e1', source: 'ep', target: 'fn2', kind: 'calls', weight: 1 });
    const result = await flowPhase.execute(ctx, new Map());
    // runTests has score -20+... so no entry points
    let flowCount = 0;
    for (const node of ctx.graph.allNodes()) {
      if (node.kind === 'flow') flowCount++;
    }
    assert.equal(flowCount, 0);
  });

  it('adds step_of edges for flow nodes', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'ep', kind: 'function', name: 'serve', filePath: '/src/routes/server.ts', exported: true });
    ctx.graph.addNode({ id: 'a', kind: 'function', name: 'handleReq', filePath: '/src/routes/server.ts' });
    ctx.graph.addNode({ id: 'b', kind: 'function', name: 'processReq', filePath: '/src/routes/server.ts' });
    ctx.graph.addEdge({ id: 'e1', source: 'ep', target: 'a', kind: 'calls', weight: 1 });
    ctx.graph.addEdge({ id: 'e2', source: 'a', target: 'b', kind: 'calls', weight: 1 });
    await flowPhase.execute(ctx, new Map());
    let stepOfCount = 0;
    for (const edge of ctx.graph.findEdgesByKind('step_of')) {
      stepOfCount++;
    }
    assert.ok(stepOfCount >= 3);
  });

  it('calls onPhaseProgress callback', async () => {
    const ctx = makeContext();
    ctx.graph.addNode({ id: 'ep', kind: 'function', name: 'main', filePath: '/src/routes/app.ts', exported: true });
    ctx.graph.addNode({ id: 'a', kind: 'function', name: 'a', filePath: '/src/routes/app.ts' });
    ctx.graph.addNode({ id: 'b', kind: 'function', name: 'b', filePath: '/src/routes/app.ts' });
    ctx.graph.addEdge({ id: 'e1', source: 'ep', target: 'a', kind: 'calls', weight: 1 });
    ctx.graph.addEdge({ id: 'e2', source: 'a', target: 'b', kind: 'calls', weight: 1 });
    const calls: string[] = [];
    ctx.onPhaseProgress = (phase, done, total) => calls.push(`${phase}:${done}/${total}`);
    await flowPhase.execute(ctx, new Map());
    assert.ok(calls.some((c) => c.startsWith('flow:')));
  });

  it('scores route/controller files higher', async () => {
    const ctx = makeContext();
    // route file function — should get boosted score
    ctx.graph.addNode({ id: 'r1', kind: 'function', name: 'getUser', filePath: '/src/routes/user.ts', exported: true });
    ctx.graph.addNode({ id: 'helper', kind: 'function', name: 'helper', filePath: '/src/utils/common.ts' });
    ctx.graph.addNode({ id: 'detail', kind: 'function', name: 'detail', filePath: '/src/utils/detail.ts' });
    ctx.graph.addEdge({ id: 'e1', source: 'r1', target: 'helper', kind: 'calls', weight: 1 });
    ctx.graph.addEdge({ id: 'e2', source: 'helper', target: 'detail', kind: 'calls', weight: 1 });
    const result = await flowPhase.execute(ctx, new Map());
    assert.equal(result.status, 'completed');
    let flowCount = 0;
    for (const node of ctx.graph.allNodes()) {
      if (node.kind === 'flow') flowCount++;
    }
    assert.ok(flowCount > 0);
  });
});
