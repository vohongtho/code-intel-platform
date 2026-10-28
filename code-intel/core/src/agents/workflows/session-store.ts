/**
 * session-store.ts
 *
 * Durable storage for change-workflow sessions.
 *
 * - One JSON file per session (`<id>.json`) plus an optional hash-only
 *   baseline sidecar (`<id>.baseline.json`), both inside a managed directory.
 * - Writes are temp-file + rename, so a reader never sees a half-written file.
 * - Updates are revision compare-and-swap under a short-lived per-session
 *   lock file: a caller holding a stale revision gets `REVISION_CONFLICT`
 *   instead of overwriting a newer checkpoint.
 * - Reopened JSON is untrusted: size, schema version, ID, phase and list
 *   lengths are validated before anything uses it.
 * - Checkpoint/phase history is capped; old completed sessions are pruned.
 *
 * Storage roots (see `resolveRepoSessionRoot` / `resolveGroupSessionRoot`):
 * single-repo sessions live in the repository's own `.code-intel/` data
 * directory (already Git-ignored and owned by that repo's index); group
 * sessions live under the global `~/.code-intel/` root that already owns
 * group registry/sync state, so a group session has exactly one home rather
 * than a copy in every member repository.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CHANGE_WORKFLOW_PHASES,
  CHANGE_WORKFLOW_SCHEMA_VERSION,
  type ChangeWorkflowSession,
} from './session-types.js';

export const SESSION_ID_PATTERN = /^wf_[0-9a-f]{32}$/;
const GROUP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const SESSION_STORE_LIMITS = Object.freeze({
  maxSessionBytes: 2 * 1024 * 1024,
  maxBaselineBytes: 128 * 1024 * 1024,
  maxCheckpoints: 50,
  maxPhaseHistory: 100,
  maxPlanSteps: 500,
  maxTargets: 500,
  maxConditions: 2000,
  maxSessions: 200,
  maxActiveSessionsPerOwner: 20,
  completedRetentionMs: 30 * 24 * 60 * 60 * 1000,
  lockStaleMs: 30_000,
  lockWaitMs: 5_000,
});

export type WorkflowSessionErrorCode =
  | 'INVALID_ID'
  | 'NOT_FOUND'
  | 'CORRUPT'
  | 'OVERSIZE'
  | 'UNSUPPORTED_SCHEMA'
  | 'REVISION_CONFLICT'
  | 'LOCKED'
  | 'INVALID_TRANSITION'
  | 'INVALID_REQUEST'
  | 'INDEX_NOT_READY'
  | 'QUOTA_EXCEEDED';

export class WorkflowSessionError extends Error {
  constructor(
    public readonly code: WorkflowSessionErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'WorkflowSessionError';
  }
}

export function newSessionId(): string {
  return `wf_${crypto.randomBytes(16).toString('hex')}`;
}

export function resolveRepoSessionRoot(repoDir: string): string {
  return path.join(path.resolve(repoDir), '.code-intel', 'workflows', 'sessions');
}

export function resolveGroupSessionRoot(groupName: string, homeDir: string = os.homedir()): string {
  if (!GROUP_NAME_PATTERN.test(groupName)) {
    throw new WorkflowSessionError('INVALID_REQUEST', `Invalid group name for a workflow session: ${JSON.stringify(groupName)}`);
  }
  return path.join(homeDir, '.code-intel', 'workflows', 'groups', groupName, 'sessions');
}

function assertSessionId(id: string): void {
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new WorkflowSessionError('INVALID_ID', 'Session IDs have the form wf_<32 hex chars>.');
  }
}

function atomicWrite(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, content, { mode: 0o600 });
    fs.renameSync(temp, filePath);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedArray(value: unknown, max: number, field: string): unknown[] {
  if (!Array.isArray(value)) throw new WorkflowSessionError('CORRUPT', `session field '${field}' is not an array`);
  if (value.length > max) throw new WorkflowSessionError('OVERSIZE', `session field '${field}' exceeds ${max} entries`);
  return value;
}

/**
 * Structural validation of a reopened session. Rejects anything that is not
 * a schema-v1 session with the expected ID, a known phase and bounded lists.
 * Field-level content is otherwise treated as opaque data.
 */
