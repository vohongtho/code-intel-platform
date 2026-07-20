import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface SearchResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  score: number;
  snippet?: string;
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'how', 'of', 'the', 'to', 'what', 'where']);
const TERM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  portal: ['page'],
};
const SEARCH_CACHE_MAX = 100;
const searchCache = new WeakMap<KnowledgeGraph, Map<string, SearchResult[]>>();

export function clearTextSearchCache(graph?: KnowledgeGraph): void {
  if (graph) searchCache.delete(graph);
}

function queryTerms(query: string): string[] {
  const normalized = query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const terms = normalized.filter((term) => !STOP_WORDS.has(term));
  return [...new Set(terms.flatMap((term) => [term, ...(TERM_ALIASES[term] ?? [])]))];
}

function compareResults(a: SearchResult, b: SearchResult): number {
  return b.score - a.score
    || a.name.localeCompare(b.name)
    || a.filePath.localeCompare(b.filePath)
    || a.nodeId.localeCompare(b.nodeId);
}

export function textSearch(
  graph: KnowledgeGraph,
  query: string,
  limit = 20,
): SearchResult[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const cacheKey = `${graph.size.nodes}:${graph.size.edges}\0${limit}\0${terms.join('\0')}`;
  let graphCache = searchCache.get(graph);
  if (!graphCache) {
    graphCache = new Map();
    searchCache.set(graph, graphCache);
  }
  const cached = graphCache.get(cacheKey);
  if (cached) return cached.map((result) => ({ ...result }));

  const candidateLimit = Math.max(50, limit * 5);
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
    const contentLC = node.content?.toLowerCase() ?? '';
    let coveredTerms = 0;

    for (const term of terms) {
      let matched = false;
      if (nameLC === term) { score += 14; matched = true; }
      else if (nameLC.startsWith(term)) { score += 9; matched = true; }
      else if (nameLC.includes(term)) { score += 6; matched = true; }
      if (pathLC.includes(term)) { score += 4; matched = true; }
      if (contentLC.includes(term)) { score += 2; matched = true; }
      if (matched) coveredTerms++;
    }
    // Multi-term coverage is the strongest signal for natural-language intent.
    if (coveredTerms > 1) score += coveredTerms * coveredTerms * 3;

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
      if (results.length > candidateLimit * 2) {
        results.sort(compareResults);
        results.length = candidateLimit;
      }
    }
  }

  results.sort(compareResults);
  const ranked = results.slice(0, Math.min(limit, candidateLimit));
  graphCache.set(cacheKey, ranked);
  if (graphCache.size > SEARCH_CACHE_MAX) graphCache.delete(graphCache.keys().next().value!);
  return ranked.map((result) => ({ ...result }));
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
