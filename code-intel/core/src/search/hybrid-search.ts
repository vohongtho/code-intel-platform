import fs from 'node:fs';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { textSearch, reciprocalRankFusion } from './text-search.js';
import type { SearchResult } from './text-search.js';
import { VectorIndex } from './vector-index.js';
import { getEmbedder } from './embedder.js';

export interface HybridSearchOptions {
  vectorDbPath?: string; // path to vector.db; if absent → BM25 only
  bm25Limit?: number;    // results to fetch from BM25 before RRF (default: 50)
  vectorLimit?: number;  // results to fetch from vector before RRF (default: 50)
  /** Pre-computed BM25 results (from Bm25Index). If supplied, skips linear textSearch. */
  bm25Results?: SearchResult[];
}

export interface HybridSearchResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  score: number;
  snippet?: string;
  searchMode: 'bm25' | 'vector' | 'hybrid';
}

export async function hybridSearch(
  graph: KnowledgeGraph,
  query: string,
  limit: number,
  options: HybridSearchOptions = {},
): Promise<{ results: HybridSearchResult[]; searchMode: 'bm25' | 'vector' | 'hybrid' }> {
  const { vectorDbPath, bm25Limit = 50, vectorLimit = 50, bm25Results: precomputedBm25 } = options;

  // Use pre-computed BM25 results if supplied; otherwise fall back to linear textSearch
  const bm25Promise = precomputedBm25
    ? Promise.resolve(precomputedBm25)
    : Promise.resolve(textSearch(graph, query, bm25Limit));

  // Determine if vector search is available
  const hasVectorDb = Boolean(vectorDbPath && fs.existsSync(vectorDbPath));

  if (!hasVectorDb) {
    // BM25-only path
    const bm25Results = await bm25Promise;
    return {
      results: bm25Results.slice(0, limit).map((r) => ({ ...r, searchMode: 'bm25' as const })),
      searchMode: 'bm25',
    };
  }

  // Run BM25 + vector search in parallel
  const vectorPromise = runVectorSearch(vectorDbPath!, query, vectorLimit);
  const [bm25Results, vectorResults] = await Promise.all([bm25Promise, vectorPromise]);

  if (vectorResults === null || vectorResults.length === 0) {
    // Vector search failed or returned nothing — fall back to BM25
    return {
      results: bm25Results.slice(0, limit).map((r) => ({ ...r, searchMode: 'bm25' as const })),
      searchMode: 'bm25',
    };
  }

  // Convert vector hits to SearchResult format for RRF
  const vectorAsSearchResults: SearchResult[] = vectorResults.map((h) => ({
    nodeId: h.nodeId,
    name: h.name,
    kind: h.kind,
    filePath: h.filePath,
    score: h.score,
    snippet: graph.getNode(h.nodeId)?.content?.slice(0, 200),
  }));

  // Merge with Reciprocal Rank Fusion
  const merged = reciprocalRankFusion(bm25Results, vectorAsSearchResults);

  return {
    results: merged.slice(0, limit).map((r) => ({ ...r, searchMode: 'hybrid' as const })),
    searchMode: 'hybrid',
  };
}

/**
 * Run vector search against the given db path. Returns null on any error so
 * the caller can fall back gracefully to BM25-only results.
 */
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

    // Embed the query using the same model used for node embeddings
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
