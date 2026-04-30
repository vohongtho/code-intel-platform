import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { DbManager } from './db-manager.js';
import { ALL_NODE_TABLES, getCreateNodeTableDDL, getCreateEdgeTableDDL, NODE_TABLE_MAP } from './schema.js';
import type { CodeNode } from '../shared/index.js';
import { writeNodeCSVs, writeEdgeCSV } from './csv-writer.js';

// ─── loadGraphToDB — bulk CSV COPY (fast path) ────────────────────────────────

/**
 * Load graph into DB using bulk CSV COPY — dramatically faster than
 * individual CREATE statements (10-100× speedup for large repos).
 *
 * Strategy:
 *  1. Create tables
 *  2. Write all nodes to per-table CSV files in a temp dir
 *  3. Write all edges to per-fromTable→toTable CSV files
 *  4. COPY each CSV file into the corresponding table
 *  5. Clean up temp dir
 *
 * Falls back to individual CREATE statements per table if COPY fails.
 */
export async function loadGraphToDB(
  graph: KnowledgeGraph,
  dbManager: DbManager,
): Promise<{ nodeCount: number; edgeCount: number }> {
  // Create all node tables
  for (const table of ALL_NODE_TABLES) {
    await dbManager.execute(getCreateNodeTableDDL(table));
  }

  // Create edge table
  const edgeDDLs = getCreateEdgeTableDDL();
  for (const ddl of edgeDDLs) {
    try {
      await dbManager.execute(ddl);
    } catch {
      // Edge table with all pairs might fail — ignore
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-csv-'));

  try {
    // ── Write CSVs (synchronous) ────────────────────────────────────────────
    const nodeTableFiles = writeNodeCSVs(graph, tmpDir);
    const edgeGroups = writeEdgeCSV(graph, tmpDir);

    // Pre-compute per-table node counts and per-group edge counts from the in-memory graph.
    const tableNodeCounts = new Map<string, number>();
    for (const node of graph.allNodes()) {
      const t = NODE_TABLE_MAP[node.kind];
      tableNodeCounts.set(t, (tableNodeCounts.get(t) ?? 0) + 1);
    }
    const edgeGroupCounts = new Map<string, number>();
    for (const edge of graph.allEdges()) {
      const src = graph.getNode(edge.source);
      const tgt = graph.getNode(edge.target);
      if (!src || !tgt) continue;
      const key = `${NODE_TABLE_MAP[src.kind]}->${NODE_TABLE_MAP[tgt.kind]}`;
      edgeGroupCounts.set(key, (edgeGroupCounts.get(key) ?? 0) + 1);
    }

    // ── COPY nodes ──────────────────────────────────────────────────────────
    // PARALLEL=FALSE is required because node `content` fields contain real source
    // code with embedded newlines, which the parallel CSV reader does not support.
    // Newlines are escaped to \n literals in the CSV (see csv-writer.ts) to prevent
    // LadybugDB's sequential reader from mis-parsing quoted multi-line fields.
    let nodeCount = 0;
    for (const [table, csvPath] of nodeTableFiles) {
      if (!fs.existsSync(csvPath)) continue;
      const stat = fs.statSync(csvPath);
      // Skip empty CSV files (only header line ≈ <50 bytes)
      if (stat.size < 50) continue;
      try {
        await dbManager.execute(
          `COPY ${table} FROM '${csvPath.replace(/\\/g, '/')}' (HEADER=TRUE, PARALLEL=FALSE)`,
        );
        nodeCount += tableNodeCounts.get(table) ?? 0;
      } catch {
        // Fall back to individual inserts for this table
        nodeCount += await loadTableFallback(graph, table, dbManager);
      }
    }

    // ── COPY edges ──────────────────────────────────────────────────────────
    let edgeCount = 0;
    for (const group of edgeGroups) {
      if (!fs.existsSync(group.filePath)) continue;
      const stat = fs.statSync(group.filePath);
      if (stat.size < 50) continue;
      try {
        await dbManager.execute(
          `COPY code_edges FROM '${group.filePath.replace(/\\/g, '/')}' (HEADER=TRUE, PARALLEL=FALSE, FROM='${group.fromTable}', TO='${group.toTable}')`,
        );
        edgeCount += edgeGroupCounts.get(`${group.fromTable}->${group.toTable}`) ?? 0;
      } catch {
        // Fall back to per-edge inserts for this group
        edgeCount += await loadEdgeGroupFallback(graph, group.fromTable, group.toTable, dbManager);
      }
    }

    return { nodeCount, edgeCount };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ─── Fallback helpers ─────────────────────────────────────────────────────────

async function loadTableFallback(
  graph: KnowledgeGraph,
  table: string,
  dbManager: DbManager,
): Promise<number> {
  let count = 0;
  for (const node of graph.allNodes()) {
    if (NODE_TABLE_MAP[node.kind] !== table) continue;
    const props = buildNodeProps(node);
    try {
      await dbManager.execute(`CREATE (:${table} ${props})`);
      count++;
    } catch { /* skip duplicate */ }
  }
  return count;
}

async function loadEdgeGroupFallback(
  graph: KnowledgeGraph,
  fromTable: string,
  toTable: string,
  dbManager: DbManager,
): Promise<number> {
  let count = 0;
  for (const edge of graph.allEdges()) {
    const sourceNode = graph.getNode(edge.source);
    const targetNode = graph.getNode(edge.target);
    if (!sourceNode || !targetNode) continue;
    if (NODE_TABLE_MAP[sourceNode.kind] !== fromTable) continue;
    if (NODE_TABLE_MAP[targetNode.kind] !== toTable) continue;
    try {
      await dbManager.execute(
        `MATCH (a:${fromTable} {id: '${escCypher(edge.source)}'}), (b:${toTable} {id: '${escCypher(edge.target)}'}) ` +
        `CREATE (a)-[:code_edges {kind: '${edge.kind}', weight: ${edge.weight ?? 1.0}, label: '${escCypher(edge.label ?? '')}'}]->(b)`,
      );
      count++;
    } catch { /* skip */ }
  }
  return count;
}

// ─── Upsert helpers (incremental indexing) ────────────────────────────────────

/**
 * Upsert a single node: DELETE existing node with same id then re-CREATE.
 * KùzuDB does not have MERGE, so we simulate it with DELETE + CREATE.
 */
export async function upsertNode(node: CodeNode, dbManager: DbManager): Promise<void> {
  const table = NODE_TABLE_MAP[node.kind];
  const props = buildNodeProps(node);
  try {
    await dbManager.execute(`MATCH (n:${table} {id: '${escCypher(node.id)}'}) DELETE n`);
  } catch { /* Node may not exist — ignore */ }
  try {
    await dbManager.execute(`CREATE (:${table} ${props})`);
  } catch { /* Skip on error */ }
}

/**
 * Upsert a batch of nodes (max 100 per transaction for performance).
 */
export async function upsertNodes(nodes: CodeNode[], dbManager: DbManager): Promise<number> {
  let count = 0;
  const BATCH = 100;
  for (let i = 0; i < nodes.length; i += BATCH) {
    const batch = nodes.slice(i, i + BATCH);
    await Promise.all(batch.map((n) => upsertNode(n, dbManager)));
    count += batch.length;
  }
  return count;
}

/**
 * Remove all nodes (and their edges) for a given file path.
 */
export async function removeNodesForFile(filePath: string, dbManager: DbManager): Promise<void> {
  const escaped = escCypher(filePath);
  for (const table of ALL_NODE_TABLES) {
    try {
      await dbManager.execute(
        `MATCH (n:${table}) WHERE n.file_path = '${escaped}' DETACH DELETE n`,
      );
    } catch { /* Table may not exist — ignore */ }
  }
}

/**
 * Remove all edges whose source or target node has the given file_path.
 */
export async function removeEdgesForFile(filePath: string, dbManager: DbManager): Promise<void> {
  const escaped = escCypher(filePath);
  try {
    await dbManager.execute(
      `MATCH (a)-[e:code_edges]->(b) WHERE a.file_path = '${escaped}' OR b.file_path = '${escaped}' DELETE e`,
    );
  } catch { /* Edges table may not exist — ignore */ }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function buildNodeProps(node: CodeNode): string {
  const parts: string[] = [
    `id: '${escCypher(node.id)}'`,
    `name: '${escCypher(node.name)}'`,
    `file_path: '${escCypher(node.filePath)}'`,
  ];
  if (node.startLine !== undefined) parts.push(`start_line: ${node.startLine}`);
  if (node.endLine !== undefined) parts.push(`end_line: ${node.endLine}`);
  if (node.exported !== undefined) parts.push(`exported: ${node.exported}`);
  if (node.content) parts.push(`content: '${escCypher(node.content.slice(0, 500))}'`);
  if (node.metadata) parts.push(`metadata: '${escCypher(JSON.stringify(node.metadata))}'`);
  return `{${parts.join(', ')}}`;
}

function escCypher(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}
