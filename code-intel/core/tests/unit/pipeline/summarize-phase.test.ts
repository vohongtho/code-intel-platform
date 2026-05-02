import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { createSummarizePhase } from '../../../src/pipeline/phases/summarize-phase.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';
import type { LLMProvider } from '../../../src/llm/provider.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    workspaceRoot: '/workspace',
    graph: createKnowledgeGraph(),
    filePaths: [],
    ...overrides,
  } as PipelineContext;
}

/** A fake LLM provider that echoes back a canned summary. */
function makeFakeProvider(
  response: string | (() => Promise<string>),
  modelName = 'fake-model',
): LLMProvider {
  return {
    modelName,
    summarize: async (_prompt: string) => {
      if (typeof response === 'function') return response();
      return response;
    },
  };
}

/** Run the summarize phase with a fake provider injected via the override arg. */
async function runPhaseWithProvider(ctx: PipelineContext, provider: LLMProvider) {
  const phase = createSummarizePhase(provider);
  return phase.execute(ctx, new Map());
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('summarizePhase', () => {

  it('returns skipped when context.summarize is falsy', async () => {
    const ctx = makeContext();
    const phase = createSummarizePhase();
    const result = await phase.execute(ctx, new Map());
    assert.equal(result.status, 'skipped');
    assert.ok(result.message?.includes('skipped'));
  });

  it('returns skipped when context.summarize is false', async () => {
    const ctx = makeContext({ summarize: false } as Partial<PipelineContext>);
    const phase = createSummarizePhase();
    const result = await phase.execute(ctx, new Map());
    assert.equal(result.status, 'skipped');
  });

  it('summarizes only function/class/method/interface nodes', async () => {
    const ctx = makeContext({ summarize: true } as Partial<PipelineContext>);
    ctx.graph.addNode({ id: 'fn1', kind: 'function',  name: 'doStuff', filePath: '/src/a.ts', content: 'function doStuff() {}' });
    ctx.graph.addNode({ id: 'cl1', kind: 'class',     name: 'MyClass', filePath: '/src/a.ts', content: 'class MyClass {}' });
    ctx.graph.addNode({ id: 'mt1', kind: 'method',    name: 'run',     filePath: '/src/a.ts', content: 'run() {}' });
    ctx.graph.addNode({ id: 'if1', kind: 'interface', name: 'IFoo',    filePath: '/src/a.ts', content: 'interface IFoo {}' });
    ctx.graph.addNode({ id: 'va1', kind: 'variable',  name: 'x',       filePath: '/src/a.ts', content: 'const x = 1' });
    ctx.graph.addNode({ id: 'fi1', kind: 'file',      name: 'a.ts',    filePath: '/src/a.ts' });

    await runPhaseWithProvider(ctx, makeFakeProvider('A short summary.'));

    let summarizedCount = 0;
    for (const node of ctx.graph.allNodes()) {
      if (node.metadata?.summary) summarizedCount++;
    }
    assert.equal(summarizedCount, 4);

    const varNode = ctx.graph.getNode('va1');
    assert.equal(varNode?.metadata?.summary, undefined);
    const fileNode = ctx.graph.getNode('fi1');
    assert.equal(fileNode?.metadata?.summary, undefined);
  });

  it('skips nodes whose codeHash is unchanged (cache hit)', async () => {
    const crypto = await import('node:crypto');
    const content = 'function cached() {}';
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

    const ctx = makeContext({ summarize: true } as Partial<PipelineContext>);
    ctx.graph.addNode({
      id:       'fn1',
      kind:     'function',
      name:     'cached',
      filePath: '/src/a.ts',
      content,
      metadata: { summary: 'Existing summary', codeHash: hash },
    });

    let callCount = 0;
    const provider = makeFakeProvider(async () => { callCount++; return 'New summary'; });
    await runPhaseWithProvider(ctx, provider);

    assert.equal(callCount, 0, 'LLM should NOT be called for cached nodes');
    const node = ctx.graph.getNode('fn1');
    assert.equal(node?.metadata?.summary, 'Existing summary');
  });

  it('re-summarizes nodes whose code has changed', async () => {
    const ctx = makeContext({ summarize: true } as Partial<PipelineContext>);
    ctx.graph.addNode({
      id:       'fn1',
      kind:     'function',
      name:     'changed',
      filePath: '/src/a.ts',
      content:  'function changed() { return 1; }',
      metadata: { summary: 'Old summary', codeHash: 'stale-hash' },
    });

    let callCount = 0;
    const provider = makeFakeProvider(async () => { callCount++; return 'Fresh summary'; });
    await runPhaseWithProvider(ctx, provider);

    assert.equal(callCount, 1);
    const node = ctx.graph.getNode('fn1');
    assert.equal(node?.metadata?.summary, 'Fresh summary');
  });

  it('stores summaryModel, summaryAt, codeHash on node metadata', async () => {
    const ctx = makeContext({ summarize: true } as Partial<PipelineContext>);
    ctx.graph.addNode({ id: 'fn1', kind: 'function', name: 'foo', filePath: '/src/a.ts', content: 'function foo() {}' });

    await runPhaseWithProvider(ctx, makeFakeProvider('Test summary', 'my-model'));

    const node = ctx.graph.getNode('fn1');
    assert.equal(node?.metadata?.summary, 'Test summary');
    assert.equal(node?.metadata?.summaryModel, 'my-model');
    assert.ok(typeof node?.metadata?.summaryAt === 'number');
    assert.ok(typeof node?.metadata?.codeHash === 'string');
    assert.equal((node?.metadata?.codeHash as string).length, 16);
  });

  it('respects maxNodesPerRun cost guard', async () => {
    const ctx = makeContext({
      summarize: true,
      llmConfig: { maxNodesPerRun: 2 },
    } as Partial<PipelineContext>);
    for (let i = 0; i < 5; i++) {
      ctx.graph.addNode({
        id:       `fn${i}`,
        kind:     'function',
        name:     `fn${i}`,
        filePath: '/src/a.ts',
        content:  `function fn${i}() {}`,
      });
    }

    let callCount = 0;
    const provider = makeFakeProvider(async () => { callCount++; return 'Summary'; });
    await runPhaseWithProvider(ctx, provider);

    assert.ok(callCount <= 2, `Expected ≤ 2 LLM calls, got ${callCount}`);
  });

  it('returns completed status with correct message', async () => {
    const ctx = makeContext({ summarize: true } as Partial<PipelineContext>);
    ctx.graph.addNode({ id: 'fn1', kind: 'function', name: 'foo', filePath: '/src/a.ts', content: 'function foo() {}' });
    ctx.graph.addNode({ id: 'fn2', kind: 'function', name: 'bar', filePath: '/src/a.ts', content: 'function bar() {}' });

    const result = await runPhaseWithProvider(ctx, makeFakeProvider('Summary'));

    assert.equal(result.status, 'completed');
    assert.ok(result.message?.includes('2 summaries generated'));
    assert.ok(result.duration >= 0);
  });

  it('has correct name and dependency on flow', () => {
    const phase = createSummarizePhase();
    assert.equal(phase.name, 'summarize');
    assert.deepEqual(phase.dependencies, ['flow']);
  });

  it('calls onPhaseProgress callback', async () => {
    const progressCalls: string[] = [];
    const ctx = makeContext({
      summarize: true,
      onPhaseProgress: (phase: string, done: number, total: number) =>
        progressCalls.push(`${phase}:${done}/${total}`),
    } as Partial<PipelineContext>);
    ctx.graph.addNode({ id: 'fn1', kind: 'function', name: 'foo', filePath: '/src/a.ts', content: 'function foo() {}' });

    await runPhaseWithProvider(ctx, makeFakeProvider('Summary'));
    assert.ok(progressCalls.some((c) => c.startsWith('summarize:')));
  });
});
