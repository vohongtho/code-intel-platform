import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planRender, renderModeDistribution, RENDER_MODE_WEIGHTS } from '../../../src/context/render-policy.js';
import { build } from '../../../src/context/builder.js';
import { ContextDeliverySession, contentFingerprint } from '../../../src/context/session.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { CodeNode } from '../../../src/shared/index.js';

function bigBody(name: string, extra = ''): string {
  const filler = Array.from({ length: 14 }, (_, i) => `  const v${i} = compute${i}(${i}) * ${i};`).join('\n');
  return `function ${name}(input: string): string {\n${filler}\n  audit(input);\n${extra}  return finish(input);\n}`;
}

function mkNode(id: string, name: string, content: string, kind: CodeNode['kind'] = 'function', filePath = `src/${name}.ts`): CodeNode {
  return { id, kind, name, filePath, content, startLine: 1 };
}

describe('render-policy — planRender', () => {
  it('gives the central node full source and compresses repetitive supporting siblings', async () => {
    const nodes = [
      mkNode('orch', 'orchestrate', bigBody('orchestrate')),
      ...['a', 'b', 'c', 'd', 'e'].map((s) => mkNode(`s${s}`, `handle${s}`, bigBody(`handle${s}`))),
    ];
    const plan = await planRender({
      candidates: nodes.map((node, i) => ({ node, relevance: 1 - i * 0.1 })),
      maxTokens: 4000,
    });
    assert.equal(plan.decisions.get('orch')!.mode, 'full');
    const dist = renderModeDistribution(plan);
    assert.equal(dist.full, 1);
    assert.equal(dist.snippet, 1);
    assert.equal(dist.skeleton + dist.signature, 4);
    for (const decision of plan.decisions.values()) {
      if (decision.mode === 'skeleton') {
        assert.ok(decision.skeletonText);
        assert.equal(decision.bodyOmitted, true);
      }
    }
  });

  it('is deterministic', async () => {
    const nodes = [mkNode('a', 'alpha', bigBody('alpha')), mkNode('b', 'beta', bigBody('beta'))];
    const input = { candidates: nodes.map((node) => ({ node, relevance: 0.5 })), maxTokens: 3000 };
    const first = await planRender(input);
    const second = await planRender({ candidates: [...input.candidates].reverse(), maxTokens: 3000 });
    assert.deepEqual([...first.decisions.entries()], [...second.decisions.entries()]);
  });

  it('falls back to signature and records the boundary for unsupported languages', async () => {
    const nodes = [
      mkNode('c1', 'main', bigBody('main'), 'function', 'src/main.go'),
      mkNode('c2', 'a', bigBody('a'), 'function', 'src/a.go'),
      mkNode('c3', 'b', bigBody('b'), 'function', 'src/b.go'),
      mkNode('c4', 'c', bigBody('c'), 'function', 'src/c.go'),
      mkNode('c5', 'd', bigBody('d'), 'function', 'src/d.go'),
    ];
    const plan = await planRender({ candidates: nodes.map((node, i) => ({ node, relevance: 1 - i * 0.1 })), maxTokens: 4000 });
    const last = plan.decisions.get('c5')!;
    assert.equal(last.mode, 'signature');
    assert.equal(last.requestedMode, 'skeleton');
    assert.equal(last.boundary, 'skeleton-unsupported:language-unsupported');
    assert.equal(last.skeletonText, undefined);
  });

  it('compression "none" never skeletonizes', async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => mkNode(`n${i}`, `fn${i}`, bigBody(`fn${i}`)));
    const plan = await planRender({ candidates: nodes.map((node, i) => ({ node, relevance: 1 - i * 0.1 })), maxTokens: 4000, compression: 'none' });
    const dist = renderModeDistribution(plan);
    assert.equal(dist.skeleton + dist.signature, 0);
    assert.equal(dist.full, 1);
  });

  it('uses reference only when identity, fingerprint and index identity match', async () => {
    const node = mkNode('x', 'ping', bigBody('ping'));
    const session = new ContextDeliverySession('ws');
    session.record('x', contentFingerprint(node.content), node.content!.length, undefined, 'gen-1');
    const candidates = [{ node, relevance: 1 }];

    assert.equal((await planRender({ candidates, maxTokens: 2000, session, indexIdentity: 'gen-1' })).decisions.get('x')!.mode, 'reference');
    assert.notEqual((await planRender({ candidates, maxTokens: 2000, session, indexIdentity: 'gen-2' })).decisions.get('x')!.mode, 'reference');
    assert.notEqual((await planRender({ candidates, maxTokens: 2000, session })).decisions.get('x')!.mode, 'reference');
    const changed = { ...node, content: node.content + '\n// edited' };
    assert.notEqual((await planRender({ candidates: [{ node: changed, relevance: 1 }], maxTokens: 2000, session, indexIdentity: 'gen-1' })).decisions.get('x')!.mode, 'reference');
  });

  it('allocation never exceeds demand and reference costs nothing', async () => {
    const node = mkNode('x', 'ping', bigBody('ping'));
    const plan = await planRender({ candidates: [{ node, relevance: 1 }], maxTokens: 6000 });
    assert.ok(plan.decisions.get('x')!.tokenAllocation > 0);
    assert.ok(RENDER_MODE_WEIGHTS.reference < RENDER_MODE_WEIGHTS.signature);
  });
});

