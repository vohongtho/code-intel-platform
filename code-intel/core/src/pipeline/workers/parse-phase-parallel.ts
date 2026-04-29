/**
 * parse-phase-parallel.ts — Drop-in parallel replacement for parse-phase.ts
 *
 * Uses WorkerPool<ParseTask, ParseResult> to distribute file parsing across
 * N worker threads (default: os.cpus().length - 1).
 *
 * Falls back gracefully to sequential execution if workers fail to start.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectLanguage, Language } from '../../shared/index.js';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { generateNodeId } from '../../graph/id-generator.js';
import Logger from '../../shared/logger.js';
import { WorkerPool } from './worker-pool.js';
import type { ParseTask, ParseResult } from './parse-worker.js';
import {
  typescriptQueries, javascriptQueries, pythonQueries, javaQueries, goQueries,
  cQueries, cppQueries, csharpQueries, rustQueries, phpQueries,
  kotlinQueries, rubyQueries, swiftQueries,
} from '../../parsing/queries/index.js';

const LANG_QUERIES: Partial<Record<Language, string>> = {
  [Language.TypeScript]: typescriptQueries,
  [Language.JavaScript]: javascriptQueries,
  [Language.Python]:     pythonQueries,
  [Language.Java]:       javaQueries,
  [Language.Go]:         goQueries,
  [Language.C]:          cQueries,
  [Language.Cpp]:        cppQueries,
  [Language.CSharp]:     csharpQueries,
  [Language.Rust]:       rustQueries,
  [Language.PHP]:        phpQueries,
  [Language.Kotlin]:     kotlinQueries,
  [Language.Ruby]:       rubyQueries,
  [Language.Swift]:      swiftQueries,
};

// Resolve the compiled worker script path (dist/pipeline/workers/parse-worker.js)
function workerScriptPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(thisFile), 'parse-worker.js');
}

export const parsePhaseParallel: Phase = {
  name: 'parse',
  dependencies: ['structure'],

  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();

    if (!context.fileCache) context.fileCache = new Map();
    if (!context.fileFunctionIndex) context.fileFunctionIndex = new Map();

    const filePaths = context.filePaths;
    const workerCount = parseInt(process.env['PARSE_WORKERS'] ?? '', 10) || Math.max(1, os.cpus().length - 1);

    // ── Read all files into cache ─────────────────────────────────────────────
    const CONCURRENCY = 64;
    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      const batch = filePaths.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (filePath) => {
        try {
          const source = await fs.promises.readFile(filePath, 'utf-8');
          context.fileCache!.set(filePath, source);
        } catch { /* skip */ }
      }));
    }

    // ── Try to start the worker pool ──────────────────────────────────────────
    const workerScript = workerScriptPath();
    const workerScriptExists = fs.existsSync(workerScript);

    if (!workerScriptExists || workerCount === 1) {
      // Worker script not built yet or forced single-threaded — delegate to
      // the regular sequential parse phase
      Logger.info(`[parse-parallel] falling back to sequential (workerCount=${workerCount}, scriptExists=${workerScriptExists})`);
      const { parsePhase } = await import('../phases/parse-phase.js');
      return parsePhase.execute(context, new Map());
    }

    // ── Build tasks ───────────────────────────────────────────────────────────
    const tasks: ParseTask[] = [];
    for (const filePath of filePaths) {
      const lang = detectLanguage(filePath);
      if (!lang) continue;
      const source = context.fileCache.get(filePath);
      if (!source) continue;
      const relativePath = path.relative(context.workspaceRoot, filePath);
      const fileNodeId = generateNodeId('file', relativePath, relativePath);

      // Store file content snippet on the file node
      const fileNode = context.graph.getNode(fileNodeId);
      if (fileNode) fileNode.content = source.slice(0, 2000);

      tasks.push({
        taskId: filePath,
        filePath,
        relativePath,
        source,
        lang: lang as string,
        fileNodeId,
        queryStr: LANG_QUERIES[lang] ?? null,
      });
    }

    // ── Run tasks in worker pool ──────────────────────────────────────────────
    const pool = new WorkerPool<ParseTask, ParseResult>({
      workerScript,
      workerCount,
      maxQueueSize: 200,
    });
    await pool.init();

    let symbolCount = 0;
    let treeSitterCount = 0;
    let regexCount = 0;
    let parseDone = 0;

    // Backpressure: wait for queue to drain below threshold before submitting more
    const BATCH_SIZE = 100;

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((t) => pool.run(t).catch((err: Error) => ({
        taskId: t.taskId,
        nodes: [],
        edges: [],
        usedTreeSitter: false,
        error: err.message,
      } as ParseResult))));

      for (const res of results) {
        if (res.error) {
          Logger.warn(`[parse-parallel] task error: ${res.error}`);
        }
        for (const n of res.nodes) context.graph.addNode(n);
        for (const e of res.edges) context.graph.addEdge(e);
        symbolCount += res.nodes.length;
        if (res.usedTreeSitter) treeSitterCount++;
        else regexCount++;

        // Build per-file sorted function index
        const relativePath = path.relative(context.workspaceRoot, res.taskId);
        const funcs = res.nodes
          .filter((n) => n.kind === 'function' || n.kind === 'method')
          .map((n) => ({ id: n.id, startLine: n.startLine ?? 0, endLine: n.endLine }))
          .sort((a, b) => a.startLine - b.startLine);
        if (funcs.length > 0) context.fileFunctionIndex!.set(relativePath, funcs);

        parseDone++;
        context.onPhaseProgress?.('parse', parseDone, tasks.length);
      }
    }

    await pool.close();

    const parserUsed: 'tree-sitter' | 'regex' = treeSitterCount === 0 ? 'regex' : 'tree-sitter';
    context.parserUsed = parserUsed;

    if (context.verbose) {
      Logger.info(`[parse-parallel] ${workerCount} workers, tree-sitter: ${treeSitterCount}, regex: ${regexCount}`);
    }

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: `Extracted ${symbolCount} symbols from ${filePaths.length} files (${parserUsed}, ${workerCount} workers)`,
    };
  },
};
