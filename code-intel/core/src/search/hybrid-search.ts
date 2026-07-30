import fs from 'node:fs';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { textSearch, reciprocalRankFusion, compareResults, isDefaultExcludedSearchPath } from './text-search.js';
import type { SearchResult } from './text-search.js';
import { VectorIndex } from './vector-index.js';
import { getEmbedder } from './embedder.js';

export interface HybridSearchOptions {
  vectorDbPath?: string; // path to vector.db; if absent → BM25 only
  bm25Limit?: number;    // results to fetch from BM25 before RRF (default: 50)
  vectorLimit?: number;  // results to fetch from vector before RRF (default: 50)
  /** Pre-computed BM25 results (from Bm25Index). If supplied, skips linear textSearch. */
  bm25Results?: SearchResult[];
  /** Include per-result lexical/vector/RRF evidence. */
  explainResults?: boolean;
}

export interface SearchScoreEvidence {
  lexicalScore?: number;
  vectorScore?: number;
  bm25Rank?: number;
  vectorRank?: number;
  bm25RrfContribution?: number;
  vectorRrfContribution?: number;
  finalScore: number;
}

export interface HybridSearchResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  score: number;
  snippet?: string;
  searchMode: 'bm25' | 'vector' | 'hybrid';
  evidence?: SearchScoreEvidence;
}

export async function hybridSearch(
  graph: KnowledgeGraph,
  query: string,
  limit: number,
  options: HybridSearchOptions = {},
): Promise<{ results: HybridSearchResult[]; searchMode: 'bm25' | 'vector' | 'hybrid' }> {
  const {
    vectorDbPath,
    bm25Limit = 50,
    vectorLimit = 50,
    bm25Results: precomputedBm25,
    explainResults = false,
  } = options;

  const bm25Promise = precomputedBm25
    ? Promise.resolve(precomputedBm25)
    : Promise.resolve(textSearch(graph, query, bm25Limit));

  const hasVectorDb = Boolean(vectorDbPath && fs.existsSync(vectorDbPath));

  if (!hasVectorDb) {
    const bm25Results = (await bm25Promise)
      .filter((result) => !isDefaultExcludedSearchPath(result.filePath))
      .sort(compareResults);
    return {
      results: bm25Results.slice(0, limit).map((result, rank) => ({
        ...result,
        searchMode: 'bm25' as const,
        evidence: explainResults
          ? { lexicalScore: result.score, bm25Rank: rank + 1, finalScore: result.score }
          : undefined,
      })),
      searchMode: 'bm25',
    };
  }

  const vectorPromise = runVectorSearch(vectorDbPath!, query, vectorLimit);
  const [bm25Results, vectorResults] = await Promise.all([bm25Promise, vectorPromise]);

  if (vectorResults === null || vectorResults.length === 0) {
    const filteredBm25 = bm25Results
      .filter((result) => !isDefaultExcludedSearchPath(result.filePath))
      .sort(compareResults);
    return {
      results: filteredBm25.slice(0, limit).map((result, rank) => ({
        ...result,
        searchMode: 'bm25' as const,
        evidence: explainResults
          ? { lexicalScore: result.score, bm25Rank: rank + 1, finalScore: result.score }
          : undefined,
      })),
      searchMode: 'bm25',
    };
  }

  const vectorAsSearchResults: SearchResult[] = vectorResults.map((hit) => ({
    nodeId: hit.nodeId,
    name: hit.name,
    kind: hit.kind,
    filePath: hit.filePath,
    score: hit.score,
    snippet: graph.getNode(hit.nodeId)?.content?.slice(0, 200),
  }));

  const merged = reciprocalRankFusion(bm25Results, vectorAsSearchResults)
    .filter((result) => !isDefaultExcludedSearchPath(result.filePath))
    .sort(compareResults);

  const bm25ById = new Map(
    bm25Results.map((result, rank) => [result.nodeId, { score: result.score, rank: rank + 1 }]),
  );
  const vectorById = new Map(
    vectorAsSearchResults.map((result, rank) => [result.nodeId, { score: result.score, rank: rank + 1 }]),
  );
  const RRF_K = 60;

  return {
    results: merged.slice(0, limit).map((result) => {
      const lexical = bm25ById.get(result.nodeId);
      const vector = vectorById.get(result.nodeId);
      return {
        ...result,
        searchMode: 'hybrid' as const,
        evidence: explainResults
          ? {
            lexicalScore: lexical?.score,
            vectorScore: vector?.score,
            bm25Rank: lexical?.rank,
            vectorRank: vector?.rank,
            bm25RrfContribution: lexical ? 1 / (RRF_K + lexical.rank) : undefined,
            vectorRrfContribution: vector ? 1 / (RRF_K + vector.rank) : undefined,
            finalScore: result.score,
          }
          : undefined,
      };
    }),
    searchMode: 'hybrid',
  };
}

async function runVectorSearch(
  vectorDbPath: string,
  query: string,
  topK: number,
): Promise<Array<{ nodeId: string; name: string; kind: string; filePath: string; score: number }> | null> {
  try {
    const idx = new VectorIndex(vectorDbPath);
    await idx.init();

    const built = await idx.isBuilt();
    if (!built) {
      idx.close();
      return null;
    }

    const embedder = await getEmbedder();
    const out = await embedder(query, { pooling: 'mean', normalize: true });
    const queryEmbedding = Array.from(out.data);

    const hits = await idx.search(queryEmbedding, topK);
    idx.close();
    return hits;
  } catch {
    return null;
  }
}
