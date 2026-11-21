/**
 * privacy.ts — the `metadata-only` export transform.
 *
 * Never byte-edits a database. The transform loads the snapshot graph, builds a new
 * graph with source text removed, writes it to a fresh graph.db through the normal
 * writer, reopens it, and proves the result carries no content before packaging.
 * BM25 is rebuilt from the stripped graph (names, kinds and paths only, no
 * snippets), and evidence is copied with free-text detail columns cleared.
 *
 * Decision (task 13): BM25 is *rebuilt*, not omitted. A names-only lexical index
 * keeps symbol search working for metadata-only consumers while carrying no
 * source text; the manifest states this as `bm25Content: 'names-only'`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createKnowledgeGraph, type KnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadGraphFromDB, loadGraphSnapshotFromDbPath } from '../multi-repo/graph-from-db.js';
import { DbManager } from '../storage/db-manager.js';
import { loadGraphToDB } from '../storage/graph-loader.js';
import { Bm25Index } from '../search/bm25-index.js';
import { SqliteResolutionEvidenceStore } from '../evidence/store.js';
import { Database } from '../shared/sqlite.js';
import type { CodeEdge, CodeNode } from '../shared/index.js';

/** Bump when the set of stripped fields changes; recorded in the package manifest. */
export const METADATA_ONLY_TRANSFORM_VERSION = 1;

/**
 * Metadata keys that can carry source text (bodies, snippets, matched expressions,
 * doc comments, generated summaries). Stripped at any depth. Over-stripping only
 * loses optional detail; under-stripping would leak source the profile promised
 * to omit, so this errs wide.
 */
const SOURCE_TEXT_KEYS = new Set([
  'content', 'snippet', 'snippets', 'source', 'sourceText', 'expression', 'body', 'code', 'text',
  'doc', 'docs', 'docComment', 'docstring', 'comment', 'comments', 'summary', 'raw', 'template',
  'query', 'sql', 'excerpt', 'preview', 'signatureText',
]);

function stripValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (SOURCE_TEXT_KEYS.has(key)) continue;
      out[key] = stripValue(inner);
    }
    return out;
  }
  return value;
}

function stripMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const stripped = stripValue(metadata) as Record<string, unknown>;
  return Object.keys(stripped).length > 0 ? stripped : undefined;
}

export function stripNode(node: CodeNode): CodeNode {
  const out: CodeNode = { ...node };
  delete out.content;
  delete out.metadata;
  const strippedMeta = stripMetadata(node.metadata);
  return strippedMeta ? { ...out, metadata: strippedMeta as CodeNode['metadata'] } : out;
}

export function stripEdge(edge: CodeEdge): CodeEdge {
  const { metadata, ...rest } = edge;
  const strippedMeta = stripMetadata(metadata);
  return { ...rest, ...(strippedMeta ? { metadata: strippedMeta } : {}) };
}

export function stripSourceContent(graph: KnowledgeGraph): KnowledgeGraph {
  const out = createKnowledgeGraph();
  for (const node of graph.allNodes()) out.addNode(stripNode(node));
  for (const edge of graph.allEdges()) out.addEdge(stripEdge(edge));
  return out;
}

/** Returns a description of the first source-bearing field found, or null when the graph is clean. */
export function findSourceContent(graph: KnowledgeGraph): string | null {
  const scan = (value: unknown, where: string): string | null => {
    if (Array.isArray(value)) {
      for (const item of value) { const hit = scan(item, where); if (hit) return hit; }
      return null;
    }
    if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (SOURCE_TEXT_KEYS.has(key) && inner !== undefined && inner !== null && inner !== '') return `${where}.${key}`;
        const hit = scan(inner, `${where}.${key}`);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const node of graph.allNodes()) {
    if (node.content) return `node ${node.id}.content`;
    const hit = scan(node.metadata, `node ${node.id}.metadata`);
    if (hit) return hit;
  }
  for (const edge of graph.allEdges()) {
    const hit = scan(edge.metadata, `edge ${edge.id}.metadata`);
    if (hit) return hit;
  }
  return null;
}

