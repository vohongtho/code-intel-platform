/**
 * graph-from-db.ts
 * Loads a KnowledgeGraph from a persisted LadybugDB graph.db.
 * Used by group-sync to read each repo's index without re-analyzing.
 */
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { DbManager } from '../storage/db-manager.js';
import { ALL_NODE_TABLES, NODE_TABLE_MAP } from '../storage/schema.js';
import type { CodeNode, CodeEdge, NodeKind, EdgeKind } from '../shared/index.js';

// Reverse map: tableName → NodeKind
const TABLE_TO_KIND: Record<string, NodeKind> = Object.fromEntries(
  Object.entries(NODE_TABLE_MAP).map(([kind, table]) => [table, kind as NodeKind]),
);

function parseRow(row: Record<string, unknown>, kind: NodeKind): CodeNode {
  return {
    id: String(row['id'] ?? ''),
    kind,
    name: String(row['name'] ?? ''),
    filePath: String(row['file_path'] ?? ''),
    startLine: row['start_line'] != null ? Number(row['start_line']) : undefined,
    endLine: row['end_line'] != null ? Number(row['end_line']) : undefined,
    exported: row['exported'] != null ? Boolean(row['exported']) : undefined,
    content: row['content'] ? String(row['content']) : undefined,
    metadata: row['metadata'] ? (() => {
      try { return JSON.parse(String(row['metadata'])) as Record<string, unknown>; } catch { return undefined; }
    })() : undefined,
  };
}

export async function loadGraphFromDB(
  graph: KnowledgeGraph,
  db: DbManager,
): Promise<void> {
  // Load all node tables
  for (const table of ALL_NODE_TABLES) {
    const kind = TABLE_TO_KIND[table];
    if (!kind) continue;
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await db.query(`MATCH (n:${table}) RETURN n.id, n.name, n.file_path, n.start_line, n.end_line, n.exported, n.content, n.metadata`);
    } catch {
      // table may not exist in older DBs
      continue;
    }
    for (const row of rows) {
      // kuzu returns column names as aliases
      const node = parseRow({
        id: row['n.id'],
        name: row['n.name'],
        file_path: row['n.file_path'],
        start_line: row['n.start_line'],
        end_line: row['n.end_line'],
        exported: row['n.exported'],
        content: row['n.content'],
        metadata: row['n.metadata'],
      }, kind);
      if (node.id && node.name) graph.addNode(node);
    }
  }

  // Load edges
  try {
    const edgeRows = await db.query(
      `MATCH (a)-[e:code_edges]->(b) RETURN a.id, b.id, e.kind, e.weight, e.label`,
    );
    for (const row of edgeRows) {
      const sourceId = String(row['a.id'] ?? '');
      const targetId = String(row['b.id'] ?? '');
      const kind = String(row['e.kind'] ?? '') as EdgeKind;
      if (!sourceId || !targetId || !kind) continue;
      const edge: CodeEdge = {
        id: `${sourceId}::${kind}::${targetId}`,
        source: sourceId,
        target: targetId,
        kind,
        weight: row['e.weight'] != null ? Number(row['e.weight']) : undefined,
        label: row['e.label'] ? String(row['e.label']) : undefined,
      };
      graph.addEdge(edge);
    }
  } catch {
    // edges table may not exist in older DBs
  }
}
