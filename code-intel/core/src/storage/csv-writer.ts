import fs from 'node:fs';
import path from 'node:path';
import type { CodeNode, CodeEdge } from '../shared/index.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { NODE_TABLE_MAP } from './schema.js';

/**
 * Write per-node-table CSV files synchronously.
 * Returns a Map of tableName → absolute file path.
 *
 * Content and metadata fields have actual newlines escaped to the 2-char
 * sequence `\n` (backslash + n) before writing.  This avoids LadybugDB's
 * PARALLEL=FALSE CSV reader bug where quoted fields spanning multiple lines
 * are mis-parsed when they contain no `""` escapes — causing "expected N
 * values per row, but got N-1" errors for code with embedded newlines.
 */
export function writeNodeCSVs(graph: KnowledgeGraph, outputDir: string): Map<string, string> {
  fs.mkdirSync(outputDir, { recursive: true });

  const header = 'id,name,file_path,start_line,end_line,exported,content,metadata\n';
  const tableBuffers = new Map<string, string[]>();
  const tableFilePaths = new Map<string, string>();

  for (const node of graph.allNodes()) {
    const table = NODE_TABLE_MAP[node.kind];
    if (!tableBuffers.has(table)) {
      tableBuffers.set(table, [header]);
      tableFilePaths.set(table, path.join(outputDir, `${table}.csv`));
    }
    tableBuffers.get(table)!.push(
      csvRow([
        node.id,
        node.name,
        node.filePath,
        String(node.startLine ?? ''),
        String(node.endLine ?? ''),
        String(node.exported ?? false),
        // Escape embedded newlines so the CSV never contains multi-line
        // quoted fields.  LadybugDB PARALLEL=FALSE has a bug where it
        // mis-parses quoted fields with embedded newlines that contain no
        // internal "" sequences (treating them as truncated records).
        escapeNewlines((node.content ?? '').slice(0, 1000)),
        node.metadata ? escapeNewlines(JSON.stringify(node.metadata)) : '',
      ]) + '\n',
    );
  }

  for (const [table, lines] of tableBuffers) {
    fs.writeFileSync(tableFilePaths.get(table)!, lines.join(''), 'utf-8');
  }

  return tableFilePaths;
}

export interface EdgeCSVGroup {
  fromTable: string;
  toTable: string;
  filePath: string;
}

/**
 * Write per-edge-group CSV files synchronously.
 * Returns an array of EdgeCSVGroup descriptors.
 */
export function writeEdgeCSV(graph: KnowledgeGraph, outputDir: string): EdgeCSVGroup[] {
  fs.mkdirSync(outputDir, { recursive: true });

  const header = 'from_id,to_id,kind,weight,label\n';
  const groups = new Map<string, { lines: string[]; from: string; to: string; filePath: string }>();

  for (const edge of graph.allEdges()) {
    const sourceNode = graph.getNode(edge.source);
    const targetNode = graph.getNode(edge.target);
    if (!sourceNode || !targetNode) continue;

    const fromTable = NODE_TABLE_MAP[sourceNode.kind];
    const toTable = NODE_TABLE_MAP[targetNode.kind];
    const key = `${fromTable}->${toTable}`;

    if (!groups.has(key)) {
      const filePath = path.join(outputDir, `edges_${fromTable}_${toTable}.csv`);
      groups.set(key, { lines: [header], from: fromTable, to: toTable, filePath });
    }

    groups.get(key)!.lines.push(
      csvRow([
        edge.source,
        edge.target,
        edge.kind,
        String(edge.weight ?? 1.0),
        edge.label ?? '',
      ]) + '\n',
    );
  }

  const result: EdgeCSVGroup[] = [];
  for (const group of groups.values()) {
    fs.writeFileSync(group.filePath, group.lines.join(''), 'utf-8');
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

/**
 * Escape literal newlines (LF and CR) to the two-character sequences `\n`
 * and `\r`.  This prevents multi-line quoted CSV fields, which LadybugDB's
 * sequential CSV reader (PARALLEL=FALSE) mis-parses under certain conditions:
 * if a quoted field contains a raw newline but no `""` sequences the reader
 * occasionally treats the line break as a record separator and produces
 * "expected N values per row, but got N-1" errors.
 *
 * Callers that need to read the value back can unescape with:
 *   value.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
 */
function escapeNewlines(s: string): string {
  // Only do the work when actually needed — avoids churning the string
  // for the common case (short names, file paths, metadata without newlines).
  if (!s.includes('\n') && !s.includes('\r')) return s;
  return s.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}
