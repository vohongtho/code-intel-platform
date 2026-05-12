import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface RepoEntry {
  name: string;
  path: string;
  indexedAt: string;
  stats: { nodes: number; edges: number; files: number };
}

/**
 * Returns the global data directory at call time.
 * Respects the CODE_INTEL_HOME env var so tests can redirect to a temp dir
 * without touching the real ~/.code-intel/repos.json.
 */
function getGlobalDir(): string {
  return path.join(process.env['CODE_INTEL_HOME'] ?? os.homedir(), '.code-intel');
}

function getReposFile(): string {
  return path.join(getGlobalDir(), 'repos.json');
}

export function loadRegistry(): RepoEntry[] {
  try {
    const data = fs.readFileSync(getReposFile(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveRegistry(entries: RepoEntry[]): void {
  const globalDir = getGlobalDir();
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(getReposFile(), JSON.stringify(entries, null, 2));
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
