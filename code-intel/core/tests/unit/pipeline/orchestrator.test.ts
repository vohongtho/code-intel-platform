import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../../../src/pipeline/orchestrator.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { Phase, PipelineContext, PhaseResult } from '../../../src/pipeline/types.js';

function makeContext(): PipelineContext {
  return {
    workspaceRoot: '/tmp/test',
    graph: createKnowledgeGraph(),
    filePaths: [],
  };
}

function makePhase(name: string, deps: string[], result: PhaseResult | 'throw' = { status: 'completed', duration: 0 }): Phase {
  return {
    name,
    dependencies: deps,
    async execute() {
      if (result === 'throw') throw new Error(`Phase ${name} threw`);
      return result;
    },
  };
}

describe('runPipeline', () => {
  it('runs a single phase successfully', async () => {
    const ctx = makeContext();
    const result = await runPipeline([makePhase('scan', [])], ctx);
    assert.equal(result.success, true);
    assert.ok(result.results.has('scan'));
    assert.equal(result.results.get('scan')!.status, 'completed');
  });

  it('runs phases in dependency order', async () => {
    const order: string[] = [];
    const ctx = makeContext();
    const phases: Phase[] = [
      {
        name: 'c',
        dependencies: ['b'],
        async execute() { order.push('c'); return { status: 'completed', duration: 0 }; },
      },
      {
        name: 'a',
        dependencies: [],
        async execute() { order.push('a'); return { status: 'completed', duration: 0 }; },
      },
      {
        name: 'b',
        dependencies: ['a'],
        async execute() { order.push('b'); return { status: 'completed', duration: 0 }; },
      },
    ];
    await runPipeline(phases, ctx);
    assert.equal(order.indexOf('a') < order.indexOf('b'), true);
    assert.equal(order.indexOf('b') < order.indexOf('c'), true);
  });

  it('stops and returns success=false when a phase returns failed', async () => {
    const ctx = makeContext();
    const executed: string[] = [];
    const phases: Phase[] = [
      {
        name: 'parse',
        dependencies: [],
        async execute() { executed.push('parse'); return { status: 'failed', duration: 0, message: 'parse failed' }; },
      },
      {
        name: 'resolve',
        dependencies: ['parse'],
        async execute() { executed.push('resolve'); return { status: 'completed', duration: 0 }; },
      },
    ];
    const result = await runPipeline(phases, ctx);
    assert.equal(result.success, false);
    assert.ok(!executed.includes('resolve'));
  });

  it('stops and returns success=false when a phase throws', async () => {
    const ctx = makeContext();
    const executed: string[] = [];
    const phases: Phase[] = [
      {
        name: 'scan',
        dependencies: [],
        async execute() { throw new Error('disk error'); },
      },
      {
        name: 'parse',
        dependencies: ['scan'],
        async execute() { executed.push('parse'); return { status: 'completed', duration: 0 }; },
      },
    ];
    const result = await runPipeline(phases, ctx);
    assert.equal(result.success, false);
    const scanResult = result.results.get('scan');
    assert.ok(scanResult !== undefined);
    assert.equal(scanResult!.status, 'failed');
    assert.ok(scanResult!.message?.includes('disk error'));
    assert.ok(!executed.includes('parse'));
  });

  it('throws when pipeline DAG is invalid (duplicate)', async () => {
    const ctx = makeContext();
    const phases = [makePhase('a', []), makePhase('a', [])];
    await assert.rejects(() => runPipeline(phases, ctx), /Pipeline validation failed/);
  });

  it('throws when pipeline DAG has missing dependency', async () => {
    const ctx = makeContext();
    const phases = [makePhase('b', ['a'])];
    await assert.rejects(() => runPipeline(phases, ctx), /Pipeline validation failed/);
  });

  it('passes dep results to dependent phase', async () => {
    const ctx = makeContext();
    let receivedDeps: Map<string, PhaseResult> | null = null;
    const phases: Phase[] = [
      makePhase('scan', [], { status: 'completed', duration: 5 }),
      {
        name: 'parse',
        dependencies: ['scan'],
        async execute(_ctx, depResults) {
          receivedDeps = depResults;
          return { status: 'completed', duration: 0 };
        },
      },
    ];
    await runPipeline(phases, ctx);
    assert.ok(receivedDeps !== null);
    assert.ok((receivedDeps as Map<string, PhaseResult>).has('scan'));
  });

  it('calls onProgress callback', async () => {
    const progress: string[] = [];
    const ctx: PipelineContext = {
      ...makeContext(),
      onProgress: (phase, status) => progress.push(`${phase}:${status}`),
    };
    await runPipeline([makePhase('scan', [])], ctx);
    assert.ok(progress.some((p) => p.startsWith('scan:')));
  });

  it('returns totalDuration >= 0', async () => {
    const ctx = makeContext();
    const result = await runPipeline([makePhase('scan', [])], ctx);
    assert.ok(result.totalDuration >= 0);
  });
});
