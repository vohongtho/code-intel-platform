import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { correlateContinuity } from '../../../src/snapshots/continuity.js';
import { diffEntitiesWithContinuity } from '../../../src/snapshots/graph-diff.js';
import type { NormalizedGraph, NormalizedNode } from '../../../src/snapshots/normalizer.js';
import type { EntityDelta } from '../../../src/snapshots/types.js';

function node(id: string, filePath: string, name: string, contentFingerprint: string): NormalizedNode {
  return { id, kind: 'function', properties: { name, filePath, contentFingerprint } };
}

function graph(nodes: NormalizedNode[]): NormalizedGraph {
  return { nodesById: new Map(nodes.map((n) => [n.id, n])), edgesByKey: new Map() };
}

function removedDelta(n: NormalizedNode): EntityDelta {
  return { kind: 'removed', nodeKind: n.kind, baseId: n.id, baseName: n.properties.name, baseFilePath: n.properties.filePath };
}

function addedDelta(n: NormalizedNode): EntityDelta {
  return { kind: 'added', nodeKind: n.kind, headId: n.id, headName: n.properties.name, headFilePath: n.properties.filePath };
}

describe('continuity: proven rename/move', () => {
  it('classifies an unambiguous same-content, same-file, different-ID pair as renamed', () => {
    const a = node('sym:a:old', 'src/index.ts', 'oldName', 'fp-shared');
    const b = node('sym:a:new', 'src/index.ts', 'newName', 'fp-shared');
    const base = graph([a]);
    const head = graph([b]);
    const result = correlateContinuity({ base, head, removed: [removedDelta(a)], added: [addedDelta(b)] });

    assert.equal(result.length, 1);
    assert.equal(result[0]!.kind, 'renamed');
    assert.equal(result[0]!.baseId, 'sym:a:old');
    assert.equal(result[0]!.headId, 'sym:a:new');
    assert.equal(result[0]!.continuity?.certainty, 'proven');
    assert.ok(result[0]!.continuity?.evidenceKinds.includes('content-fingerprint'));
  });

  it('classifies an unambiguous same-content, different-file pair as moved', () => {
    const a = node('sym:a:old', 'src/a.ts', 'helper', 'fp-shared');
    const b = node('sym:a:new', 'src/lib/b.ts', 'helper', 'fp-shared');
    const base = graph([a]);
    const head = graph([b]);
    const result = correlateContinuity({ base, head, removed: [removedDelta(a)], added: [addedDelta(b)] });

    assert.equal(result.length, 1);
    assert.equal(result[0]!.kind, 'moved');
    assert.equal(result[0]!.continuity?.certainty, 'proven');
  });

  it('records git-rename-detection as corroborating evidence when the containing file is a known Git rename', () => {
    const a = node('sym:a:old', 'src/a.ts', 'helper', 'fp-shared');
    const b = node('sym:a:new', 'src/b.ts', 'helper', 'fp-shared');
    const renamedFiles = new Map([['src/a.ts', 'src/b.ts']]);
    const result = correlateContinuity({ base: graph([a]), head: graph([b]), removed: [removedDelta(a)], added: [addedDelta(b)], renamedFiles });
    assert.equal(result[0]!.kind, 'moved');
    assert.ok(result[0]!.continuity?.evidenceKinds.includes('git-rename-detection'));
  });
});

describe('continuity: conservative on ambiguity', () => {
  it('never merges two unrelated same-named symbols with different content into a rename', () => {
    const a = node('sym:a', 'src/a.ts', 'process', 'fp-A');
    const b = node('sym:b', 'src/b.ts', 'process', 'fp-B');
    const result = correlateContinuity({ base: graph([a]), head: graph([b]), removed: [removedDelta(a)], added: [addedDelta(b)] });

    // Different content fingerprints never group together at all — each
    // stays exactly what it was: a plain removed and a plain added delta.
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((d) => d.kind).sort(), ['added', 'removed']);
    assert.ok(result.every((d) => d.continuity === undefined));
  });

  it('never picks a pairing among identical-body overloads — reports every candidate instead', () => {
    // Two overloads in base with byte-identical trivial bodies, and two in
    // head with the same identical body — a real scenario for e.g. stub
    // methods. Proving which base overload became which head overload from
    // content alone is impossible; the diff must not guess.
    const baseA = node('sym:overload:1', 'src/a.ts', 'noop', 'fp-empty-body');
    const baseB = node('sym:overload:2', 'src/a.ts', 'noop2', 'fp-empty-body');
    const headA = node('sym:overload:3', 'src/a.ts', 'noop3', 'fp-empty-body');
    const headB = node('sym:overload:4', 'src/a.ts', 'noop4', 'fp-empty-body');

    const result = correlateContinuity({
      base: graph([baseA, baseB]),
      head: graph([headA, headB]),
      removed: [removedDelta(baseA), removedDelta(baseB)],
      added: [addedDelta(headA), addedDelta(headB)],
    });

    // Every original delta survives unmerged...
    assert.equal(result.length, 4);
    assert.deepEqual(result.map((d) => d.kind).sort(), ['added', 'added', 'removed', 'removed']);
    // ...but each is annotated with candidate continuity, not silently dropped.
    for (const delta of result) {
      assert.equal(delta.continuity?.certainty, 'candidate');
      assert.equal(delta.continuityCandidates?.length, 2);
    }
  });

  it('does not treat a shared display name alone as continuity evidence', () => {
    // Same name, no shared content fingerprint at all (one side even has none).
    const a: NormalizedNode = { id: 'sym:a', kind: 'function', properties: { name: 'run', filePath: 'src/a.ts' } };
    const b: NormalizedNode = { id: 'sym:b', kind: 'function', properties: { name: 'run', filePath: 'src/a.ts' } };
    const result = correlateContinuity({ base: graph([a]), head: graph([b]), removed: [removedDelta(a)], added: [addedDelta(b)] });
    assert.equal(result.length, 2);
    assert.ok(result.every((d) => d.kind === 'removed' || d.kind === 'added'));
  });
});

describe('graph-diff: diffEntitiesWithContinuity end-to-end', () => {
  it('merges a proven rename pair and leaves an unrelated changed node untouched', () => {
    const before = node('sym:old', 'src/a.ts', 'oldName', 'fp-shared');
    const stable = node('sym:stable', 'src/a.ts', 'stable', 'fp-stable-1');
    const after = node('sym:new', 'src/a.ts', 'newName', 'fp-shared');
    const stableChanged = node('sym:stable', 'src/a.ts', 'stable', 'fp-stable-2');

    const base = graph([before, stable]);
    const head = graph([after, stableChanged]);
    const deltas = diffEntitiesWithContinuity(base, head);

    const renamed = deltas.find((d) => d.kind === 'renamed');
    const changed = deltas.find((d) => d.kind === 'changed');
    assert.ok(renamed, 'expected a renamed delta');
    assert.equal(renamed!.baseId, 'sym:old');
    assert.equal(renamed!.headId, 'sym:new');
    assert.ok(changed, 'expected the unrelated node to be reported as changed');
    assert.equal(changed!.baseId, 'sym:stable');
  });
});
