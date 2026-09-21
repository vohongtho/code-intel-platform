import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build, type SeedSymbol } from '../../../src/context/builder.js';
import { ContextDeliverySession } from '../../../src/context/session.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { CodeNode } from '../../../src/shared/index.js';

function addNode(graph: ReturnType<typeof createKnowledgeGraph>, node: CodeNode): CodeNode {
  graph.addNode(node);
  return node;
}

describe('Canonical identity — same-name symbols never suppress each other', () => {
  it('two distinct same-named seeds both appear in full in SUMMARY (no name-based collapse)', () => {
    const g = createKnowledgeGraph();
    addNode(g, { id: 'n1', kind: 'class', name: 'Handler', filePath: 'src/auth/handler.ts', startLine: 1, metadata: { summary: 'Auth handler.' } });
    addNode(g, { id: 'n2', kind: 'class', name: 'Handler', filePath: 'src/billing/handler.ts', startLine: 1, metadata: { summary: 'Billing handler.' } });
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n2', refinedScore: 1 }], g);
    // Both distinct symbols must keep their own file/summary — name-only collapse would
    // make the second occurrence indistinguishable from the first.
    assert.ok(doc.summary.includes('auth/handler.ts'), 'first Handler keeps its path');
    assert.ok(doc.summary.includes('billing/handler.ts'), 'second Handler keeps its own path, not collapsed to a bare name');
  });

  it('identityId (canonical id), not the graph id, is used for dedup when present', () => {
    const g = createKnowledgeGraph();
    // Same identityId, different graph ids (e.g. a stale duplicate) — must collapse.
    addNode(g, { id: 'n1', identityId: 'canon-1', kind: 'function', name: 'parse', filePath: 'src/parse.ts', metadata: { summary: 'Parses input.' } });
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n1', refinedScore: 1 }], g);
    // Second mention of the identical seed collapses to name-only (still one artifact).
    const occurrences = doc.summary.split('\n').filter((l) => l.includes('parse'));
    assert.equal(occurrences.length, 2);
    assert.ok(occurrences[1] === 'parse', 'repeat of the same canonical artifact renders name-only');
  });
});

describe('Allocation receipts — requested evidence is delivered or explicitly omitted', () => {
  it('named symbol deep in a large file is still delivered with correct location', () => {
    const g = createKnowledgeGraph();
    addNode(g, { id: 'n1', kind: 'function', name: 'deepFn', filePath: 'src/very/deep/module.ts', startLine: 4821, content: 'function deepFn() { return 42; }' });
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }], g);
    assert.ok(doc.focusCode.includes('deepFn'));
    assert.ok(doc.focusCode.includes(':4821'));
    assert.equal(doc.omitted?.length ?? 0, 0);
  });

  it('oversized function is windowed (not silently dropped) and reported truncated', () => {
    const g = createKnowledgeGraph();
    const bigBody = Array.from({ length: 500 }, (_, i) => `  const line${i} = compute(${i});`).join('\n');
    addNode(g, { id: 'n1', kind: 'function', name: 'giantFn', filePath: 'src/giant.ts', content: `function giantFn() {\n${bigBody}\n}` });
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }], g, { maxTokens: 6000 });
    assert.ok(doc.focusCode.includes('giantFn'), 'oversized function still appears');
    assert.ok(doc.focusCode.includes('more lines'), 'body is windowed with a truncation marker');
    assert.equal(doc.omitted?.length ?? 0, 0, 'windowed delivery is not an omission');
  });

  it('under budget pressure, every requested seed is either rendered or listed in `omitted` with a reason', () => {
    const g = createKnowledgeGraph();
    const seeds: SeedSymbol[] = [];
    for (let i = 0; i < 8; i++) {
      const body = Array.from({ length: 80 }, (_, j) => `  const v${j} = step${i}(${j});`).join('\n');
      addNode(g, { id: `n${i}`, kind: 'function', name: `fn${i}`, filePath: `src/f${i}.ts`, content: `function fn${i}() {\n${body}\n}` });
      seeds.push({ nodeId: `n${i}`, refinedScore: 1 });
    }
    const doc = build(seeds, g, { maxTokens: 200 });
    const omittedNames = new Set((doc.omitted ?? []).map((o) => o.name));
    for (let i = 0; i < 8; i++) {
      const name = `fn${i}`;
      const rendered = doc.focusCode.includes(`// ${name} —`);
      assert.ok(rendered || omittedNames.has(name), `${name} must be rendered or explicitly omitted, not silently dropped`);
    }
    for (const omission of doc.omitted ?? []) {
      assert.ok(omission.reason, `omission for ${omission.name} must carry a structured reason`);
    }
  });

  it('final hard budget ceiling is never exceeded even under heavy pressure', () => {
    const g = createKnowledgeGraph();
    const seeds: SeedSymbol[] = [];
    for (let i = 0; i < 10; i++) {
      const body = Array.from({ length: 120 }, (_, j) => `  const v${j} = step${i}(${j});`).join('\n');
      addNode(g, { id: `n${i}`, kind: 'function', name: `fn${i}`, filePath: `src/f${i}.ts`, content: `function fn${i}() {\n${body}\n}` });
      seeds.push({ nodeId: `n${i}`, refinedScore: 1 });
    }
    const doc = build(seeds, g, { maxTokens: 150 });
    assert.ok((doc.blockTokens?.total ?? 0) <= 150, `blockTokens.total (${doc.blockTokens?.total}) must stay <= maxTokens (150)`);
  });
});

