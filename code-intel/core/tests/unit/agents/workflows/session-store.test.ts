import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSessionStore,
  newSessionId,
  resolveGroupSessionRoot,
  resolveRepoSessionRoot,
  SESSION_STORE_LIMITS,
  WorkflowSessionError,
} from '../../../../src/agents/workflows/session-store.js';
import {
  canTransition,
  CHANGE_WORKFLOW_PHASES,
  CHANGE_WORKFLOW_SCHEMA_VERSION,
  type ChangeWorkflowSession,
} from '../../../../src/agents/workflows/session-types.js';

function makeSession(overrides: Partial<ChangeWorkflowSession> = {}): ChangeWorkflowSession {
  const at = '2026-10-01T00:00:00.000Z';
  return {
    schemaVersion: CHANGE_WORKFLOW_SCHEMA_VERSION,
    id: newSessionId(),
    revision: 1,
    phase: 'ready-for-change',
    createdAt: at,
    updatedAt: at,
    scope: { type: 'repo', repositoryId: 'repo-1', repositoryName: 'repo', repoPath: '/tmp/repo' },
    taskFingerprint: 'f'.repeat(64),
    taskRetention: 'fingerprint-only',
    baselines: [],
    selectedTargets: [],
    plan: { steps: [], boundaries: [], contextFingerprints: [], truncated: false },
    checkpoints: [],
    capabilities: { available: [], unavailable: [] },
    phaseHistory: [{ phase: 'ready-for-change', enteredAt: at }],
    ...overrides,
  };
}

function expectCode(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof WorkflowSessionError && err.code === code);
}

