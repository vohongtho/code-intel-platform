import fs from 'node:fs';
import path from 'node:path';

export interface IndexMetadata {
  indexedAt: string;
  commitHash?: string;
  stats: {
    nodes: number;
    edges: number;
    files: number;
    duration: number;
  };
}

export function saveMetadata(repoDir: string, metadata: IndexMetadata): void {
  const metaDir = path.join(repoDir, '.code-intel');
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(path.join(metaDir, 'meta.json'), JSON.stringify(metadata, null, 2));
}

export function loadMetadata(repoDir: string): IndexMetadata | null {
  try {
    const data = fs.readFileSync(path.join(repoDir, '.code-intel', 'meta.json'), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function getDbPath(repoDir: string): string {
  return path.join(repoDir, '.code-intel', 'graph.db');
}

export function getVectorDbPath(repoDir: string): string {
  return path.join(repoDir, '.code-intel', 'vector.db');
}