/** True when a BM25 artifact stores no snippet text. */
export function bm25HasNoSnippets(bm25DbPath: string): boolean {
  const db = new Database(bm25DbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM bm25_nodemeta WHERE snippet IS NOT NULL AND snippet != ''").get() as { count: number } | undefined;
    return (row?.count ?? 0) === 0;
  } finally {
    db.close();
  }
}

export interface MetadataOnlyArtifacts {
  graphDbPath: string;
  bm25DbPath: string;
  evidenceDbPath?: string;
  nodeCount: number;
  edgeCount: number;
  bm25DocCount: number;
}

/**
 * Writes metadata-only graph/BM25/evidence artifacts derived from `sourceDir`
 * into `outDir` (which must exist). Throws if read-back of the new graph does not
 * match the source counts or still carries source text.
 */
export async function writeMetadataOnlyArtifacts(sourceDir: string, outDir: string): Promise<MetadataOnlyArtifacts> {
  const source = await loadGraphSnapshotFromDbPath(path.join(sourceDir, 'graph.db'));
  const stripped = stripSourceContent(source);

  const graphDbPath = path.join(outDir, 'graph.db');
  const writer = new DbManager(graphDbPath);
  await writer.init();
  try {
    await loadGraphToDB(stripped, writer);
  } finally {
    writer.close();
  }

  const readBack = createKnowledgeGraph();
  const reader = new DbManager(graphDbPath, true);
  await reader.init();
  try {
    await loadGraphFromDB(readBack, reader);
  } finally {
    reader.close();
  }
  if (readBack.size.nodes !== source.size.nodes || readBack.size.edges !== source.size.edges) {
    throw new Error(`metadata-only graph read-back mismatch: ${readBack.size.nodes}/${readBack.size.edges} vs ${source.size.nodes}/${source.size.edges}`);
  }
  const leaked = findSourceContent(readBack);
  if (leaked) throw new Error(`metadata-only graph still carries source text (${leaked})`);

  const bm25DbPath = path.join(outDir, 'bm25.db');
  const { docCount } = new Bm25Index(bm25DbPath).build(stripped);
  checkpointToSingleFile(bm25DbPath);
  if (!bm25HasNoSnippets(bm25DbPath)) throw new Error('metadata-only BM25 still carries snippets');

  let evidenceDbPath: string | undefined;
  const sourceEvidence = path.join(sourceDir, 'evidence.db');
  if (fs.existsSync(sourceEvidence)) {
    evidenceDbPath = path.join(outDir, 'evidence.db');
    // Create the schema through the store itself so it can never drift from the reader.
    new SqliteResolutionEvidenceStore(evidenceDbPath).close();
    const db = new Database(evidenceDbPath);
    try {
      db.prepare('ATTACH DATABASE ? AS src').run(sourceEvidence);
      db.exec(`
        INSERT INTO resolution_evidence
          (id, version, referenceId, resolverVersion, strategy, confidence, certainty, coverageJson,
           boundariesJson, candidateIdsJson, rejectedCandidateReasonsJson, sourceJson, detailsJson, recordedAt)
        SELECT id, version, referenceId, resolverVersion, strategy, confidence, certainty, coverageJson,
           boundariesJson, candidateIdsJson, NULL, sourceJson, NULL, recordedAt
        FROM src.resolution_evidence ORDER BY id;
      `);
      db.exec('DETACH DATABASE src');
      db.exec('PRAGMA journal_mode = DELETE');
    } finally {
      db.close();
    }
  }

  return { graphDbPath, bm25DbPath, evidenceDbPath, nodeCount: readBack.size.nodes, edgeCount: readBack.size.edges, bm25DocCount: docCount };
}

/** Folds any WAL into the main file so the artifact is one self-contained file. */
export function checkpointToSingleFile(sqlitePath: string): void {
  const db = new Database(sqlitePath);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('PRAGMA journal_mode = DELETE');
  } finally {
    db.close();
  }
}