describe('workflow session store', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-store-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('round-trips a session across independent store instances (reopen)', () => {
    const session = makeSession();
    createSessionStore(root).create(session);
    const reopened = createSessionStore(root).read(session.id);
    assert.deepEqual(reopened, session);
  });

  it('generates unguessable IDs and rejects path-like IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSessionId()));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, /^wf_[0-9a-f]{32}$/);
    const store = createSessionStore(root);
    expectCode(() => store.read('../../etc/passwd'), 'INVALID_ID');
    expectCode(() => store.read('wf_123'), 'INVALID_ID');
  });

  it('reports a missing session as NOT_FOUND', () => {
    expectCode(() => createSessionStore(root).read(newSessionId()), 'NOT_FOUND');
  });

  it('rejects corrupt JSON, wrong IDs and unknown phases on reopen', () => {
    const store = createSessionStore(root);
    const session = makeSession();
    store.create(session);
    const file = path.join(root, `${session.id}.json`);

    fs.writeFileSync(file, '{ not json');
    expectCode(() => store.read(session.id), 'CORRUPT');

    fs.writeFileSync(file, JSON.stringify({ ...session, id: newSessionId() }));
    expectCode(() => store.read(session.id), 'CORRUPT');

    fs.writeFileSync(file, JSON.stringify({ ...session, phase: 'shipping' }));
    expectCode(() => store.read(session.id), 'CORRUPT');

    fs.writeFileSync(file, JSON.stringify({ ...session, revision: 0 }));
    expectCode(() => store.read(session.id), 'CORRUPT');
  });

  it('rejects an unsupported schema version rather than guessing', () => {
    const store = createSessionStore(root);
    const session = makeSession();
    store.create(session);
    fs.writeFileSync(path.join(root, `${session.id}.json`), JSON.stringify({ ...session, schemaVersion: 2 }));
    expectCode(() => store.read(session.id), 'UNSUPPORTED_SCHEMA');
  });

  it('rejects oversize session files and oversize lists', () => {
    const store = createSessionStore(root, { maxSessionBytes: 4096 });
    const session = makeSession();
    store.create(session);
    fs.writeFileSync(path.join(root, `${session.id}.json`), JSON.stringify({ ...session, taskSummary: 'x'.repeat(10_000) }));
    expectCode(() => store.read(session.id), 'OVERSIZE');

    const big = createSessionStore(root);
    const tooManyTargets = Array.from({ length: SESSION_STORE_LIMITS.maxTargets + 1 }, (_, i) => ({
      kind: 'symbol' as const, id: `n${i}`, repositoryId: 'repo-1', certainty: 'exact' as const, source: 'user' as const,
    }));
    fs.writeFileSync(path.join(root, `${session.id}.json`), JSON.stringify({ ...session, selectedTargets: tooManyTargets }));
    expectCode(() => big.read(session.id), 'OVERSIZE');
  });

  it('refuses to write a session that would exceed the size bound', () => {
    const store = createSessionStore(root, { maxSessionBytes: 2048 });
    expectCode(() => store.create(makeSession({ taskSummary: 'y'.repeat(4096) })), 'OVERSIZE');
  });

  it('compare-and-swap: a stale revision is rejected and the newer checkpoint survives', () => {
    const store = createSessionStore(root);
    const session = makeSession();
    store.create(session);

    // Two clients both read revision 1.
    const clientA = createSessionStore(root).read(session.id);
    const clientB = createSessionStore(root).read(session.id);
    assert.equal(clientA.revision, 1);
    assert.equal(clientB.revision, 1);

    const written = store.update(session.id, clientA.revision, (next) => {
      next.checkpoints.push({ id: 'cp-a', kind: 'checkpoint', createdAt: next.updatedAt, fromPhase: next.phase, toPhase: next.phase, revision: 2, note: 'A' });
      return next;
    });
    assert.equal(written.revision, 2);

    assert.throws(
      () => store.update(session.id, clientB.revision, (next) => {
        next.checkpoints = [{ id: 'cp-b', kind: 'checkpoint', createdAt: next.updatedAt, fromPhase: next.phase, toPhase: next.phase, revision: 2, note: 'B' }];
        return next;
      }),
      (err: unknown) => err instanceof WorkflowSessionError && err.code === 'REVISION_CONFLICT' && err.details['currentRevision'] === 2,
    );
    const final = store.read(session.id);
    assert.equal(final.revision, 2);
    assert.deepEqual(final.checkpoints.map((cp) => cp.note), ['A']);
  });

  it('writes atomically: no temp files or lock files are left behind', () => {
    const store = createSessionStore(root);
    const session = makeSession();
    store.create(session);
    store.update(session.id, 1, (next) => next);
    assert.deepEqual(fs.readdirSync(root).sort(), [`${session.id}.json`]);
  });

  it('retains only the newest checkpoints and phase history entries', () => {
    const store = createSessionStore(root);
    const session = makeSession();
    store.create(session);
    const updated = store.update(session.id, 1, (next) => {
      for (let i = 0; i < SESSION_STORE_LIMITS.maxCheckpoints + 10; i += 1) {
        next.checkpoints.push({ id: `cp-${i}`, kind: 'status', createdAt: next.updatedAt, fromPhase: next.phase, toPhase: next.phase, revision: 2 });
      }
      return next;
    });
    assert.equal(updated.checkpoints.length, SESSION_STORE_LIMITS.maxCheckpoints);
    assert.equal(updated.checkpoints.at(-1)?.id, `cp-${SESSION_STORE_LIMITS.maxCheckpoints + 9}`);
    assert.equal(store.read(session.id).checkpoints.length, SESSION_STORE_LIMITS.maxCheckpoints);
  });

  it('prunes old completed sessions and caps the session count (completed first)', () => {
    const store = createSessionStore(root, { maxSessions: 2, completedRetentionMs: 1000 });
    const oldComplete = makeSession({ phase: 'complete', updatedAt: '2026-01-01T00:00:00.000Z' });
    const recentComplete = makeSession({ phase: 'complete', updatedAt: '2026-10-01T00:00:00.000Z' });
    const activeA = makeSession({ updatedAt: '2026-09-01T00:00:00.000Z' });
    const activeB = makeSession({ updatedAt: '2026-09-02T00:00:00.000Z' });
    for (const s of [oldComplete, recentComplete, activeA, activeB]) store.create(s);
    store.writeBaseline(oldComplete.id, 'repo-1', { hello: 'world' });

    const removed = store.prune(new Date('2026-10-01T00:00:00.500Z'));
    assert.deepEqual(removed, [oldComplete.id, recentComplete.id].sort());
    assert.deepEqual(store.list().map((s) => s.id).sort(), [activeA.id, activeB.id].sort());
    assert.ok(!fs.readdirSync(root).some((file) => file.startsWith(oldComplete.id)), 'baseline sidecars are pruned with their session');
  });

  it('verifies baseline sidecar checksums and size bounds', () => {
    const store = createSessionStore(root, { maxBaselineBytes: 64 });
    const id = newSessionId();
    const written = store.writeBaseline(id, 'repo-1', { a: 1 });
    assert.deepEqual(store.readBaseline(id, 'repo-1', written.sha256), { a: 1 });
    expectCode(() => store.readBaseline(id, 'repo-1', '0'.repeat(64)), 'CORRUPT');
    expectCode(() => store.writeBaseline(id, 'repo-1', { a: 'z'.repeat(200) }), 'OVERSIZE');
    expectCode(() => store.readBaseline(id, 'repo-2', written.sha256), 'NOT_FOUND');
  });

  it('keeps repo sessions in the repository data dir and group sessions under the global root', () => {
    assert.equal(resolveRepoSessionRoot('/work/app'), path.resolve('/work/app/.code-intel/workflows/sessions'));
    assert.equal(resolveGroupSessionRoot('commerce', '/home/u'), path.join('/home/u', '.code-intel', 'workflows', 'groups', 'commerce', 'sessions'));
    expectCode(() => resolveGroupSessionRoot('../escape', '/home/u'), 'INVALID_REQUEST');
    expectCode(() => resolveGroupSessionRoot('a/b', '/home/u'), 'INVALID_REQUEST');
  });
});

