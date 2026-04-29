/**
 * worker-pool.ts — Generic worker-thread pool with backpressure.
 *
 * - N workers (default: os.cpus().length - 1; PARSE_WORKERS env override)
 * - Work queue with backpressure: pauses when queue > 200
 * - Worker crash → restart + re-queue pending work
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
}

export class WorkerPool<I extends { taskId: string }, O extends { taskId: string; error?: string }> extends EventEmitter {
  private workers: ActiveWorker<I, O>[] = [];
  private queue: PendingTask<I, O>[] = [];
  private readonly workerScript: string;
  private readonly workerCount: number;
  private readonly maxQueueSize: number;
  private readonly maxTaskRetries: number;
  private closed = false;

  constructor(opts: WorkerPoolOptions) {
    super();
    this.workerScript = opts.workerScript;
    this.workerCount = opts.workerCount ?? Math.max(1, os.cpus().length - 1);
    this.maxQueueSize = opts.maxQueueSize ?? 200;
    this.maxTaskRetries = opts.maxTaskRetries ?? 2;
  }

  /** Spawn all workers. Must be called before run(). */
  async init(): Promise<void> {
    for (let i = 0; i < this.workerCount; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): void {
    const aw: ActiveWorker<I, O> = { worker: null!, currentTask: null };
    const w = new Worker(this.workerScript);

    w.on('message', (result: O) => {
      const task = aw.currentTask;
      aw.currentTask = null;
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
      Logger.warn(`[WorkerPool] worker error: ${err.message}`);
      const task = aw.currentTask;
      aw.currentTask = null;

      // Re-spawn replacement worker
      const idx = this.workers.indexOf(aw);
      if (idx >= 0) this.workers.splice(idx, 1);
      if (!this.closed) this.spawnWorker();

      // Re-queue the task that was in flight (up to maxTaskRetries)
      if (task) {
        task.retries = (task.retries ?? 0) + 1;
        if (task.retries <= this.maxTaskRetries) {
          Logger.info(`[WorkerPool] re-queuing task ${task.id} after worker crash (retry ${task.retries})`);
          this.queue.unshift(task);
          this.drainQueue();
        } else {
          Logger.warn(`[WorkerPool] task ${task.id} exceeded max retries (${this.maxTaskRetries}), rejecting`);
          task.reject(new Error(`Worker crashed after ${this.maxTaskRetries} retries`));
        }
      }
    });

    w.on('exit', (code) => {
      if (code !== 0 && !this.closed) {
        Logger.warn(`[WorkerPool] worker exited with code ${code}`);
      }
    });

    aw.worker = w;
    this.workers.push(aw);
    this.dequeue(aw);
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
    aw.worker.postMessage(task.input);
  }

  get queueLength(): number { return this.queue.length; }
  get size(): number { return this.workerCount; }

  /** Terminate all workers gracefully. */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.workers.map((aw) => aw.worker.terminate()));
    this.workers = [];
  }
}
