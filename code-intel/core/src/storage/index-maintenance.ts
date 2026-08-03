import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_STALE_STAGING_MS,
  getGenerationsDir,
  getIndexDir,
  loadCurrentGenerationManifest,
  STAGING_OWNER_FILE,
  type StagingOwner,
} from './index-generation.js';
import {
  getAnalyzeLockPath,
  isProcessAlive,
  readAnalyzeLockOwner,
  type AnalyzeLockOwner,
} from './analyze-lock.js';
import { verifyIndexTrust } from './index-trust.js';

const LEGACY_ARTIFACTS = [
  'graph.db', 'graph.db-wal', 'graph.db-shm',
  'bm25.db', 'bm25.db-wal', 'bm25.db-shm',
  'vector.db', 'vector.db-wal', 'vector.db-shm',
  'meta.json',
] as const;

export interface IndexCleanupPlan {
  repositoryRoot: string;
  currentGenerationId?: string;
  keepGenerations: number;
  removeGenerations: string[];
  removeStaging: string[];
  removeLegacy: string[];
  preserved: string[];
}

function stagingActivityMs(stagingDir: string): number {
  let value = fs.statSync(stagingDir).mtimeMs;
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(stagingDir, STAGING_OWNER_FILE), 'utf8')) as StagingOwner;
    const parsed = Date.parse(owner.lastActivityAt || owner.createdAt);
    if (Number.isFinite(parsed)) value = parsed;
  } catch {
    // Fall back to directory mtime for malformed abandoned staging.
  }
  return value;
}

export function planIndexCleanup(
  repoDir: string,
  options: {
    keepGenerations?: number;
    staleStagingMs?: number;
    removeLegacy?: boolean;
    nowMs?: number;
  } = {},
): IndexCleanupPlan {
  const repositoryRoot = path.resolve(repoDir);
  const keepGenerations = Math.max(1, Math.floor(options.keepGenerations ?? 2));
  const staleStagingMs = options.staleStagingMs ?? DEFAULT_STALE_STAGING_MS;
  const nowMs = options.nowMs ?? Date.now();
  const currentGenerationId = loadCurrentGenerationManifest(repositoryRoot)?.generationId;
  const root = getGenerationsDir(repositoryRoot);
  const published: Array<{ name: string; mtimeMs: number }> = [];
  const removeStaging: string[] = [];

  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(root, entry.name);
      if (entry.name.startsWith('.staging-')) {
        if (nowMs - stagingActivityMs(entryPath) >= staleStagingMs) removeStaging.push(entry.name);
        continue;
      }
      published.push({ name: entry.name, mtimeMs: fs.statSync(entryPath).mtimeMs });
    }
  }

  published.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const retained = new Set(published.slice(0, keepGenerations).map((item) => item.name));
  if (currentGenerationId) retained.add(currentGenerationId);
  const removeGenerations = published
    .filter((item) => !retained.has(item.name))
    .map((item) => item.name);

  const removeLegacy: string[] = [];
  if (options.removeLegacy) {
    const trust = verifyIndexTrust(repositoryRoot);
    if (!currentGenerationId || !trust.trusted) {
      throw new Error('Legacy artifacts can be removed only when a trusted published generation is active');
    }
    const indexDir = getIndexDir(repositoryRoot);
    for (const name of LEGACY_ARTIFACTS) {
      if (fs.existsSync(path.join(indexDir, name))) removeLegacy.push(name);
    }
  }

  return {
    repositoryRoot,
    currentGenerationId,
    keepGenerations,
    removeGenerations,
    removeStaging,
    removeLegacy,
    preserved: published.filter((item) => retained.has(item.name)).map((item) => item.name),
  };
}

export function applyIndexCleanup(plan: IndexCleanupPlan): void {
  const generationsDir = getGenerationsDir(plan.repositoryRoot);
  for (const name of [...plan.removeGenerations, ...plan.removeStaging]) {
    const target = path.resolve(generationsDir, name);
    if (path.dirname(target) !== path.resolve(generationsDir)) {
      throw new Error(`Refusing to remove path outside generation root: ${name}`);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  const indexDir = getIndexDir(plan.repositoryRoot);
  for (const name of plan.removeLegacy) {
    fs.rmSync(path.join(indexDir, name), { force: true });
  }
}

export interface AnalyzeUnlockPlan {
  repositoryRoot: string;
  lockPath: string;
  owner: AnalyzeLockOwner | null;
  exists: boolean;
  removable: boolean;
  reason: string;
}

export function planAnalyzeUnlock(repoDir: string, force = false): AnalyzeUnlockPlan {
  const repositoryRoot = path.resolve(repoDir);
  const lockPath = getAnalyzeLockPath(repositoryRoot);
  if (!fs.existsSync(lockPath)) {
    return { repositoryRoot, lockPath, owner: null, exists: false, removable: false, reason: 'lock not found' };
  }
  const owner = readAnalyzeLockOwner(lockPath);
  if (force) {
    return { repositoryRoot, lockPath, owner, exists: true, removable: true, reason: 'forced by user' };
  }
  if (!owner) {
    return { repositoryRoot, lockPath, owner, exists: true, removable: false, reason: 'malformed lock requires --force' };
  }
  if (owner.hostname !== os.hostname()) {
    return { repositoryRoot, lockPath, owner, exists: true, removable: false, reason: 'remote-host lock requires --force' };
  }
  const alive = isProcessAlive(owner.pid);
  return {
    repositoryRoot,
    lockPath,
    owner,
    exists: true,
    removable: !alive,
    reason: alive ? 'owner process is still running' : 'owner process is no longer running',
  };
}

export function applyAnalyzeUnlock(plan: AnalyzeUnlockPlan): void {
  if (!plan.exists) return;
  if (!plan.removable) throw new Error(`Analyze lock was not removed: ${plan.reason}`);
  fs.rmSync(plan.lockPath, { force: true });
}
