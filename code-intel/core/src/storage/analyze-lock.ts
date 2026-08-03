import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface AnalyzeLockOwner {
  version: 1;
  token: string;
  pid: number;
  hostname: string;
  startedAt: string;
  baseGenerationId?: string;
  stagingGenerationId?: string;
}

export interface AnalyzeLock {
  lockPath: string;
  owner: AnalyzeLockOwner;
  update(patch: Partial<Pick<AnalyzeLockOwner, 'baseGenerationId' | 'stagingGenerationId'>>): void;
  release(): void;
}

export class AnalysisAlreadyRunningError extends Error {
  constructor(public readonly existingOwner: AnalyzeLockOwner | null, lockPath: string) {
    const detail = existingOwner
      ? `PID ${existingOwner.pid} on ${existingOwner.hostname}, started ${existingOwner.startedAt}`
      : `lock file ${lockPath}`;
    super(`Analysis is already running for this repository (${detail})`);
    this.name = 'AnalysisAlreadyRunningError';
  }
}

export function getAnalyzeLockPath(repoDir: string): string {
  return path.join(path.resolve(repoDir), '.code-intel', 'analyze.lock');
}

export function readAnalyzeLockOwner(lockPath: string): AnalyzeLockOwner | null {
  try {
    const value = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as AnalyzeLockOwner;
    if (value.version !== 1 || !value.token || !Number.isInteger(value.pid) || !value.hostname || !value.startedAt) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function canRecoverStaleLock(
  lockPath: string,
  owner: AnalyzeLockOwner | null,
  staleAfterMs: number,
): boolean {
  const age = (() => {
    try {
      return Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  })();

  // Malformed locks are recoverable only after a conservative TTL.
  if (!owner) return age >= staleAfterMs;

  // A local process that is still alive always owns its lock, regardless of age.
  // Cross-host ownership cannot be verified safely and therefore fails closed.
  if (owner.hostname !== os.hostname()) return false;
  return !isProcessAlive(owner.pid);
}

function atomicRewrite(lockPath: string, owner: AnalyzeLockOwner): void {
  const tmp = `${lockPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(owner, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, lockPath);
}

export function acquireAnalyzeLock(
  repoDir: string,
  options: { staleAfterMs?: number; baseGenerationId?: string } = {},
): AnalyzeLock {
  const repositoryRoot = path.resolve(repoDir);
  if (!fs.existsSync(repositoryRoot) || !fs.statSync(repositoryRoot).isDirectory()) {
    throw new Error(`Cannot analyze missing repository directory: ${repositoryRoot}`);
  }
  const lockPath = getAnalyzeLockPath(repositoryRoot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const owner: AnalyzeLockOwner = {
      version: 1,
      token: crypto.randomUUID(),
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
      baseGenerationId: options.baseGenerationId,
    };
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
      return {
        lockPath,
        owner,
        update(patch) {
          const current = readAnalyzeLockOwner(lockPath);
          if (!current || current.token !== owner.token) return;
          Object.assign(owner, patch);
          atomicRewrite(lockPath, owner);
        },
        release() {
          const current = readAnalyzeLockOwner(lockPath);
          if (current?.token === owner.token) fs.rmSync(lockPath, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = readAnalyzeLockOwner(lockPath);
      if (attempt === 0 && canRecoverStaleLock(lockPath, existing, staleAfterMs)) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      throw new AnalysisAlreadyRunningError(existing, lockPath);
    }
  }
  throw new AnalysisAlreadyRunningError(readAnalyzeLockOwner(lockPath), lockPath);
}
