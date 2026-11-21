import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { computePRImpactWithPrecision, parseDiffChangedLineRanges } from '../../src/query/pr-impact.js';

function fixture() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdg-pr-impact-'));
  fs.mkdirSync(path.join(repoDir, 'src'));
  fs.writeFileSync(path.join(repoDir, 'src/index.ts'), [
    'export function changed(a: number): number {',
    '  let x = a;',
    '  const y = x + 1;',
    '  return y;',
    '}',
  ].join('\n'));
  const graph = createKnowledgeGraph();
  graph.addNode({
    id: 'fn:changed',
    identityId: 'fn:changed',
    kind: 'function',
    name: 'changed',
    filePath: 'src/index.ts',
    startLine: 1,
    endLine: 5,
    exported: true,
  });
  return { repoDir, graph };
}

describe('PDG PR impact integration', () => {
  it('maps only added new-file lines rather than the surrounding hunk context', () => {
    const ranges = parseDiffChangedLineRanges([
      '+++ b/src/index.ts',
      '@@ -10,4 +10,5 @@',
      ' unchangedBefore();',
      '-oldValue();',
      '+changedValue();',
      ' unchangedMiddle();',
      '+anotherChange();',
      ' unchangedAfter();',
    ].join('\n'));

    assert.deepEqual(ranges, [
      { filePath: 'src/index.ts', startLine: 11, endLine: 11 },
      { filePath: 'src/index.ts', startLine: 13, endLine: 13 },
    ]);
  });

  it('maps a changed line through IR and PDG without replacing graph evidence', async () => {
    const { repoDir, graph } = fixture();
    try {
      const result = await computePRImpactWithPrecision(graph, ['src/index.ts'], 3, {
        repoDir,
        precision: 'pdg',
        changedRanges: [{ filePath: 'src/index.ts', startLine: 2, endLine: 2 }],
      });

      assert.equal(result.requestedPrecision, 'pdg');
      assert.equal(result.actualPrecision, 'pdg');
      assert.equal(result.changedSymbols[0]?.precision, 'pdg');
      assert.equal(result.changedSymbols[0]?.slice?.supported, true);
      assert.equal(result.sliceSummary?.slicedFunctions, 1);
      assert.equal(result.precisionMetrics?.pdgBuilds, 1);
      assert.ok(result.changedSymbols.length > 0, 'existing graph impact evidence must remain present');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('falls back to graph precision and never claims exact PDG impact without changed-line evidence', async () => {
    const { repoDir, graph } = fixture();
    try {
      const result = await computePRImpactWithPrecision(graph, ['src/index.ts'], 3, {
        repoDir,
        precision: 'pdg',
      });

      assert.equal(result.requestedPrecision, 'pdg');
      assert.equal(result.actualPrecision, 'graph');
      assert.equal(result.changedSymbols[0]?.precision, 'graph');
      assert.equal(result.changedSymbols[0]?.slice, undefined);
      assert.equal(result.fallbackCounts?.['changed-lines-unavailable'], 1);
      assert.match(result.changedSymbols[0]?.fallbackReason ?? '', /graph result retained/i);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('keeps auto precision on graph until the mutation evaluation gate passes', async () => {
    const { repoDir, graph } = fixture();
    try {
      const result = await computePRImpactWithPrecision(graph, ['src/index.ts'], 3, {
        repoDir,
        precision: 'auto',
        changedRanges: [{ filePath: 'src/index.ts', startLine: 2, endLine: 2 }],
      });
      assert.equal(result.actualPrecision, 'graph');
      assert.equal(result.fallbackCounts?.['mutation-gate-disabled'], 1);
      assert.equal(result.precisionMetrics?.pdgBuilds, 0);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
