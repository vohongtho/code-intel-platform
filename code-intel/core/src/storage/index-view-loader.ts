import fs from 'node:fs';
import { createKnowledgeGraph, type KnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadGraphFromDB } from '../multi-repo/graph-from-db.js';
import { Bm25Index } from '../search/bm25-index.js';
import { DbManager } from './db-manager.js';
import type { IndexMetadata } from './metadata.js';
import type { ReadIndexView } from './index-view.js';

export interface LoadedIndexView {
  graph: KnowledgeGraph;
  bm25Index: Bm25Index | null;
  metadata: IndexMetadata | null;
}

/**
 * Snapshot views are immutable per identity, so their loaded graph/BM25 can be
 * shared across requests and transports. A small LRU bounds memory: each entry
 * holds a whole in-memory graph.
 */
const VIEW_CACHE_MAX = 4;
const viewCache = new Map<string, Promise<LoadedIndexView>>();

export function resetIndexViewLoaderForTests(): void {
  viewCache.clear();
}

async function loadArtifacts(view: ReadIndexView): Promise<LoadedIndexView> {
  const db = new DbManager(view.graphDbPath, true);
  await db.init();
  const graph = createKnowledgeGraph();
  try {
    await loadGraphFromDB(graph, db);
  } finally {
    db.close();
  }
  let bm25Index: Bm25Index | null = null;
  if (view.bm25DbPath) {
    try {
      const idx = new Bm25Index(view.bm25DbPath);
      idx.load();
      bm25Index = idx;
    } catch {
      bm25Index = null;
    }
  }
  let metadata: IndexMetadata | null = null;
  try { metadata = JSON.parse(fs.readFileSync(view.metadataPath, 'utf8')) as IndexMetadata; } catch { /* optional */ }
  return { graph, bm25Index, metadata };
}

/**
 * Loads (or reuses) the graph, BM25 index and metadata of one view. The caller must
 * hold the view (read pin) while this runs; once loaded, the in-memory copies do not
 * depend on the files. Generation views are not cached here — transports already
 * cache the active index and reload it when the generation changes.
 */
export async function loadIndexViewArtifacts(view: ReadIndexView): Promise<LoadedIndexView> {
  if (view.kind !== 'semantic-snapshot') return loadArtifacts(view);
  const cacheId = `${view.artifactsDir}@${view.identity}`;
  let loading = viewCache.get(cacheId);
  if (loading) {
    viewCache.delete(cacheId);
  } else {
    loading = loadArtifacts(view);
    loading.catch(() => viewCache.delete(cacheId));
  }
  viewCache.set(cacheId, loading);
  while (viewCache.size > VIEW_CACHE_MAX) {
    const oldest = viewCache.keys().next().value;
    if (oldest === undefined) break;
    viewCache.delete(oldest);
  }
  return loading;
}