describe('workflow phase state machine (single repository)', () => {
  it('allows the documented plan -> edit -> reindex -> verify -> review -> complete path', () => {
    const path: Array<[string, string]> = [
      ['discover', 'plan'],
      ['plan', 'ready-for-change'],
      ['ready-for-change', 'reindex-required'],
      ['reindex-required', 'verify'],
      ['verify', 'needs-revision'],
      ['needs-revision', 'reindex-required'],
      ['reindex-required', 'verify'],
      ['verify', 'review'],
      ['review', 'complete'],
    ];
    for (const [from, to] of path) assert.ok(canTransition(from as never, to as never), `${from} -> ${to}`);
  });

  it('rejects skipping verification and leaving complete', () => {
    assert.equal(canTransition('ready-for-change', 'review'), false);
    assert.equal(canTransition('ready-for-change', 'complete'), false);
    assert.equal(canTransition('reindex-required', 'review'), false);
    for (const phase of CHANGE_WORKFLOW_PHASES) assert.equal(canTransition('complete', phase), false);
  });

  it('persists every transition of a single-repository session across reopen', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-sm-'));
    try {
      const store = createSessionStore(root);
      const session = makeSession();
      store.create(session);
      let revision = 1;
      for (const phase of ['reindex-required', 'verify', 'review', 'complete'] as const) {
        const current = createSessionStore(root).read(session.id);
        assert.ok(canTransition(current.phase, phase));
        const next = store.update(session.id, revision, (s) => {
          s.phase = phase;
          s.phaseHistory.push({ phase, enteredAt: s.updatedAt });
          return s;
        });
        revision = next.revision;
      }
      const reopened = createSessionStore(root).read(session.id);
      assert.equal(reopened.phase, 'complete');
      assert.equal(reopened.revision, 5);
      assert.deepEqual(reopened.phaseHistory.map((p) => p.phase), ['ready-for-change', 'reindex-required', 'verify', 'review', 'complete']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
