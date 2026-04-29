/**
 * resolve-phase-parallel.ts — Drop-in parallel replacement for resolve-phase.ts
 *
 * Builds read-only index snapshots (symbolIndex, fileSymbolIndex, fileIndex),
 * shares them with resolve workers via workerData, then distributes one
 * ResolveTask per file across the pool and merges all edge results.
 */
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectLanguage } from '../../shared/index.js';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { generateNodeId, generateEdgeId } from '../../graph/id-generator.js';
import Logger from '../../shared/logger.js';
import type { ResolveSnapshot, ResolveTask, ResolveResult } from './resolve-worker.js';

function workerScriptPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(thisFile), 'resolve-worker.js');
}

export const resolvePhaseParallel: Phase = {
  name: 'resolve',
  dependencies: ['parse'],

  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();
    const { graph, workspaceRoot, filePaths } = context;

    const fileCache = context.fileCache ?? new Map<string, string>();
    const fileFunctionIndex = context.fileFunctionIndex ?? new Map<string, { id: string; startLine: number; endLine: number | undefined }[]>();

    // ── Build indices ─────────────────────────────────────────────────────────
    const fileIndex: Record<string, string> = {};
    for (const fp of filePaths) {
      const rel = path.relative(workspaceRoot, fp);
      fileIndex[rel] = fp;
      const noExt = rel.replace(/\.\w+$/, '');
      if (!fileIndex[noExt]) fileIndex[noExt] = fp;
      const base = path.basename(rel, path.extname(rel));
      if (!fileIndex[base]) fileIndex[base] = fp;
    }

    const symbolIndex: Record<string, string> = {};
    const fileSymbolIndex: Record<string, Record<string, string>> = {};
    for (const node of graph.allNodes()) {
      if (['function', 'class', 'interface', 'method', 'enum', 'type_alias', 'variable', 'constant', 'struct', 'trait'].includes(node.kind)) {
        symbolIndex[node.name] = node.id;
        if (!fileSymbolIndex[node.filePath]) fileSymbolIndex[node.filePath] = {};
        fileSymbolIndex[node.filePath][node.name] = node.id;
      }
    }

    const snapshot: ResolveSnapshot = { symbolIndex, fileSymbolIndex, fileIndex, workspaceRoot };

    // ── Check if worker script exists ─────────────────────────────────────────
    const workerScript = workerScriptPath();
    const workerScriptExists = fs.existsSync(workerScript);
    const workerCount = parseInt(process.env['PARSE_WORKERS'] ?? '', 10) || Math.max(1, os.cpus().length - 1);

    if (!workerScriptExists || workerCount === 1) {
      Logger.info(`[resolve-parallel] falling back to sequential`);
      const { resolvePhase } = await import('../phases/resolve-phase.js');
      return resolvePhase.execute(context, new Map());
    }

    // ── Build tasks ───────────────────────────────────────────────────────────
    const tasks: ResolveTask[] = [];
    for (const filePath of filePaths) {
      const lang = detectLanguage(filePath);
      if (!lang) continue;
      const source = fileCache.get(filePath);
      if (!source) continue;
      const relativePath = path.relative(workspaceRoot, filePath);
      const fileNodeId = generateNodeId('file', relativePath, relativePath);
      const funcList = fileFunctionIndex.get(relativePath) ?? [];
      tasks.push({ taskId: filePath, filePath, relativePath, fileNodeId, source, funcList });
    }

    // ── Spawn resolve workers (pass snapshot via workerData) ──────────────────
    let importEdges = 0;
    let callEdges = 0;
    let heritageEdges = 0;
    let fileDone = 0;

    const BATCH_SIZE = 100;

    // We spawn one pool of workers sharing the same snapshot via workerData
    // Use a simple Promise-based dispatch (workers are stateless per message)
    const workers: { w: Worker; busy: boolean }[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push({ w: new Worker(workerScript, { workerData: snapshot }), busy: false });
    }

    const pendingResolvers = new Map<string, (r: ResolveResult) => void>();
    for (const { w } of workers) {
      w.on('message', (result: ResolveResult) => {
        const resolve = pendingResolvers.get(result.taskId);
        if (resolve) { pendingResolvers.delete(result.taskId); resolve(result); }
      });
      w.on('error', (err) => Logger.warn(`[resolve-worker] error: ${err.message}`));
    }

    let workerIdx = 0;
    function runTask(task: ResolveTask): Promise<ResolveResult> {
      return new Promise((resolve) => {
        pendingResolvers.set(task.taskId, resolve);
        const { w } = workers[workerIdx % workers.length];
        workerIdx++;
        w.postMessage(task);
      });
    }

    const seen = new Set<string>();

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((t) => runTask(t)));

      for (const res of results) {
        if (res.error) Logger.warn(`[resolve-parallel] task error: ${res.error}`);
        for (const edge of res.edges) {
          if (seen.has(edge.id)) continue;
          seen.add(edge.id);
          graph.addEdge(edge);
          if (edge.kind === 'imports') importEdges++;
          else if (edge.kind === 'calls') callEdges++;
          else heritageEdges++;
        }
        fileDone++;
        context.onPhaseProgress?.('resolve', fileDone, tasks.length);
      }
    }

    await Promise.all(workers.map(({ w }) => w.terminate()));

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: `Resolved ${importEdges} imports, ${callEdges} calls, ${heritageEdges} heritage edges. Graph: ${graph.size.nodes} nodes, ${graph.size.edges} edges`,
    };
  },
};