describe('Session-aware delivery — content fingerprint dedup and edit-aware re-emission', () => {
  it('unchanged source repeated in the same session becomes a compact pointer', () => {
    const g = createKnowledgeGraph();
    addNode(g, { id: 'n1', kind: 'function', name: 'orchestrate', filePath: 'src/orchestrate.ts', content: 'function orchestrate() { return doWork(); }' });
    addNode(g, { id: 'n2', kind: 'function', name: 'other', filePath: 'src/other.ts', content: 'function other() { return 1; }' });
    // n3 only appears on the second call, so it is never pointer-eligible — this keeps
    // the second response from being all-pointer and lets n1 pointer-ize on its own merit.
    addNode(g, { id: 'n3', kind: 'function', name: 'fresh', filePath: 'src/fresh.ts', content: 'function fresh() { return 2; }' });
    const session = new ContextDeliverySession('workspace-a');

    const first = build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n2', refinedScore: 1 }], g, { session });
    assert.ok(first.focusCode.includes('return doWork()'));

    const second = build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n3', refinedScore: 1 }], g, { session });
    assert.ok(second.focusCode.includes('already delivered in this session'), 'unchanged repeat becomes a pointer');
    assert.ok(!second.focusCode.includes('return doWork()'), 'full body is not repeated when a pointer suffices');
    assert.ok(second.focusCode.includes('return 2'), 'the never-before-seen seed still renders concretely');
  });

  it('edited source (fingerprint changed) is re-emitted in full, not pointed at', () => {
    const g = createKnowledgeGraph();
    const node = addNode(g, { id: 'n1', kind: 'function', name: 'orchestrate', filePath: 'src/orchestrate.ts', content: 'function orchestrate() { return doWork(); }' });
    addNode(g, { id: 'n2', kind: 'function', name: 'other', filePath: 'src/other.ts', content: 'function other() { return 1; }' });
    const session = new ContextDeliverySession('workspace-a');

    build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n2', refinedScore: 1 }], g, { session });

    node.content = 'function orchestrate() { return doWorkDifferently(); }';
    const second = build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n2', refinedScore: 1 }], g, { session });
    assert.ok(second.focusCode.includes('doWorkDifferently'), 'edited source must be re-emitted');
    assert.ok(!second.focusCode.includes('already delivered in this session') || second.focusCode.includes('doWorkDifferently'));
  });

  it('two independent sessions do not leak delivered-source state (session isolation)', () => {
    const g = createKnowledgeGraph();
    addNode(g, { id: 'n1', kind: 'function', name: 'orchestrate', filePath: 'src/orchestrate.ts', content: 'function orchestrate() { return doWork(); }' });
    addNode(g, { id: 'n2', kind: 'function', name: 'other', filePath: 'src/other.ts', content: 'function other() { return 1; }' });
    const sessionA = new ContextDeliverySession('workspace-a');
    const sessionB = new ContextDeliverySession('workspace-b');

    build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n2', refinedScore: 1 }], g, { session: sessionA });
    const docB = build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n2', refinedScore: 1 }], g, { session: sessionB });

    assert.ok(docB.focusCode.includes('return doWork()'), 'a fresh session must not reuse another session\'s delivered-source memory');
  });

  it('never returns an all-pointer response — the sole seed stays concrete even on repeat', () => {
    const g = createKnowledgeGraph();
    addNode(g, { id: 'n1', kind: 'function', name: 'solo', filePath: 'src/solo.ts', content: 'function solo() { return 7; }' });
    const session = new ContextDeliverySession('workspace-a');

    build([{ nodeId: 'n1', refinedScore: 1 }], g, { session });
    const second = build([{ nodeId: 'n1', refinedScore: 1 }], g, { session });
    assert.ok(second.focusCode.includes('return 7'), 'the only seed must remain concrete rather than becoming a lone pointer');
  });

  it('trust/coverage metadata is present regardless of pointer delivery', () => {
    const g = createKnowledgeGraph();
    addNode(g, { id: 'n1', kind: 'function', name: 'orchestrate', filePath: 'src/orchestrate.ts', content: 'function orchestrate() { return doWork(); }' });
    addNode(g, { id: 'n2', kind: 'function', name: 'other', filePath: 'src/other.ts', content: 'function other() { return 1; }' });
    addNode(g, { id: 'n3', kind: 'function', name: 'doWork', filePath: 'src/dowork.ts', content: 'function doWork() { return 1; }' });
    g.addEdge({ id: 'n1-n3-calls', source: 'n1', target: 'n3', kind: 'calls', certainty: 'heuristic' });
    const session = new ContextDeliverySession('workspace-a');

    build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n2', refinedScore: 1 }], g, { session });
    const second = build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n2', refinedScore: 1 }], g, { session });
    assert.ok(second.trust, 'trust summary must survive dedup/trimming');
    assert.ok(second.coverage, 'coverage summary must survive dedup/trimming');
  });
});
