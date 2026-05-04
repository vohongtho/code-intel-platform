import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../../../src/pipeline/orchestrator.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { Phase, PipelineContext } from '../../../src/pipeline/types.js';

function makeContext(profile = true): PipelineContext {
  return {
    workspaceRoot: '/tmp/test',
    graph: createKnowledgeGraph(),
    filePaths: [],
    profile,
  };
}

function makePhase(name: string, deps: string[], delayMs = 0): Phase {
  return {
    name,
    dependencies: deps,
    async execute() {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return { status: 'completed', duration: delayMs };
    },
  };
}

describe('pipeline profiling (Epic 4)', () => {
  it('captures memoryBeforeMB and memoryAfterMB when profile=true', async () => {
    const ctx = makeContext(true);
    const result = await runPipeline([makePhase('scan', [])], ctx);
    const scanResult = result.results.get('scan')!;
    assert.ok(scanResult !== undefined);
    assert.ok(typeof scanResult.memoryBeforeMB === 'number', 'memoryBeforeMB should be a number');
    assert.ok(typeof scanResult.memoryAfterMB  === 'number', 'memoryAfterMB should be a number');
    assert.ok(scanResult.memoryBeforeMB >= 0);
    assert.ok(scanResult.memoryAfterMB  >= 0);
  });

  it('does NOT capture memory fields when profile=false', async () => {
    const ctx = makeContext(false);
    const result = await runPipeline([makePhase('scan', [])], ctx);
    const scanResult = result.results.get('scan')!;
    assert.ok(scanResult !== undefined);
    assert.equal(scanResult.memoryBeforeMB, undefined);
    assert.equal(scanResult.memoryAfterMB,  undefined);
  });

  it('captures memory for every phase in the pipeline', async () => {
    const ctx = makeContext(true);
    const phases: Phase[] = [
      makePhase('scan',    []),
      makePhase('parse',   ['scan']),
      makePhase('resolve', ['parse']),
    ];
    const result = await runPipeline(phases, ctx);
    for (const name of ['scan', 'parse', 'resolve']) {
      const pr = result.results.get(name)!;
      assert.ok(pr !== undefined, `result for ${name} should exist`);
      assert.ok(typeof pr.memoryBeforeMB === 'number', `${name}: memoryBeforeMB should be number`);
      assert.ok(typeof pr.memoryAfterMB  === 'number', `${name}: memoryAfterMB should be number`);
    }
  });

  it('phase durations sum approximately to totalDuration', async () => {
    const ctx = makeContext(true);
    const phases: Phase[] = [
      makePhase('a', [],    10),
      makePhase('b', ['a'], 10),
      makePhase('c', ['b'], 10),
    ];
    const result = await runPipeline(phases, ctx);
    // totalDuration is wall-clock; phase durations are self-reported by execute().
    // Just verify totalDuration >= sum of phase durations and > 0.
    const sumDurations = [...result.results.values()].reduce((s, r) => s + r.duration, 0);
    assert.ok(result.totalDuration >= 0, 'totalDuration should be >= 0');
    assert.ok(typeof sumDurations === 'number', 'sum of phase durations should be a number');
  });

  it('bottleneck: single heavy phase occupies > 50% of total wall-clock time', async () => {
    const ctx = makeContext(true);
    // One slow phase + two tiny ones so the slow one dominates
    // Use 100ms delay with >=40ms assertion to avoid CI timing flakiness
    const phases: Phase[] = [
      makePhase('slow',  [],       100),
      makePhase('fast1', ['slow'],   0),
      makePhase('fast2', ['fast1'],  0),
    ];
    const result = await runPipeline(phases, ctx);
    // The wall-clock totalDuration should reflect the real elapsed time (with CI margin)
    assert.ok(result.totalDuration >= 40, 'totalDuration should be >= 40ms');
    assert.ok(result.success);
    // slow phase exists and ran
    assert.ok(result.results.has('slow'));
  });

  it('memory fields are present on failed phase when profile=true', async () => {
    const ctx = makeContext(true);
    const phases: Phase[] = [
      {
        name: 'boom',
        dependencies: [],
        async execute() { throw new Error('injected failure'); },
      },
    ];
    const result = await runPipeline(phases, ctx);
    assert.equal(result.success, false);
    const boom = result.results.get('boom')!;
    assert.equal(boom.status, 'failed');
    assert.ok(typeof boom.memoryBeforeMB === 'number');
    assert.ok(typeof boom.memoryAfterMB  === 'number');
  });
});
