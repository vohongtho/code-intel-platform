/**
 * group-query.ts
 * Search execution across all repos in a group.
 * Loads each repo's graph, runs scoped search, and merges via RRF.
 */
import fs from 'node:fs';
import type { RepoGroup } from './types.js';
import type { SearchResult } from '../search/text-search.js';
import { textSearch, reciprocalRankFusion } from '../search/text-search.js';
import { findRepoById, loadRegistry } from '../storage/repo-registry.js';
import { DbManager } from '../storage/db-manager.js';
import { createKnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadGraphFromDB } from './graph-from-db.js';
import { resolveIndexSnapshot } from '../storage/index-snapshot.js';
import { VectorIndex } from '../search/vector-index.js';
import { getConfiguredEmbeddingModel, getEmbedder } from '../search/embedder.js';
import { hybridSearch } from '../search/hybrid-search.js';

export interface GroupQueryResult {
  repoName: string;
  repoPath: string;
  groupPath: string;
  results: SearchResult[];
  vectorReady?: boolean;
}

export interface GroupSearchOptions {
  mode?: 'bm25' | 'vector' | 'hybrid';
}

export async function queryGroup(
  group: RepoGroup,
  query: string,
  limit = 20,
  options: GroupSearchOptions = {},
): Promise<{ perRepo: GroupQueryResult[]; merged: SearchResult[]; searchMode: 'bm25' | 'vector' | 'hybrid'; vectorReady: boolean }> {
  const registry = loadRegistry();
  const perRepo: GroupQueryResult[] = [];
  const allRankings: SearchResult[][] = [];
  const requestedMode = options.mode ?? 'hybrid';
  let anyVectorReady = false;
  let anyVectorUsed = false;

  for (const member of group.members) {
    const regEntry = member.repoId ? findRepoById(member.repoId, registry) : registry.find((r) => r.name === member.registryName);
    if (!regEntry) continue;

    const snapshot = resolveIndexSnapshot(regEntry.path);
    if (!snapshot || !fs.existsSync(snapshot.graphDbPath)) continue;
    const dbPath = snapshot.graphDbPath;

    const graph = createKnowledgeGraph();
    const db = new DbManager(dbPath, true);
    try {
      await db.init();
      await loadGraphFromDB(graph, db);
      db.close();
    } catch {
      db.close();
      continue;
    }

    const vectorDbPath = snapshot.vectorDbPath;
    const vectorReady = await isVectorReady(vectorDbPath);
    if (vectorReady) anyVectorReady = true;

    let results: SearchResult[];
    if (requestedMode === 'bm25') {
      results = textSearch(graph, query, limit);
    } else if (requestedMode === 'vector') {
      const vectorResults = vectorReady ? await runVectorSearch(graph, vectorDbPath, query, limit) : [];
      if (vectorResults.length > 0) {
        anyVectorUsed = true;
        results = vectorResults;
      } else {
        results = textSearch(graph, query, limit);
      }
    } else {
      const hybrid = await hybridSearch(graph, query, limit, { vectorDbPath });
      if (hybrid.searchMode !== 'bm25') anyVectorUsed = true;
      results = hybrid.results.map(({ searchMode: _searchMode, ...rest }) => rest);
    }

    const taggedResults: SearchResult[] = results.map((r) => ({
      ...r,
      repoName: regEntry.name,
      groupPath: member.groupPath,
      snippet: `[${regEntry.name}] ${r.snippet ?? ''}`.trim(),
    }));

    perRepo.push({
      repoName: regEntry.name,
      repoPath: regEntry.path,
      groupPath: member.groupPath,
      results: taggedResults,
      vectorReady,
    });
    allRankings.push(taggedResults);
  }

  const merged = reciprocalRankFusion(...allRankings).slice(0, limit);
  const searchMode = requestedMode === 'bm25'
    ? 'bm25'
    : requestedMode === 'vector'
      ? (anyVectorUsed ? 'vector' : 'bm25')
      : (anyVectorUsed ? 'hybrid' : 'bm25');
  return { perRepo, merged, searchMode, vectorReady: anyVectorReady };
}

async function isVectorReady(vectorDbPath: string): Promise<boolean> {
  if (!fs.existsSync(vectorDbPath)) return false;
  try {
    const model = getConfiguredEmbeddingModel();
    const idx = new VectorIndex(vectorDbPath, model.dimension);
    await idx.init();
    const built = await idx.isBuilt();
    idx.close();
    return built;
  } catch {
    return false;
  }
}

async function runVectorSearch(graph: ReturnType<typeof createKnowledgeGraph>, vectorDbPath: string, query: string, topK: number): Promise<SearchResult[]> {
  try {
    const model = getConfiguredEmbeddingModel();
    const idx = new VectorIndex(vectorDbPath, model.dimension);
    await idx.init();
    const built = await idx.isBuilt();
    if (!built) {
      idx.close();
      return [];
    }
    const embedder = await getEmbedder(model);
    const out = await embedder(query, { pooling: 'mean', normalize: true });
    const hits = await idx.search(Array.from(out.data), topK);
    idx.close();
    return hits.map((h) => ({
      nodeId: h.nodeId,
      name: h.name,
      kind: h.kind,
      filePath: h.filePath,
      score: h.score,
      snippet: graph.getNode(h.nodeId)?.content?.slice(0, 200),
    }));
  } catch {
    return [];
  }
}