export function validateSessionShape(value: unknown, expectedId?: string): ChangeWorkflowSession {
  if (!isRecord(value)) throw new WorkflowSessionError('CORRUPT', 'session is not a JSON object');
  if (value['schemaVersion'] !== CHANGE_WORKFLOW_SCHEMA_VERSION) {
    throw new WorkflowSessionError('UNSUPPORTED_SCHEMA', `unsupported session schemaVersion ${JSON.stringify(value['schemaVersion'])}`, {
      schemaVersion: value['schemaVersion'],
    });
  }
  const id = value['id'];
  if (typeof id !== 'string' || !SESSION_ID_PATTERN.test(id)) throw new WorkflowSessionError('CORRUPT', 'session id is missing or malformed');
  if (expectedId && id !== expectedId) throw new WorkflowSessionError('CORRUPT', 'session id does not match its file name');
  const revision = value['revision'];
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new WorkflowSessionError('CORRUPT', 'session revision is invalid');
  if (!CHANGE_WORKFLOW_PHASES.includes(value['phase'] as never)) throw new WorkflowSessionError('CORRUPT', 'session phase is unknown');
  for (const field of ['createdAt', 'updatedAt', 'taskFingerprint'] as const) {
    if (typeof value[field] !== 'string') throw new WorkflowSessionError('CORRUPT', `session field '${field}' is missing`);
  }
  const scope = value['scope'];
  if (!isRecord(scope) || (scope['type'] !== 'repo' && scope['type'] !== 'group')) {
    throw new WorkflowSessionError('CORRUPT', 'session scope is invalid');
  }
  boundedArray(value['baselines'], 64, 'baselines');
  boundedArray(value['selectedTargets'], SESSION_STORE_LIMITS.maxTargets, 'selectedTargets');
  boundedArray(value['checkpoints'], SESSION_STORE_LIMITS.maxCheckpoints, 'checkpoints');
  boundedArray(value['phaseHistory'], SESSION_STORE_LIMITS.maxPhaseHistory, 'phaseHistory');
  const plan = value['plan'];
  if (!isRecord(plan)) throw new WorkflowSessionError('CORRUPT', 'session plan is missing');
  const steps = boundedArray(plan['steps'], SESSION_STORE_LIMITS.maxPlanSteps, 'plan.steps');
  let conditions = 0;
  for (const step of steps) {
    if (!isRecord(step) || typeof step['id'] !== 'string') throw new WorkflowSessionError('CORRUPT', 'plan step is malformed');
    conditions += boundedArray(step['expected'], SESSION_STORE_LIMITS.maxConditions, 'plan.steps[].expected').length;
  }
  if (conditions > SESSION_STORE_LIMITS.maxConditions) {
    throw new WorkflowSessionError('OVERSIZE', `plan exceeds ${SESSION_STORE_LIMITS.maxConditions} expected conditions`);
  }
  const owner = value['owner'];
  if (owner !== undefined && (!isRecord(owner) || typeof owner['userId'] !== 'string' || typeof owner['username'] !== 'string')) {
    throw new WorkflowSessionError('CORRUPT', 'session owner is malformed');
  }
  const capabilities = value['capabilities'];
  if (!isRecord(capabilities) || !Array.isArray(capabilities['available']) || !Array.isArray(capabilities['unavailable'])) {
    throw new WorkflowSessionError('CORRUPT', 'session capabilities are malformed');
  }
  return value as unknown as ChangeWorkflowSession;
}

/** Applies checkpoint / phase-history retention in place and returns the session. */
export function applyRetention(session: ChangeWorkflowSession): ChangeWorkflowSession {
  if (session.checkpoints.length > SESSION_STORE_LIMITS.maxCheckpoints) {
    session.checkpoints = session.checkpoints.slice(-SESSION_STORE_LIMITS.maxCheckpoints);
  }
  if (session.phaseHistory.length > SESSION_STORE_LIMITS.maxPhaseHistory) {
    session.phaseHistory = session.phaseHistory.slice(-SESSION_STORE_LIMITS.maxPhaseHistory);
  }
  return session;
}

export interface SessionSummary {
  id: string;
  phase: ChangeWorkflowSession['phase'];
  revision: number;
  updatedAt: string;
  scope: ChangeWorkflowSession['scope'];
  /** HTTP owner's user ID; absent for CLI/MCP sessions. */
  ownerId?: string;
}

