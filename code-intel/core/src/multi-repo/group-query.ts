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
import { hybridSearch } from '../search/hybrid-search.js';
import { resolveVectorRuntimeState } from '../search/vector-runtime-state.js';
import { loadMetadata } from '../storage/metadata.js';
import { getEmbeddingFingerprint } from '../search/embedder.js';
import { getDefaultEmbeddingModel, getEmbeddingModel } from '../search/embedding-model-registry.js';
import { loadConfig, DEFAULT_CONFIG } from '../cli/init-wizard.js';
import { normalizeConfigEmbeddingModel } from '../cli/config-manager.js';

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
    
    // Resolve vector runtime state for this member repo
    let vectorRuntimeState = null;
    if (vectorDbPath && fs.existsSync(vectorDbPath)) {
      try {
        const metadata = loadMetadata(regEntry.path);
        const config = normalizeConfigEmbeddingModel(loadConfig() ?? DEFAULT_CONFIG);
        const descriptor = getEmbeddingModel(config.embeddings.model) ?? getDefaultEmbeddingModel();
        const runtimeFingerprint = getEmbeddingFingerprint({ descriptor });
        
        vectorRuntimeState = await resolveVectorRuntimeState({
          vectorDbPath,
          descriptor,
          runtimeFingerprint,
          metadata: metadata ?? undefined,
        });
      } catch {
        // If runtime state resolution fails, treat vector as unavailable
        vectorRuntimeState = null;
      }
    }
    
    const vectorReady = vectorRuntimeState?.ready ?? false;
    if (vectorReady) anyVectorReady = true;

    let results: SearchResult[];
    if (requestedMode === 'bm25') {
      results = textSearch(graph, query, limit);
    } else if (requestedMode === 'vector') {
      if (vectorReady && vectorRuntimeState?.descriptor) {
        // Use vector search with validated descriptor
        const vectorResults = await runVectorSearch(graph, vectorDbPath, vectorRuntimeState.descriptor, query, limit);
        if (vectorResults.length > 0) {
          anyVectorUsed = true;
          results = vectorResults;
        } else {
          results = textSearch(graph, query, limit);
        }
      } else {
        // Vector not ready, fallback to BM25
        results = textSearch(graph, query, limit);
      }
    } else {
      // Hybrid mode: pass descriptor if vector is ready
      const hybrid = await hybridSearch(graph, query, limit, {
        vectorDbPath: vectorReady ? vectorDbPath : undefined,
        descriptor: vectorRuntimeState?.descriptor,
      });
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

async function runVectorSearch(
  graph: ReturnType<typeof createKnowledgeGraph>,
  vectorDbPath: string,
  descriptor: ReturnType<typeof getDefaultEmbeddingModel>,
  query: string,
  topK: number,
): Promise<SearchResult[]> {
  try {
    const { getEmbedder } = await import('../search/embedder.js');
    const { VectorIndex } = await import('../search/vector-index.js');
    
    // Open in read-only mode for search-time access to published vector artifacts
    const idx = new VectorIndex(vectorDbPath, descriptor.dimension, { readonly: true });
    await idx.init();
    const built = await idx.isBuilt();
    if (!built) {
      idx.close();
      return [];
    }
    const embedder = await getEmbedder({ descriptor });
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
