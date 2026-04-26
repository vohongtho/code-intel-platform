import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { DbManager } from './db-manager.js';
import { ALL_NODE_TABLES, getCreateNodeTableDDL, getCreateEdgeTableDDL, NODE_TABLE_MAP } from './schema.js';
import type { CodeNode } from '../shared/index.js';

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
      // Edge table with all pairs might fail, use simpler approach
    }
  }

  // Insert nodes via Cypher
  let nodeCount = 0;
  for (const node of graph.allNodes()) {
    const table = NODE_TABLE_MAP[node.kind];
    const props = buildNodeProps(node);
    try {
      await dbManager.execute(`CREATE (:${table} ${props})`);
      nodeCount++;
    } catch {
      // Skip duplicate or invalid nodes
    }
  }

  // Insert edges via Cypher
  let edgeCount = 0;
  for (const edge of graph.allEdges()) {
    const sourceNode = graph.getNode(edge.source);
    const targetNode = graph.getNode(edge.target);
    if (!sourceNode || !targetNode) continue;

    const fromTable = NODE_TABLE_MAP[sourceNode.kind];
    const toTable = NODE_TABLE_MAP[targetNode.kind];

    try {
      await dbManager.execute(
        `MATCH (a:${fromTable} {id: '${escCypher(edge.source)}'}), (b:${toTable} {id: '${escCypher(edge.target)}'}) ` +
        `CREATE (a)-[:code_edges {kind: '${edge.kind}', weight: ${edge.weight ?? 1.0}, label: '${escCypher(edge.label ?? '')}'}]->(b)`,
      );
      edgeCount++;
    } catch {
      // Skip invalid edges
    }
  }

  return { nodeCount, edgeCount };
}

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