export interface SessionStore {
  readonly root: string;
  create(session: ChangeWorkflowSession): ChangeWorkflowSession;
  read(id: string): ChangeWorkflowSession;
  /**
   * Compare-and-swap update. `mutate` receives a deep copy of the current
   * session; the returned session is written with `revision + 1`.
   */
  update(id: string, expectedRevision: number, mutate: (session: ChangeWorkflowSession) => ChangeWorkflowSession): ChangeWorkflowSession;
  list(): SessionSummary[];
  writeBaseline(id: string, repositoryId: string, payload: unknown): { sha256: string; sizeBytes: number };
  readBaseline<T = unknown>(id: string, repositoryId: string, expectedSha256: string): T;
  prune(now?: Date): string[];
  /**
   * Throws QUOTA_EXCEEDED when the store already holds `maxSessions` active sessions, or when
   * `ownerId` already has `maxActiveSessionsPerOwner` active sessions in it.
   */
  assertCapacity(ownerId?: string): void;
}

export interface SessionStoreOptions {
  /** Override limits for tests. */
  maxSessionBytes?: number;
  maxBaselineBytes?: number;
  maxSessions?: number;
  maxActiveSessionsPerOwner?: number;
  completedRetentionMs?: number;
}

function baselineKey(repositoryId: string): string {
  return crypto.createHash('sha256').update(repositoryId).digest('hex').slice(0, 16);
}

