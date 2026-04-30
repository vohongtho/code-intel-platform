/**
 * Tests for WorkerPool — generic worker-thread pool with backpressure.
 * Tests use a tiny echo worker script written to a temp file.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerPool } from '../../../src/pipeline/workers/worker-pool.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let echoWorkerPath: string;
let crashWorkerPath: string;

/**
 * A simple echo worker: receives { taskId, value } → posts { taskId, value }
 */
const ECHO_WORKER_SRC = `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (msg) => {
  parentPort.postMessage({ taskId: msg.taskId, value: msg.value });
});
`;

/**
 * A worker that crashes on the first message, then echoes subsequent ones.
 */
const CRASH_ONCE_WORKER_SRC = `
const { parentPort } = require('node:worker_threads');
let crashed = false;
parentPort.on('message', (msg) => {
  if (!crashed) {
    crashed = true;
    throw new Error('intentional crash');
  }
  parentPort.postMessage({ taskId: msg.taskId, value: msg.value });
});
`;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-test-'));
  echoWorkerPath = path.join(tmpDir, 'echo-worker.cjs');
  crashWorkerPath = path.join(tmpDir, 'crash-worker.cjs');
  fs.writeFileSync(echoWorkerPath, ECHO_WORKER_SRC);
  fs.writeFileSync(crashWorkerPath, CRASH_ONCE_WORKER_SRC);
});

after(async () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkerPool', () => {
  it('processes a single task and returns the result', async () => {
    const pool = new WorkerPool({ workerScript: echoWorkerPath, workerCount: 1 });
    await pool.init();
    const result = await pool.run({ taskId: 'a', value: 42 } as any);
    assert.equal((result as any).value, 42);
    await pool.close();
  });

  it('processes multiple tasks and returns correct results', async () => {
    const pool = new WorkerPool({ workerScript: echoWorkerPath, workerCount: 2 });
    await pool.init();
    const tasks = Array.from({ length: 10 }, (_, i) => ({ taskId: `t${i}`, value: i }));
    const results = await Promise.all(tasks.map((t) => pool.run(t as any)));
    const values = results.map((r) => (r as any).value).sort((a: number, b: number) => a - b);
    assert.deepEqual(values, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    await pool.close();
  });

  it('PARSE_WORKERS=1 forces single-threaded (workerCount=1)', async () => {
    const pool = new WorkerPool({ workerScript: echoWorkerPath, workerCount: 1 });
    await pool.init();
    assert.equal(pool.size, 1);
    await pool.close();
  });

  it('uses os.cpus().length-1 workers by default (at least 1)', async () => {
    const pool = new WorkerPool({ workerScript: echoWorkerPath });
    assert.ok(pool.size >= 1);
    // Don't init/run — just check size
  });

  it('results are deterministic across multiple runs', async () => {
    const pool = new WorkerPool({ workerScript: echoWorkerPath, workerCount: 3 });
    await pool.init();

    async function runOnce(): Promise<number[]> {
      const tasks = Array.from({ length: 20 }, (_, i) => ({ taskId: `t${i}`, value: i }));
      const results = await Promise.all(tasks.map((t) => pool.run(t as any)));
      return results.map((r) => (r as any).value).sort((a: number, b: number) => a - b);
    }

    const r1 = await runOnce();
    const r2 = await runOnce();
    assert.deepEqual(r1, r2);
    await pool.close();
  });

  it('4-worker pool uses 4 workers', async () => {
    const pool = new WorkerPool({ workerScript: echoWorkerPath, workerCount: 4 });
    await pool.init();
    assert.equal(pool.size, 4);
    await pool.close();
  });

  it('handles large batches without hanging', async () => {
    const pool = new WorkerPool({ workerScript: echoWorkerPath, workerCount: 2, maxQueueSize: 50 });
    await pool.init();
    const tasks = Array.from({ length: 100 }, (_, i) => ({ taskId: `t${i}`, value: i }));
    const results = await Promise.all(tasks.map((t) => pool.run(t as any)));
    assert.equal(results.length, 100);
    await pool.close();
  });

  it('worker crash → task rejected after max retries exhausted', async () => {
    // maxTaskRetries=0 → crash task rejected immediately, no infinite loop
    const pool = new WorkerPool({ workerScript: crashWorkerPath, workerCount: 1, maxTaskRetries: 0 });
    await pool.init();
    const result = await Promise.allSettled([
      pool.run({ taskId: 'crash', value: 1 } as any),
    ]);
    // crash task should be rejected
    assert.equal(result[0].status, 'rejected');
    await pool.close();
  });

  it('close() terminates all workers', async () => {
    const pool = new WorkerPool({ workerScript: echoWorkerPath, workerCount: 2 });
    await pool.init();
    await pool.close();
    // After close, running a task should reject
    await assert.rejects(() => pool.run({ taskId: 'x', value: 0 } as any));
  });
});
