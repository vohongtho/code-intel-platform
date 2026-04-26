import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface RepoEntry {
  name: string;
  path: string;
  indexedAt: string;
  stats: { nodes: number; edges: number; files: number };
}

const GLOBAL_DIR = path.join(os.homedir(), '.code-intel');
const REPOS_FILE = path.join(GLOBAL_DIR, 'repos.json');

export function loadRegistry(): RepoEntry[] {
  try {
    const data = fs.readFileSync(REPOS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveRegistry(entries: RepoEntry[]): void {
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  fs.writeFileSync(REPOS_FILE, JSON.stringify(entries, null, 2));
}

export function upsertRepo(entry: RepoEntry): void {
  const entries = loadRegistry();
  const idx = entries.findIndex((e) => e.path === entry.path);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  saveRegistry(entries);
}

export function removeRepo(repoPath: string): void {
  const entries = loadRegistry().filter((e) => e.path !== repoPath);
  saveRegistry(entries);
}
