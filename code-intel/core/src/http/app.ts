import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { textSearch } from '../search/text-search.js';
import { findEntryPoints, traceFlow } from '../flow-detection/entry-point-finder.js';
import { DbManager, getDbPath, getVectorDbPath } from '../storage/index.js';
import { VectorIndex } from '../search/vector-index.js';
import fs from 'node:fs';
import os from 'node:os';
import { listGroups, loadGroup, loadSyncResult, saveSyncResult } from '../multi-repo/group-registry.js';
import { syncGroup } from '../multi-repo/group-sync.js';
import { queryGroup } from '../multi-repo/group-query.js';
import { createKnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadGraphFromDB } from '../multi-repo/graph-from-db.js';
import { loadRegistry } from '../storage/repo-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve web dist: <core>/dist/http -> ../../web/dist
const WEB_DIST = path.resolve(__dirname, '..', '..', '..', 'web', 'dist');

export function createApp(graph: KnowledgeGraph, repoName: string, workspaceRoot?: string): express.Application {
  const app = express();

  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '10mb' }));

  // Lazy-init vector index state
  let vectorIndex: VectorIndex | null = null;
  let vectorIndexBuilding = false;
  let vectorIndexReady = false;

  async function ensureVectorIndex(): Promise<VectorIndex | null> {
    if (vectorIndexReady && vectorIndex) return vectorIndex;
    if (!workspaceRoot || vectorIndexBuilding) return null;
    vectorIndexBuilding = true;
    try {
      const { embedNodes } = await import('../search/embedder.js');
      const dbPath = getVectorDbPath(workspaceRoot);
      const db = new DbManager(dbPath);
      await db.init();
      const idx = new VectorIndex(db);
      await idx.init();
      const alreadyBuilt = await idx.isBuilt();
      if (!alreadyBuilt) {
        console.log('  [vector] Building embeddings…');
        const nodes = await embedNodes(graph, {
          onProgress: (done, total) => {
            if (done % 50 === 0 || done === total) process.stdout.write(`\r  [vector] ${done}/${total}`);
          },
        });
        console.log('');
        await idx.buildIndex(nodes);
        console.log(`  [vector] Index built: ${nodes.length} embeddings`);
      } else {
        console.log('  [vector] Index already exists, skipping rebuild.');
      }
      vectorIndex = idx;
      vectorIndexReady = true;
      return idx;
    } catch (err) {
      console.warn('  [vector] Index build failed:', err instanceof Error ? err.message : err);
      return null;
    } finally {
      vectorIndexBuilding = false;
    }
  }

  // Kick off in background when workspace is available
  if (workspaceRoot) {
    setImmediate(() => ensureVectorIndex().catch(() => {}));
  }

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', nodes: graph.size.nodes, edges: graph.size.edges });
  });

  // List ALL indexed repos from the global registry (not just the current one)
  app.get('/api/repos', (_req, res) => {
    const registry = loadRegistry();
    if (registry.length === 0) {
      // Fallback: return only the in-memory repo
      res.json([{ name: repoName, path: workspaceRoot ?? '', nodes: graph.size.nodes, edges: graph.size.edges, indexedAt: null }]);
      return;
    }
    res.json(registry.map((r) => ({
      name: r.name,
      path: r.path,
      nodes: r.stats.nodes,
      edges: r.stats.edges,
      indexedAt: r.indexedAt,
      active: r.path === workspaceRoot,
    })));
  });

  // Helper: load graph for a repo by name from its DB (returns in-memory graph if it matches)
  async function loadRepoGraph(requestedRepo: string): Promise<KnowledgeGraph | null> {
    // If the requested repo is the currently loaded in-memory graph, return it directly
    if (requestedRepo === repoName) return graph;

    // Otherwise look up in the global registry and load from DB
    const registry = loadRegistry();
    const entry = registry.find((r) => r.name === requestedRepo || r.path === requestedRepo);
    if (!entry) return null;

    const dbPath = path.join(entry.path, '.code-intel', 'graph.db');
    if (!fs.existsSync(dbPath)) return null;

    const repoGraph = createKnowledgeGraph();
    const db = new DbManager(dbPath);
    try {
      await db.init();
      await loadGraphFromDB(repoGraph, db);
      db.close();
      return repoGraph;
    } catch {
      db.close();
      return null;
    }
  }

  // Download full graph — supports any registered repo by name
  app.get('/api/graph/:repo', async (req, res) => {
    const requestedRepo = decodeURIComponent(req.params.repo);
    const g = await loadRepoGraph(requestedRepo);
    if (!g) {
      res.status(404).json({ error: `Repo "${requestedRepo}" not found or not indexed. Run: code-intel analyze <path>` });
      return;
    }
    const nodes = [...g.allNodes()];
    const edges = [...g.allEdges()];
    res.json({ nodes, edges });
  });

  // Helper: resolve graph for a repo (in-memory if matches, else load from DB)
  async function getGraphForRepo(requestedRepo: string | undefined): Promise<KnowledgeGraph> {
    if (!requestedRepo || requestedRepo === repoName) return graph;
    const g = await loadRepoGraph(requestedRepo);
    return g ?? graph; // fallback to in-memory
  }

  // Hybrid search (BM25-like text) — repo-aware
  app.post('/api/search', async (req, res) => {
    const { query, limit, repo } = req.body;
    const g = await getGraphForRepo(repo as string | undefined);
    const results = textSearch(g, query, limit ?? 20);
    res.json({ results });
  });

  // Vector search (semantic)
  app.post('/api/vector-search', async (req, res) => {
    const { query, limit = 10 } = req.body;
    if (!query) { res.status(400).json({ error: 'Missing query' }); return; }

    const idx = await ensureVectorIndex();
    if (!idx) {
      // Fall back to text search
      const results = textSearch(graph, query, limit);
      res.json({ results, source: 'text-fallback', vectorReady: false });
      return;
    }

    try {
      // Embed the query using @huggingface/transformers
      const { pipeline } = await import('@huggingface/transformers');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const embedder = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as unknown as (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;
      const out = await embedder(query, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(out.data);
      const hits = await idx.search(queryEmbedding, limit);
      // Map to SearchResult shape
      const results = hits.map((h) => ({
        nodeId: h.nodeId,
        name: h.name,
        kind: h.kind,
        filePath: h.filePath,
        score: h.score,
      }));
      res.json({ results, source: 'vector', vectorReady: true });
    } catch (err) {
      const results = textSearch(graph, query, limit);
      res.json({ results, source: 'text-fallback', vectorReady: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Vector index status
  app.get('/api/vector-status', (_req, res) => {
    res.json({ ready: vectorIndexReady, building: vectorIndexBuilding });
  });

  // Read file
  app.post('/api/files/read', (req, res) => {
    const { file_path } = req.body;
    try {
      const content = fs.readFileSync(file_path, 'utf-8');
      res.json({ content });
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Grep (regex search in files)
  app.post('/api/grep', (req, res) => {
    const { pattern, file_paths } = req.body;
    const results: { file: string; line: number; text: string }[] = [];

    try {
      const regex = new RegExp(pattern, 'gi');
      const paths: string[] = file_paths ?? [];

      // If no paths, search from graph nodes
      if (paths.length === 0) {
        for (const node of graph.allNodes()) {
          if (node.kind === 'file' && node.content) {
            const lines = node.content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push({ file: node.filePath, line: i + 1, text: lines[i].trim() });
              }
              regex.lastIndex = 0;
            }
          }
        }
      }

      res.json({ results: results.slice(0, 100) });
    } catch {
      res.status(400).json({ error: 'Invalid regex pattern' });
    }
  });

  // Cypher query — routed to LadybugDB if available, else falls back to in-memory
  app.post('/api/cypher', async (req, res) => {
    const { query: q } = req.body;
    if (!q) { res.status(400).json({ error: 'Missing query' }); return; }

    // Try LadybugDB first
    if (workspaceRoot) {
      try {
        const dbPath = getDbPath(workspaceRoot);
        const dbm = new DbManager(dbPath);
        await dbm.init();
        const rows = await dbm.query(q);
        dbm.close();
        res.json({ results: rows });
        return;
      } catch (err) {
        // Fall through to in-memory fallback
      }
    }

    // In-memory fallback
    try {
      const nameMatch = q?.match(/name\s*=\s*['"]([^'"]+)['"]/i);
      if (nameMatch) {
        const name = nameMatch[1];
        const results = [];
        for (const node of graph.allNodes()) {
          if (node.name === name) {
            const incoming = [...graph.findEdgesTo(node.id)];
            const outgoing = [...graph.findEdgesFrom(node.id)];
            results.push({ node, incoming: incoming.length, outgoing: outgoing.length });
          }
        }
        res.json({ results });
        return;
      }
      const kindMatch = q?.match(/:\s*(\w+)/);
      if (kindMatch) {
        const kind = kindMatch[1];
        const results = [];
        for (const node of graph.allNodes()) {
          if (node.kind === kind) results.push(node);
          if (results.length >= 50) break;
        }
        res.json({ results });
        return;
      }
      res.json({ results: [], message: 'Query not recognized.' });
    } catch {
      res.status(400).json({ error: 'Invalid query' });
    }
  });

  // Get node detail (inspect) — repo-aware via ?repo= query param
  app.get('/api/nodes/:id', async (req, res) => {
    const nodeId = decodeURIComponent(req.params.id);
    const g = await getGraphForRepo(req.query.repo as string | undefined);
    const node = g.getNode(nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    const incoming = [...g.findEdgesTo(nodeId)];
    const outgoing = [...g.findEdgesFrom(nodeId)];

    res.json({
      node,
      callers: incoming.filter((e) => e.kind === 'calls').map((e) => ({
        id: e.source,
        name: g.getNode(e.source)?.name,
        weight: e.weight,
      })),
      callees: outgoing.filter((e) => e.kind === 'calls').map((e) => ({
        id: e.target,
        name: g.getNode(e.target)?.name,
        weight: e.weight,
      })),
      imports: outgoing.filter((e) => e.kind === 'imports').map((e) => ({
        id: e.target,
        name: g.getNode(e.target)?.name,
      })),
      importedBy: incoming.filter((e) => e.kind === 'imports').map((e) => ({
        id: e.source,
        name: g.getNode(e.source)?.name,
      })),
      extends: outgoing.filter((e) => e.kind === 'extends').map((e) => ({
        id: e.target,
        name: g.getNode(e.target)?.name,
      })),
      implementsEdges: outgoing.filter((e) => e.kind === 'implements').map((e) => ({
        id: e.target,
        name: g.getNode(e.target)?.name,
      })),
      members: outgoing.filter((e) => e.kind === 'has_member').map((e) => ({
        id: e.target,
        name: g.getNode(e.target)?.name,
        kind: g.getNode(e.target)?.kind,
      })),
      cluster: incoming.filter((e) => e.kind === 'belongs_to').map((e) => g.getNode(e.target)?.name)[0],
    });
  });

  // Blast radius — repo-aware
  app.post('/api/blast-radius', async (req, res) => {
    const { target, direction = 'both', max_hops = 5, repo } = req.body;
    const g = await getGraphForRepo(repo as string | undefined);

    let targetNode = null;
    for (const node of g.allNodes()) {
      if (node.name === target || node.id === target) { targetNode = node; break; }
    }

    if (!targetNode) {
      res.status(404).json({ error: `Symbol "${target}" not found` });
      return;
    }

    const affected = new Map<string, { name: string; kind: string; depth: number }>();
    const queue: { id: string; depth: number }[] = [{ id: targetNode.id, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > max_hops) continue;
      visited.add(id);
      const node = g.getNode(id);
      if (node) affected.set(id, { name: node.name, kind: node.kind, depth });

      if (direction === 'callers' || direction === 'both') {
        for (const edge of g.findEdgesTo(id)) {
          if (edge.kind === 'calls' || edge.kind === 'imports') queue.push({ id: edge.source, depth: depth + 1 });
        }
      }
      if (direction === 'callees' || direction === 'both') {
        for (const edge of g.findEdgesFrom(id)) {
          if (edge.kind === 'calls' || edge.kind === 'imports') queue.push({ id: edge.target, depth: depth + 1 });
        }
      }
    }

    res.json({
      target: targetNode.name,
      affectedCount: [...affected.values()].filter((a) => a.depth > 0).length,
      affected: [...affected.entries()].map(([id, info]) => ({ id, ...info })).filter((a) => a.depth > 0),
    });
  });

  // Flows — repo-aware via ?repo=
  app.get('/api/flows', async (req, res) => {
    const g = await getGraphForRepo(req.query.repo as string | undefined);
    const flows: { id: string; name: string; steps: unknown }[] = [];
    for (const node of g.allNodes()) {
      if (node.kind === 'flow') flows.push({ id: node.id, name: node.name, steps: node.metadata?.steps });
    }
    res.json({ flows });
  });

  // Clusters — repo-aware via ?repo=
  app.get('/api/clusters', async (req, res) => {
    const g = await getGraphForRepo(req.query.repo as string | undefined);
    const clusters: { id: string; name: string; memberCount: number }[] = [];
    for (const node of g.allNodes()) {
      if (node.kind === 'cluster') {
        clusters.push({ id: node.id, name: node.name, memberCount: (node.metadata?.memberCount as number) ?? 0 });
      }
    }
    res.json({ clusters });
  });

  // ── Group routes ──────────────────────────────────────────────────────────────
  app.get('/api/groups', (_req, res) => {
    const groups = listGroups();
    res.json(groups.map((g) => ({
      name: g.name,
      memberCount: g.members.length,
      lastSync: g.lastSync ?? null,
      createdAt: g.createdAt,
    })));
  });

  app.get('/api/groups/:name', (req, res) => {
    const group = loadGroup(req.params.name);
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    res.json(group);
  });

  app.get('/api/groups/:name/contracts', (req, res) => {
    const result = loadSyncResult(req.params.name);
    if (!result) { res.status(404).json({ error: 'No sync result. Run sync first.' }); return; }
    res.json(result);
  });

  app.post('/api/groups/:name/sync', async (req, res) => {
    const group = loadGroup(req.params.name);
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    try {
      const result = await syncGroup(group);
      saveSyncResult(result);
      // Update lastSync on group
      group.lastSync = result.syncedAt;
      const { saveGroup } = await import('../multi-repo/group-registry.js');
      saveGroup(group);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/groups/:name/search', async (req, res) => {
    const group = loadGroup(req.params.name);
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    const { q, limit = 20 } = req.body;
    if (!q) { res.status(400).json({ error: 'Missing query q' }); return; }
    try {
      const { perRepo, merged } = await queryGroup(group, q, limit);
      res.json({ perRepo, merged });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/groups/:name/graph', async (req, res) => {
    const group = loadGroup(req.params.name);
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    const registry = loadRegistry();
    const mergedGraph = createKnowledgeGraph();
    for (const member of group.members) {
      const regEntry = registry.find((r) => r.name === member.registryName);
      if (!regEntry) continue;
      const dbPath = path.join(regEntry.path, '.code-intel', 'graph.db');
      if (!fs.existsSync(dbPath)) continue;
      const db = new DbManager(dbPath);
      try {
        await db.init();
        await loadGraphFromDB(mergedGraph, db);
        db.close();
      } catch { db.close(); }
    }
    res.json({ nodes: [...mergedGraph.allNodes()], edges: [...mergedGraph.allEdges()] });
  });

  // Serve web UI static files
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  return app;
}

export function startHttpServer(
  graph: KnowledgeGraph,
  repoName: string,
  port = 4747,
  workspaceRoot?: string,
): void {
  const app = createApp(graph, repoName, workspaceRoot);
  app.listen(port, () => {
    console.log(`Code Intelligence server running at http://localhost:${port}`);
    console.log(`  Graph: ${graph.size.nodes} nodes, ${graph.size.edges} edges`);
  });
}
