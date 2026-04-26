import { DbManager } from '../storage/db-manager.js';
import type { EmbeddedNode } from './embedder.js';

const EMBED_TABLE = 'embed_nodes';
const EMBED_DIM = 384; // all-MiniLM-L6-v2 output dimension
const INDEX_NAME = 'embed_vec_idx';

export class VectorIndex {
  private db: DbManager;

  constructor(db: DbManager) {
    this.db = db;
  }

  async init(): Promise<void> {
    // Install + load VECTOR extension
    await this.db.execute('INSTALL VECTOR');
    await this.db.execute('LOAD EXTENSION VECTOR');

    // Create node table for embeddings
    await this.db.execute(`
      CREATE NODE TABLE IF NOT EXISTS ${EMBED_TABLE} (
        id STRING,
        name STRING,
        kind STRING,
        file_path STRING,
        text STRING,
        embedding FLOAT[${EMBED_DIM}],
        PRIMARY KEY (id)
      )
    `);
  }

  async buildIndex(nodes: EmbeddedNode[]): Promise<void> {
    // Drop existing data
    await this.db.execute(`MATCH (n:${EMBED_TABLE}) DETACH DELETE n`).catch(() => {});

    // Insert embeddings
    for (const node of nodes) {
      const vecLiteral = `[${node.embedding.join(',')}]`;
      await this.db.execute(
        `CREATE (:${EMBED_TABLE} {
          id: '${esc(node.id)}',
          name: '${esc(node.name)}',
          kind: '${esc(node.kind)}',
          file_path: '${esc(node.filePath)}',
          text: '${esc(node.text)}',
          embedding: ${vecLiteral}
        })`,
      );
    }

    // Drop and recreate vector index (signature: tableName, indexName, propertyName)
    await this.db.execute(`CALL DROP_VECTOR_INDEX('${EMBED_TABLE}', '${INDEX_NAME}')`).catch(() => {});
    await this.db.execute(`CALL CREATE_VECTOR_INDEX('${EMBED_TABLE}', '${INDEX_NAME}', 'embedding')`);
    // Do NOT close the DB - keep connection open for searches
  }

  async search(queryEmbedding: number[], topK = 10): Promise<VectorHit[]> {
    const vecLiteral = `[${queryEmbedding.join(',')}]`;
    const rows = await this.db.query(
      `CALL QUERY_VECTOR_INDEX('${EMBED_TABLE}', '${INDEX_NAME}', ${vecLiteral}, ${topK}) RETURN node.id, node.name, node.kind, node.file_path, distance`,
    );
    return rows.map((r) => ({
      nodeId: String(r['node.id']),
      name: String(r['node.name']),
      kind: String(r['node.kind']),
      filePath: String(r['node.file_path']),
      score: 1 - Number(r['distance']),  // cosine distance → similarity
    }));
  }

  async isBuilt(): Promise<boolean> {
    try {
      const rows = await this.db.query(`MATCH (n:${EMBED_TABLE}) RETURN count(n) AS cnt`);
      return Number(rows[0]?.cnt ?? 0) > 0;
    } catch {
      return false;
    }
  }
}

export interface VectorHit {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  score: number;  // 0..1 where 1 = most similar
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}
