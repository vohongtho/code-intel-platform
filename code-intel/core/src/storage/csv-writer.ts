import fs from 'node:fs';
import path from 'node:path';
import type { CodeNode, CodeEdge } from '../shared/index.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { NODE_TABLE_MAP } from './schema.js';

export function writeNodeCSVs(graph: KnowledgeGraph, outputDir: string): Map<string, string> {
  fs.mkdirSync(outputDir, { recursive: true });
  const tableFiles = new Map<string, fs.WriteStream>();
  const tableFilePaths = new Map<string, string>();
  const header = 'id,name,file_path,start_line,end_line,exported,content,metadata\n';

  for (const node of graph.allNodes()) {
    const table = NODE_TABLE_MAP[node.kind];
    if (!tableFiles.has(table)) {
      const filePath = path.join(outputDir, `${table}.csv`);
      const stream = fs.createWriteStream(filePath);
      stream.write(header);
      tableFiles.set(table, stream);
      tableFilePaths.set(table, filePath);
    }

    const stream = tableFiles.get(table)!;
    stream.write(csvRow([
      node.id,
      node.name,
      node.filePath,
      String(node.startLine ?? ''),
      String(node.endLine ?? ''),
      String(node.exported ?? false),
      (node.content ?? '').slice(0, 1000),
      node.metadata ? JSON.stringify(node.metadata) : '',
    ]) + '\n');
  }

  for (const stream of tableFiles.values()) {
    stream.end();
  }

  return tableFilePaths;
}

export interface EdgeCSVGroup {
  fromTable: string;
  toTable: string;
  filePath: string;
}

export function writeEdgeCSV(graph: KnowledgeGraph, outputDir: string): EdgeCSVGroup[] {
  fs.mkdirSync(outputDir, { recursive: true });
  const groups = new Map<string, { stream: fs.WriteStream; filePath: string; from: string; to: string }>();
  const header = 'from_id,to_id,kind,weight,label\n';

  for (const edge of graph.allEdges()) {
    const sourceNode = graph.getNode(edge.source);
    const targetNode = graph.getNode(edge.target);
    if (!sourceNode || !targetNode) continue;

    const fromTable = NODE_TABLE_MAP[sourceNode.kind];
    const toTable = NODE_TABLE_MAP[targetNode.kind];
    const key = `${fromTable}->${toTable}`;

    if (!groups.has(key)) {
      const filePath = path.join(outputDir, `edges_${fromTable}_${toTable}.csv`);
      const stream = fs.createWriteStream(filePath);
      stream.write(header);
      groups.set(key, { stream, filePath, from: fromTable, to: toTable });
    }

    const group = groups.get(key)!;
    group.stream.write(csvRow([
      edge.source,
      edge.target,
      edge.kind,
      String(edge.weight ?? 1.0),
      edge.label ?? '',
    ]) + '\n');
  }

  const result: EdgeCSVGroup[] = [];
  for (const group of groups.values()) {
    group.stream.end();
    result.push({ fromTable: group.from, toTable: group.to, filePath: group.filePath });
  }

  return result;
}

function csvRow(fields: string[]): string {
  return fields.map((f) => {
    if (f.includes(',') || f.includes('"') || f.includes('\n')) {
      return '"' + f.replace(/"/g, '""') + '"';
    }
    return f;
  }).join(',');
}