describe('builder — render plan integration', () => {
  function graphWith(nodes: CodeNode[]) {
    const graph = createKnowledgeGraph();
    for (const node of nodes) graph.addNode(node);
    return graph;
  }

  it('renders skeleton and signature entries and records applied decisions', async () => {
    const nodes = [
      mkNode('orch', 'orchestrate', bigBody('orchestrate')),
      ...['a', 'b', 'c', 'd', 'e'].map((s) => mkNode(`s${s}`, `handle${s}`, bigBody(`handle${s}`))),
    ];
    const graph = graphWith(nodes);
    const plan = await planRender({ candidates: nodes.map((node, i) => ({ node, relevance: 1 - i * 0.1 })), maxTokens: 6000 });
    const doc = build(nodes.map((n) => ({ nodeId: n.id, refinedScore: 1 })), graph, { maxTokens: 6000, renderPlan: plan });
    assert.ok(doc.renderDecisions);
    const modes = new Set(doc.renderDecisions!.map((d) => d.mode));
    assert.ok(modes.has('full'));
    assert.ok(modes.has('skeleton') || modes.has('signature'));
    assert.match(doc.focusCode, /skeleton — body detail omitted|signature only/);
    const omitted = doc.renderDecisions!.filter((d) => d.bodyOmitted);
    assert.ok(omitted.length >= 1);
    assert.ok(doc.blockTokens!.total <= 6000);
  });

  it('keeps the hard token budget with a render plan', async () => {
    const nodes = Array.from({ length: 8 }, (_, i) => mkNode(`n${i}`, `fn${i}`, bigBody(`fn${i}`)));
    const graph = graphWith(nodes);
    const plan = await planRender({ candidates: nodes.map((node, i) => ({ node, relevance: 1 - i * 0.05 })), maxTokens: 400 });
    const doc = build(nodes.map((n) => ({ nodeId: n.id })), graph, { maxTokens: 400, renderPlan: plan });
    assert.ok(doc.blockTokens!.total <= 400, `total ${doc.blockTokens!.total}`);
  });

  it('does not let a skeleton delivery license a later pointer reference', async () => {
    const nodes = [
      mkNode('orch', 'orchestrate', bigBody('orchestrate')),
      ...['a', 'b', 'c', 'd', 'e'].map((s) => mkNode(`s${s}`, `handle${s}`, bigBody(`handle${s}`))),
    ];
    const graph = graphWith(nodes);
    const session = new ContextDeliverySession('ws');
    const plan = await planRender({ candidates: nodes.map((node, i) => ({ node, relevance: 1 - i * 0.1 })), maxTokens: 6000, session });
    build(nodes.map((n) => ({ nodeId: n.id })), graph, { maxTokens: 6000, renderPlan: plan, session });
    const compressed = plan.decisions.get('se')!;
    assert.ok(compressed.mode === 'skeleton' || compressed.mode === 'signature');
    assert.equal(session.lookup('se'), undefined);
    assert.ok(session.lookup('orch'));
  });

  it('resends source when the session record is stale (changed content)', async () => {
    const node = mkNode('x', 'ping', bigBody('ping'));
    const other = mkNode('y', 'pong', bigBody('pong'));
    const graph = graphWith([node, other]);
    const session = new ContextDeliverySession('ws');
    session.record('x', contentFingerprint('old content'), 11, undefined, 'gen-1');
    const plan = await planRender({ candidates: [{ node, relevance: 1 }, { node: other, relevance: 0.9 }], maxTokens: 4000, session, indexIdentity: 'gen-1' });
    const doc = build([{ nodeId: 'x' }, { nodeId: 'y' }], graph, { maxTokens: 4000, renderPlan: plan, session, indexIdentity: 'gen-1' });
    assert.ok(!/unchanged — already delivered/.test(doc.focusCode));
    assert.match(doc.focusCode, /const v0 = compute0/);
  });

  it('turns a fresh reference into a pointer but resends it when the index identity changed', async () => {
    const node = mkNode('x', 'ping', bigBody('ping'));
    const other = mkNode('y', 'pong', bigBody('pong'));
    const graph = graphWith([node, other]);
    const session = new ContextDeliverySession('ws');
    session.record('x', contentFingerprint(node.content), 1, undefined, 'gen-1');

    const fresh = build([{ nodeId: 'x' }, { nodeId: 'y' }], graph, { maxTokens: 4000, session, indexIdentity: 'gen-1' });
    assert.match(fresh.focusCode, /unchanged — already delivered/);

    const movedSession = new ContextDeliverySession('ws');
    movedSession.record('x', contentFingerprint(node.content), 1, undefined, 'gen-1');
    const moved = build([{ nodeId: 'x' }, { nodeId: 'y' }], graph, { maxTokens: 4000, session: movedSession, indexIdentity: 'gen-2' });
    assert.ok(!/unchanged — already delivered/.test(moved.focusCode));
  });

  it('legacy build() without a plan emits no renderDecisions', () => {
    const node = mkNode('x', 'ping', 'function ping() { return 1; }');
    const doc = build([{ nodeId: 'x' }], graphWith([node]));
    assert.equal(doc.renderDecisions, undefined);
  });
});
