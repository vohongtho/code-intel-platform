/**
 * evidence-quality-benchmark.test.ts
 *
 * Fixed-index quality benchmark for the context evidence delivery pipeline.
 * Unlike token-benchmark.test.ts (token budget ceilings), this measures
 * evidence *quality*:
 *   - named-evidence recall: every explicitly requested symbol is delivered
 *     when budget is reasonable
 *   - unique evidence per token: distinct symbols surfaced per token spent
 *   - duplicate source bytes across repeated calls in one session
 *   - external file-read fallback count: how often the builder has to give up
 *     on source (missing-source omissions), forcing an agent to read the raw file
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build, type SeedSymbol } from '../../../src/context/builder.js';
import { measureBlocks } from '../../../src/context/token-counter.js';
import { ContextDeliverySession } from '../../../src/context/session.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { CodeNode } from '../../../src/shared/index.js';

// ── Fixed fixture index (deterministic — not randomly generated) ─────────────

function buildFixedIndex() {
  const g = createKnowledgeGraph();
  const nodes: CodeNode[] = [];

  for (let i = 0; i < 12; i++) {
    const node: CodeNode = {
      id: `named-${i}`,
      kind: 'function',
      name: `namedFn${i}`,
      filePath: `src/module${i}.ts`,
      startLine: 10 + i,
      content: Array.from({ length: 12 }, (_, j) => `  const step${j} = compute${i}(${j});`).join('\n'),
      metadata: { summary: `Handles operation ${i}.` },
    };
    g.addNode(node);
    nodes.push(node);
  }

  // One symbol with no extracted source — simulates an index gap that would
  // otherwise force an agent to fall back to a raw file read.
  const noSource: CodeNode = { id: 'no-source-1', kind: 'function', name: 'undocumentedFn', filePath: 'src/legacy.ts' };
  g.addNode(noSource);
  nodes.push(noSource);

  return { g, nodes };
}

const { g, nodes } = buildFixedIndex();
const namedSeeds: SeedSymbol[] = nodes.slice(0, 12).map((n) => ({ nodeId: n.id, refinedScore: 1 }));

// ── Named-evidence recall ─────────────────────────────────────────────────────

describe('Quality benchmark — named-evidence recall', () => {
  it('every explicitly named symbol is delivered (rendered or explicitly omitted) at a generous budget', () => {
    const doc = build(namedSeeds, g, { maxTokens: 6000 });
    const omittedNames = new Set((doc.omitted ?? []).map((o) => o.name));
    let renderedCount = 0;
    for (const node of nodes.slice(0, 12)) {
      const rendered = doc.focusCode.includes(`// ${node.name} —`);
      if (rendered) renderedCount++;
      assert.ok(rendered || omittedNames.has(node.name), `${node.name} must be delivered or explicitly omitted`);
    }
    const recall = renderedCount / namedSeeds.length;
    assert.ok(recall >= 0.9, `named-evidence recall ${recall} should be >= 0.9 at a generous budget`);
  });
});

// ── Unique evidence per token ─────────────────────────────────────────────────

describe('Quality benchmark — unique evidence per token', () => {
  it('reports at least one distinct symbol per ~150 tokens spent', () => {
    const doc = build(namedSeeds, g, { maxTokens: 6000 });
    const counts = measureBlocks(doc);
    const distinctSymbols = new Set(nodes.slice(0, 12).filter((n) => doc.focusCode.includes(`// ${n.name} —`)).map((n) => n.name)).size;
    const uniqueEvidencePerToken = distinctSymbols / Math.max(1, counts.total);
    assert.ok(uniqueEvidencePerToken > 0, 'unique evidence per token must be positive when evidence was delivered');
    assert.ok(counts.total / Math.max(1, distinctSymbols) < 150, 'should not spend more than ~150 tokens per unique symbol delivered');
  });
});

// ── Duplicate source bytes across repeated calls ──────────────────────────────

describe('Quality benchmark — duplicate source bytes across repeated calls', () => {
  it('a 5-call session sharply reduces duplicate source bytes versus 5 independent calls', () => {
    const bytesOf = (doc: ReturnType<typeof build>) => doc.focusCode.length;

    // Baseline: 5 independent (session-less) calls — full source resent every time.
    let baselineBytes = 0;
    for (let i = 0; i < 5; i++) baselineBytes += bytesOf(build(namedSeeds, g, { maxTokens: 6000 }));

    // With a shared session, calls 2-5 should collapse unchanged source into pointers.
    const session = new ContextDeliverySession('workspace-benchmark');
    let sessionBytes = 0;
    for (let i = 0; i < 5; i++) sessionBytes += bytesOf(build(namedSeeds, g, { maxTokens: 6000, session }));

    assert.ok(sessionBytes < baselineBytes, `session-aware delivery (${sessionBytes}b) should emit fewer bytes than repeated cold calls (${baselineBytes}b)`);
    assert.ok(sessionBytes / baselineBytes < 0.6, 'repeated-call byte volume should shrink by at least 40% once source is session-cached');
  });
});

// ── External file-read fallback count ─────────────────────────────────────────

describe('Quality benchmark — external file-read fallback count', () => {
  it('symbols with no extracted source are reported as missing-source omissions, not silently dropped', () => {
    const seeds: SeedSymbol[] = [...namedSeeds, { nodeId: 'no-source-1', refinedScore: 1 }];
    const doc = build(seeds, g, { maxTokens: 6000 });
    const fallbacks = (doc.omitted ?? []).filter((o) => o.reason === 'missing-source');
    assert.equal(fallbacks.length, 1, 'exactly the one sourceless symbol should be flagged for external file-read fallback');
    assert.equal(fallbacks[0]?.name, 'undocumentedFn');
  });
});
