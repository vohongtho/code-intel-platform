import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface SearchResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  score: number;
  snippet?: string;
}

export function textSearch(
  graph: KnowledgeGraph,
  query: string,
  limit = 20,
): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];

  // Deprioritize test/dist paths
  const isTestPath = (fp: string) =>
    fp.includes('test') || fp.includes('spec') || fp.includes('__test');
  const isDistPath = (fp: string) =>
    fp.includes('/dist') || fp.includes('\\dist') || fp.includes('.d.ts');

  for (const node of graph.allNodes()) {
    if (['directory', 'cluster', 'flow'].includes(node.kind)) continue;

    let score = 0;
    const nameLC = node.name.toLowerCase();
    const pathLC = node.filePath.toLowerCase();
    // File basename (class name without extension) for prefix matching
    const fileBaseName = (node.filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? '').toLowerCase();
    const contentLC = node.content?.toLowerCase() ?? '';

    for (const term of terms) {
      // Name scoring
      if (nameLC === term) score += 10;
      else if (nameLC.startsWith(term)) score += 7;
      else if (nameLC.includes(term)) score += 5;

      // File-path scoring — boost file basename (class name) matches strongly
      if (fileBaseName === term) score += 8;       // e.g. query "token" → Token.php
      else if (fileBaseName.startsWith(term)) score += 5;
      else if (pathLC.includes(term)) score += 2;

      // Content scoring
      if (contentLC.includes(term)) score += 3;
    }

    // Boost source files over compiled/test files
    if (score > 0) {
      if (isDistPath(node.filePath)) score -= 8;
      if (isTestPath(node.filePath)) score -= 4;
      // Boost by kind relevance
      if (['function', 'class', 'interface', 'method'].includes(node.kind)) score += 1;
    }

    if (score > 0) {
      results.push({
        nodeId: node.id,
        name: node.name,
        kind: node.kind,
        filePath: node.filePath,
        score,
        snippet: node.content?.slice(0, 200),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function reciprocalRankFusion(
  ...rankings: SearchResult[][]
): SearchResult[] {
  const K = 60;
  const scoreMap = new Map<string, { result: SearchResult; rrfScore: number }>();

  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const result = ranking[rank];
      const existing = scoreMap.get(result.nodeId);
      const rrfContribution = 1 / (K + rank + 1);

      if (existing) {
        existing.rrfScore += rrfContribution;
      } else {
        scoreMap.set(result.nodeId, {
          result,
          rrfScore: rrfContribution,
        });
      }
    }
  }

  return [...scoreMap.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map((entry) => ({ ...entry.result, score: entry.rrfScore }));
}