export function createSessionStore(root: string, options: SessionStoreOptions = {}): SessionStore {
  const resolvedRoot = path.resolve(root);
  const maxSessionBytes = options.maxSessionBytes ?? SESSION_STORE_LIMITS.maxSessionBytes;
  const maxBaselineBytes = options.maxBaselineBytes ?? SESSION_STORE_LIMITS.maxBaselineBytes;
  const maxSessions = options.maxSessions ?? SESSION_STORE_LIMITS.maxSessions;
  const maxActiveSessionsPerOwner = options.maxActiveSessionsPerOwner ?? SESSION_STORE_LIMITS.maxActiveSessionsPerOwner;
  const completedRetentionMs = options.completedRetentionMs ?? SESSION_STORE_LIMITS.completedRetentionMs;

  const sessionPath = (id: string) => {
    assertSessionId(id);
    return path.join(resolvedRoot, `${id}.json`);
  };
  const baselinePath = (id: string, repositoryId: string) => {
    assertSessionId(id);
    return path.join(resolvedRoot, `${id}.${baselineKey(repositoryId)}.baseline.json`);
  };

  function serialize(session: ChangeWorkflowSession): string {
    const text = JSON.stringify(applyRetention(session), null, 2) + '\n';
    if (Buffer.byteLength(text) > maxSessionBytes) {
      throw new WorkflowSessionError('OVERSIZE', `session ${session.id} would exceed ${maxSessionBytes} bytes`);
    }
    return text;
  }

  function readFile(id: string): ChangeWorkflowSession {
    const filePath = sessionPath(id);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new WorkflowSessionError('NOT_FOUND', `workflow session ${id} not found`);
    }
    if (stat.size > maxSessionBytes) throw new WorkflowSessionError('OVERSIZE', `session file exceeds ${maxSessionBytes} bytes`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      throw new WorkflowSessionError('CORRUPT', `session ${id} is not valid JSON`);
    }
    return validateSessionShape(parsed, id);
  }

  function withLock<T>(id: string, fn: () => T): T {
    const lockPath = `${sessionPath(id)}.lock`;
    fs.mkdirSync(resolvedRoot, { recursive: true });
    const deadline = Date.now() + SESSION_STORE_LIMITS.lockWaitMs;
    for (;;) {
      try {
        const fd = fs.openSync(lockPath, 'wx', 0o600);
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > SESSION_STORE_LIMITS.lockStaleMs) {
            fs.rmSync(lockPath, { force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() > deadline) throw new WorkflowSessionError('LOCKED', `session ${id} is locked by another writer`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try {
      return fn();
    } finally {
      fs.rmSync(lockPath, { force: true });
    }
  }

  const store: SessionStore = {
    root: resolvedRoot,

    create(session) {
      validateSessionShape(session, session.id);
      const filePath = sessionPath(session.id);
      store.assertCapacity(session.owner?.userId);
      return withLock(session.id, () => {
        if (fs.existsSync(filePath)) throw new WorkflowSessionError('INVALID_REQUEST', `session ${session.id} already exists`);
        atomicWrite(filePath, serialize(session));
        return session;
      });
    },

    read(id) {
      return readFile(id);
    },

    update(id, expectedRevision, mutate) {
      return withLock(id, () => {
        const current = readFile(id);
        if (current.revision !== expectedRevision) {
          throw new WorkflowSessionError('REVISION_CONFLICT', `session ${id} is at revision ${current.revision}, not ${expectedRevision}`, {
            currentRevision: current.revision,
            expectedRevision,
          });
        }
        const next = applyRetention(mutate(structuredClone(current)));
        next.id = current.id;
        next.schemaVersion = CHANGE_WORKFLOW_SCHEMA_VERSION;
        next.revision = current.revision + 1;
        validateSessionShape(next, id);
        atomicWrite(sessionPath(id), serialize(next));
        return next;
      });
    },

    list() {
      let files: string[];
      try {
        files = fs.readdirSync(resolvedRoot);
      } catch {
        return [];
      }
      const summaries: SessionSummary[] = [];
      for (const file of files) {
        const match = /^(wf_[0-9a-f]{32})\.json$/.exec(file);
        if (!match) continue;
        try {
          const session = readFile(match[1]);
          summaries.push({ id: session.id, phase: session.phase, revision: session.revision, updatedAt: session.updatedAt, scope: session.scope, ...(session.owner ? { ownerId: session.owner.userId } : {}) });
        } catch {
          // Unreadable sessions are skipped from listings; `read` reports why.
        }
      }
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    },

    writeBaseline(id, repositoryId, payload) {
      const text = JSON.stringify(payload);
      const sizeBytes = Buffer.byteLength(text);
      if (sizeBytes > maxBaselineBytes) {
        throw new WorkflowSessionError('OVERSIZE', `baseline for ${repositoryId} would exceed ${maxBaselineBytes} bytes`);
      }
      atomicWrite(baselinePath(id, repositoryId), text);
      return { sha256: crypto.createHash('sha256').update(text).digest('hex'), sizeBytes };
    },

    readBaseline<T>(id: string, repositoryId: string, expectedSha256: string): T {
      const filePath = baselinePath(id, repositoryId);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        throw new WorkflowSessionError('NOT_FOUND', `baseline for ${repositoryId} is missing`);
      }
      if (stat.size > maxBaselineBytes) throw new WorkflowSessionError('OVERSIZE', `baseline for ${repositoryId} exceeds ${maxBaselineBytes} bytes`);
      const text = fs.readFileSync(filePath, 'utf8');
      if (crypto.createHash('sha256').update(text).digest('hex') !== expectedSha256) {
        throw new WorkflowSessionError('CORRUPT', `baseline for ${repositoryId} does not match its recorded checksum`);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new WorkflowSessionError('CORRUPT', `baseline for ${repositoryId} is not valid JSON`);
      }
    },

    prune(now = new Date()) {
      const summaries = store.list();
      const removed: string[] = [];
      const remove = (id: string) => {
        for (const file of fs.readdirSync(resolvedRoot)) {
          if (file === `${id}.json` || (file.startsWith(`${id}.`) && file.endsWith('.baseline.json'))) {
            fs.rmSync(path.join(resolvedRoot, file), { force: true });
          }
        }
        removed.push(id);
      };
      for (const summary of summaries) {
        if (summary.phase === 'complete' && now.getTime() - Date.parse(summary.updatedAt) > completedRetentionMs) remove(summary.id);
      }
      const remaining = summaries.filter((summary) => !removed.includes(summary.id));
      // Beyond the cap, drop the oldest completed sessions only. Active sessions may belong to
      // other users (HTTP), so they are never evicted; `assertCapacity` refuses new ones instead.
      const overflow = remaining.length - maxSessions;
      if (overflow > 0) {
        const completed = remaining.filter((summary) => summary.phase === 'complete')
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        for (const summary of completed.slice(0, overflow)) remove(summary.id);
      }
      return removed.sort();
    },

    assertCapacity(ownerId) {
      const active = store.list().filter((summary) => summary.phase !== 'complete');
      if (ownerId !== undefined) {
        const owned = active.filter((summary) => summary.ownerId === ownerId).length;
        if (owned >= maxActiveSessionsPerOwner) {
          throw new WorkflowSessionError('QUOTA_EXCEEDED', `you already have ${owned} active sessions here (limit ${maxActiveSessionsPerOwner}); complete one first`);
        }
      }
      if (active.length >= maxSessions) {
        throw new WorkflowSessionError('QUOTA_EXCEEDED', `session store already holds ${active.length} active sessions (limit ${maxSessions}); complete or remove one first`);
      }
    },
  };
  return store;
}
