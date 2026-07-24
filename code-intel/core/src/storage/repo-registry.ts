import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export interface RepoEntry {
  id: string;
  name: string;
  path: string;
  indexedAt: string;
  stats: { nodes: number; edges: number; files: number };
}

type LegacyRepoEntry = Omit<RepoEntry, 'id'> & { id?: string };

const GLOBAL_DIR = path.join(os.homedir(), '.code-intel');
const REPOS_FILE = path.join(GLOBAL_DIR, 'repos.json');

function readRegistryFile(): LegacyRepoEntry[] {
  try {
    const data = fs.readFileSync(REPOS_FILE, 'utf-8');
    const parsed = JSON.parse(data) as unknown;
    return Array.isArray(parsed) ? parsed as LegacyRepoEntry[] : [];
  } catch {
    return [];
  }
}

function normalizeRepoName(name: string): string {
  return name.trim();
}

function repairDuplicateNames(entries: RepoEntry[]): { entries: RepoEntry[]; warnings: string[] } {
  const byName = new Map<string, RepoEntry[]>();
  for (const entry of entries) {
    const arr = byName.get(entry.name) ?? [];
    arr.push(entry);
    byName.set(entry.name, arr);
  }

  const warnings: string[] = [];
  for (const [name, dupes] of byName) {
    if (dupes.length <= 1) continue;
    dupes.sort((a, b) => a.path.localeCompare(b.path));
    dupes.forEach((entry, idx) => {
      if (idx === 0) return;
      const repaired = `${name}-${idx + 1}`;
      warnings.push(`Repaired duplicate repo name "${name}" for path ${entry.path} → "${repaired}"`);
      entry.name = repaired;
    });
  }

  return { entries, warnings };
}

function migrateRegistry(entries: LegacyRepoEntry[]): { entries: RepoEntry[]; changed: boolean; warnings: string[] } {
  let changed = false;
  const migrated = entries.map((entry) => {
    const name = normalizeRepoName(entry.name || path.basename(entry.path || 'repo'));
    const next: RepoEntry = {
      id: entry.id && entry.id.trim() ? entry.id : randomUUID(),
      name,
      path: path.resolve(entry.path),
      indexedAt: entry.indexedAt,
      stats: entry.stats,
    };
    if (!entry.id || entry.name !== name || entry.path !== next.path) changed = true;
    return next;
  });
  const repaired = repairDuplicateNames(migrated);
  if (repaired.warnings.length > 0) changed = true;
  return { entries: repaired.entries, changed, warnings: repaired.warnings };
}

function validateRegistry(entries: RepoEntry[], ignoreId?: string): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const name = normalizeRepoName(entry.name);
    if (!name) throw new Error('Repository name cannot be empty');
    if (ignoreId && entry.id === ignoreId) continue;
    const existingId = seen.get(name);
    if (existingId && existingId !== entry.id) {
      throw new Error(`Repository name "${name}" already exists`);
    }
    seen.set(name, entry.id);
  }
}

export function loadRegistry(): RepoEntry[] {
  const raw = readRegistryFile();
  const { entries, changed, warnings } = migrateRegistry(raw);
  if (changed) {
    saveRegistry(entries);
    for (const warning of warnings) console.warn(`  ⚠  ${warning}`);
  }
  return entries;
}

export function saveRegistry(entries: RepoEntry[]): void {
  validateRegistry(entries);
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  fs.writeFileSync(REPOS_FILE, JSON.stringify(entries, null, 2));
}

export function findRepoById(id: string, entries = loadRegistry()): RepoEntry | undefined {
  return entries.find((e) => e.id === id);
}

export function findRepoByName(name: string, entries = loadRegistry()): RepoEntry | undefined {
  return entries.find((e) => e.name === name);
}

export function findRepoByPath(repoPath: string, entries = loadRegistry()): RepoEntry | undefined {
  const resolved = path.resolve(repoPath);
  return entries.find((e) => path.resolve(e.path) === resolved);
}

export function findRepo(identifier: string, entries = loadRegistry()): RepoEntry | undefined {
  return findRepoById(identifier, entries) ?? findRepoByName(identifier, entries) ?? findRepoByPath(identifier, entries);
}

export function upsertRepo(entry: RepoEntry | Omit<RepoEntry, 'id'> & { id?: string }): RepoEntry {
  const entries = loadRegistry();
  const normalizedName = normalizeRepoName(entry.name);
  const normalizedPath = path.resolve(entry.path);
  const existingById = entry.id ? findRepoById(entry.id, entries) : undefined;
  const existingByPath = findRepoByPath(normalizedPath, entries);
  const existing = existingById ?? existingByPath;
  const next: RepoEntry = {
    id: existing?.id ?? entry.id ?? randomUUID(),
    name: normalizedName,
    path: normalizedPath,
    indexedAt: entry.indexedAt,
    stats: entry.stats,
  };

  const conflictingByName = entries.find((e) => e.name === normalizedName && e.id !== next.id);
  if (conflictingByName) throw new Error(`Repository name "${normalizedName}" already exists`);

  const idx = entries.findIndex((e) => e.id === next.id || e.path === normalizedPath);
  if (idx >= 0) entries[idx] = next;
  else entries.push(next);
  saveRegistry(entries);
  return next;
}

export function renameRepo(currentName: string, newName: string): RepoEntry {
  const entries = loadRegistry();
  const existing = findRepoByName(currentName, entries);
  if (!existing) throw new Error(`Repository "${currentName}" not found`);
  const normalizedName = normalizeRepoName(newName);
  if (existing.name === normalizedName) return existing;
  if (findRepoByName(normalizedName, entries)) throw new Error(`Repository name "${normalizedName}" already exists`);
  const updated = { ...existing, name: normalizedName };
  const idx = entries.findIndex((e) => e.id === existing.id);
  entries[idx] = updated;
  saveRegistry(entries);
  return updated;
}

export function relinkRepo(name: string, newPath: string): RepoEntry {
  const entries = loadRegistry();
  const existing = findRepoByName(name, entries);
  if (!existing) throw new Error(`Repository "${name}" not found`);
  const normalizedPath = path.resolve(newPath);
  const conflicting = entries.find((e) => e.path === normalizedPath && e.id !== existing.id);
  if (conflicting) throw new Error(`Path "${normalizedPath}" is already linked to repository "${conflicting.name}"`);
  const updated = { ...existing, path: normalizedPath };
  const idx = entries.findIndex((e) => e.id === existing.id);
  entries[idx] = updated;
  saveRegistry(entries);
  return updated;
}

export function removeRepo(repoPathOrId: string): void {
  const resolvedPath = path.resolve(repoPathOrId);
  const entries = loadRegistry().filter((e) => e.id !== repoPathOrId && path.resolve(e.path) !== resolvedPath);
  saveRegistry(entries);
}
