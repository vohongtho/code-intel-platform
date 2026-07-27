import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

type Hit = { nodeId: string; name: string; kind: string; filePath: string; score: number; repoName: string; groupPath: string };

function reciprocalRankFusion<T extends { nodeId: string }>(...rankings: T[][]): T[] {
  const scores = new Map<string, { item: T; score: number }>();
  for (const ranking of rankings) {
    ranking.forEach((item, index) => {
      const current = scores.get(item.nodeId) ?? { item, score: 0 };
      current.score += 1 / (60 + index + 1);
      scores.set(item.nodeId, current);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.item.nodeId.localeCompare(b.item.nodeId)).map((x) => x.item);
}

describe('group vector merge uses deterministic RRF', () => {
  it('merges per-repo rankings deterministically', () => {
    const repoA: Hit[] = [
      { nodeId: 'a1', name: 'A1', kind: 'function', filePath: 'a.ts', score: 0.9, repoName: 'repo-a', groupPath: 'services/a' },
      { nodeId: 'a2', name: 'A2', kind: 'function', filePath: 'a2.ts', score: 0.7, repoName: 'repo-a', groupPath: 'services/a' },
    ];
    const repoB: Hit[] = [
      { nodeId: 'b1', name: 'B1', kind: 'function', filePath: 'b.ts', score: 0.95, repoName: 'repo-b', groupPath: 'services/b' },
      { nodeId: 'a2', name: 'A2', kind: 'function', filePath: 'a2.ts', score: 0.8, repoName: 'repo-a', groupPath: 'services/a' },
    ];
    const merged1 = reciprocalRankFusion(repoA, repoB).map((x) => x.nodeId);
    const merged2 = reciprocalRankFusion(repoA, repoB).map((x) => x.nodeId);
    assert.deepEqual(merged1, merged2);
    assert.equal(merged1.includes('a2'), true);
  });

  it('preserves repo attribution fields on merged hits', () => {
    const merged = reciprocalRankFusion([
      { nodeId: 'x', name: 'X', kind: 'function', filePath: 'x.ts', score: 0.8, repoName: 'repo-x', groupPath: 'svc/x' },
    ] as Hit[]);
    assert.equal(merged[0]?.repoName, 'repo-x');
    assert.equal(merged[0]?.groupPath, 'svc/x');
  });
});
