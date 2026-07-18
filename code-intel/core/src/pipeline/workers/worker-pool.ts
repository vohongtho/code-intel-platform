/**
 * worker-pool.ts — Generic worker-thread pool with backpressure.
 *
 * - N workers (default: os.cpus().length - 1; PARSE_WORKERS env override)
 * - Work queue with backpressure: pauses when queue > 200
 * - Worker crash → restart + re-queue pending work
 * - Optional hung-task timeout → terminate worker + retry pending work
 * - Progress events forwarded to caller via onProgress callback
 */
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import Logger from '../../shared/logger.js';

export interface WorkerPoolOptions {
  workerScript: string;          // absolute path to the worker .js file
  workerCount?: number;          // default: os.cpus().length - 1 (min 1)
  maxQueueSize?: number;         // backpressure threshold (default 200)
  maxTaskRetries?: number;       // max retries on worker crash (default 2)
  taskTimeoutMs?: number;        // terminate + retry hung task after N ms (default: off)
}

interface PendingTask<I, O> {
  id: string;
  input: I;
  resolve: (result: O) => void;
  reject: (err: Error) => void;
  retries: number;
}

interface ActiveWorker<I, O> {
  worker: Worker;
  currentTask: PendingTask<I, O> | null;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  taskStartedAt: number | null;
  failureReason: string | null;
}

export class WorkerPool<I extends { taskId: string }, O extends { taskId: string; error?: string }> extends EventEmitter {
  private workers: ActiveWorker<I, O>[] = [];
  private queue: PendingTask<I, O>[] = [];
  private readonly workerScript: string;
  private readonly workerCount: number;
  private readonly maxQueueSize: number;
  private readonly maxTaskRetries: number;
  private readonly taskTimeoutMs: number;
  private closed = false;

  constructor(opts: WorkerPoolOptions) {
    super();
    this.workerScript = opts.workerScript;
    this.workerCount = opts.workerCount ?? Math.max(1, os.cpus().length - 1);
    this.maxQueueSize = opts.maxQueueSize ?? 200;
    this.maxTaskRetries = opts.maxTaskRetries ?? 2;
    this.taskTimeoutMs = Math.max(0, opts.taskTimeoutMs ?? 0);
  }

  /** Spawn all workers. Must be called before run(). */
  async init(): Promise<void> {
    for (let i = 0; i < this.workerCount; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): void {
    const aw: ActiveWorker<I, O> = {
      worker: null!, currentTask: null, timeoutHandle: null, taskStartedAt: null, failureReason: null,
    };
    const w = new Worker(this.workerScript);

    w.on('message', (result: O) => {
      this.clearWorkerTimer(aw);
      const task = aw.currentTask;
      aw.currentTask = null;
      aw.failureReason = null;
      if (task) {
        if (result.error) {
          task.reject(new Error(result.error));
        } else {
          task.resolve(result);
        }
      }
      this.emit('taskDone');
      this.dequeue(aw);
    });

    w.on('error', (err) => {
      this.failWorker(aw, `worker error: ${err.message}`);
    });

    w.on('exit', (code) => {
      this.clearWorkerTimer(aw);
      if (this.closed) return;
      if (aw.failureReason !== null) return;
      if (code !== 0) {
        this.failWorker(aw, `worker exited with code ${code}`);
      }
    });

    aw.worker = w;
    this.workers.push(aw);
    this.dequeue(aw);
  }

  private failWorker(aw: ActiveWorker<I, O>, reason: string): void {
    if (this.closed) return;
    if (aw.failureReason !== null) return;
    this.clearWorkerTimer(aw);
    aw.failureReason = reason;
    Logger.warn(`[WorkerPool] ${reason}`);
    const task = aw.currentTask;
    aw.currentTask = null;

    const idx = this.workers.indexOf(aw);
    if (idx >= 0) this.workers.splice(idx, 1);
    try { void aw.worker.terminate(); } catch { /* ignore */ }
    if (!this.closed) this.spawnWorker();

    if (task) this.requeueOrReject(task, reason);
  }

  private requeueOrReject(task: PendingTask<I, O>, reason: string): void {
    task.retries = (task.retries ?? 0) + 1;
    if (task.retries <= this.maxTaskRetries) {
      Logger.info(`[WorkerPool] re-queuing task ${task.id} after ${reason} (retry ${task.retries})`);
      this.queue.unshift(task);
      this.drainQueue();
      return;
    }
    Logger.warn(`[WorkerPool] task ${task.id} exceeded max retries (${this.maxTaskRetries}), rejecting`);
    task.reject(new Error(`${reason} after ${this.maxTaskRetries} retries`));
  }

  private clearWorkerTimer(aw: ActiveWorker<I, O>): void {
    if (aw.timeoutHandle) clearTimeout(aw.timeoutHandle);
    aw.timeoutHandle = null;
    aw.taskStartedAt = null;
  }

  private armWorkerTimer(aw: ActiveWorker<I, O>, task: PendingTask<I, O>): void {
    if (this.taskTimeoutMs <= 0) return;
    aw.taskStartedAt = Date.now();
    aw.timeoutHandle = setTimeout(() => {
      const elapsed = aw.taskStartedAt ? Date.now() - aw.taskStartedAt : this.taskTimeoutMs;
      this.failWorker(aw, `worker task timeout after ${elapsed}ms (task ${task.id})`);
    }, this.taskTimeoutMs);
  }

  /** Submit a task. Resolves with the worker result or rejects on error. */
  run(input: I): Promise<O> {
    if (this.closed) return Promise.reject(new Error('WorkerPool is closed'));

    return new Promise((resolve, reject) => {
      const task: PendingTask<I, O> = { id: input.taskId, input, resolve, reject, retries: 0 };
      this.queue.push(task);

      if (this.queue.length > this.maxQueueSize) {
        // Backpressure: emit event; callers should await until queue drains
        this.emit('backpressure', this.queue.length);
      }

      this.drainQueue();
    });
  }

  private drainQueue(): void {
    for (const aw of this.workers) {
      if (!aw.currentTask) this.dequeue(aw);
    }
  }

  private dequeue(aw: ActiveWorker<I, O>): void {
    if (this.queue.length === 0 || aw.currentTask !== null) return;
    const task = this.queue.shift()!;
    aw.currentTask = task;
    this.armWorkerTimer(aw, task);
    aw.worker.postMessage(task.input);
  }

  get queueLength(): number { return this.queue.length; }
  get size(): number { return this.workerCount; }

  /** Terminate all workers gracefully. */
  async close(): Promise<void> {
    this.closed = true;
    for (const aw of this.workers) this.clearWorkerTimer(aw);
    await Promise.all(this.workers.map((aw) => aw.worker.terminate()));
    this.workers = [];
  }
}
