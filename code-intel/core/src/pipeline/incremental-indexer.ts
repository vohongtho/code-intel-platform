/**
 * IncrementalIndexer — patch the in-memory graph + DB for a set of changed files.
 *
 * Steps:
 *  1. Remove stale nodes (and their edges) from memory + DB
 *  2. Re-run parse + resolve phases on the changed files only
 *  3. Merge new nodes/edges into the live graph
 *  4. Upsert new nodes to DB
 */

import path from 'node:path';
import fs from 'node:fs';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { DbManager } from '../storage/db-manager.js';
import { removeNodesForFile, upsertNodes } from '../storage/graph-loader.js';
import { runPipeline } from './orchestrator.js';
import { structurePhase, parsePhase, resolvePhase } from './phases/index.js';
import type { PipelineContext } from './types.js';
import Logger from '../shared/logger.js';
import { Bm25Index, getBm25DbPath } from '../search/bm25-index.js';

export interface PatchResult {
  filesProcessed: number;
  deletedFiles: number;
  nodesRemoved: number;
  nodesAdded: number;
  duration: number;
}

export class IncrementalIndexer {
  private readonly graph: KnowledgeGraph;
  private readonly workspaceRoot: string;
  private readonly dbPath: string;

  constructor(graph: KnowledgeGraph, workspaceRoot: string, dbPath: string) {
    this.graph = graph;
    this.workspaceRoot = workspaceRoot;
    this.dbPath = dbPath;
  }

  /**
   * Patch the graph for changed absolute file paths and deleted relative paths.
   * Non-blocking for HTTP API reads (pure in-memory + async DB).
   */
  async patchGraph(changedFiles: string[], deletedFiles: string[] = []): Promise<PatchResult> {
    const start = Date.now();
    const { graph, workspaceRoot, dbPath } = this;

    if (changedFiles.length === 0 && deletedFiles.length === 0) {
      return { filesProcessed: 0, deletedFiles: 0, nodesRemoved: 0, nodesAdded: 0, duration: 0 };
    }

    // ── 1. Remove stale nodes from in-memory graph ────────────────────────────
    let nodesRemoved = 0;

    // Build a filePath → nodeIds index once to avoid O(F×N) scanning.
    const nodesByFilePath = new Map<string, string[]>();
    for (const node of graph.allNodes()) {
      if (!node.filePath) continue;
      const ids = nodesByFilePath.get(node.filePath);
      if (ids) ids.push(node.id);
      else nodesByFilePath.set(node.filePath, [node.id]);
    }

    const nodeIdsToRemove = new Set<string>();
    const affectedRelPaths = new Set<string>(deletedFiles);
    for (const absPath of changedFiles) {
      affectedRelPaths.add(path.relative(workspaceRoot, absPath));
    }
    for (const relPath of affectedRelPaths) {
      for (const id of nodesByFilePath.get(relPath) ?? []) nodeIdsToRemove.add(id);
      const absPath = path.join(workspaceRoot, relPath);
      for (const id of nodesByFilePath.get(absPath) ?? []) nodeIdsToRemove.add(id);
    }
    for (const id of nodeIdsToRemove) {
      graph.removeNodeCascade(id);
      nodesRemoved++;
    }

    // ── 2. Remove stale nodes from DB ─────────────────────────────────────────
    if (fs.existsSync(dbPath)) {
      try {
        const db = new DbManager(dbPath);
        await db.init();
        for (const relPath of affectedRelPaths) {
          await removeNodesForFile(relPath, db);
        }
        db.close();
      } catch (err) {
        Logger.warn(`[incremental] DB removal failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ── 3. Re-parse + re-resolve only the changed files ───────────────────────
    // Only re-parse files that still exist (deleted files just get their nodes removed)
    const existingFiles = changedFiles.filter((f) => {
      try { return fs.statSync(f).isFile(); } catch { return false; }
    });

    const nodesBeforeParse = graph.size.nodes;

    if (existingFiles.length > 0) {
      const context: PipelineContext = {
        workspaceRoot,
        graph,
        filePaths: existingFiles,
      };

      // noopScanPhase so parse/resolve deps are satisfied
      const noopScan = {
        name: 'scan',
        dependencies: [] as string[],
        async execute() { return { status: 'completed' as const, duration: 0 }; },
      };

      await runPipeline([noopScan, structurePhase, parsePhase, resolvePhase], context);
    }

    const nodesAdded = Math.max(0, graph.size.nodes - (nodesBeforeParse - nodesRemoved));

    // ── 4. Upsert new nodes to DB ─────────────────────────────────────────────
    if (fs.existsSync(dbPath) && existingFiles.length > 0) {
      try {
        const db = new DbManager(dbPath);
        await db.init();
        const nodesToUpsert = [...graph.allNodes()].filter(
          (n) => affectedRelPaths.has(n.filePath) || affectedRelPaths.has(path.relative(workspaceRoot, n.filePath)),
        );
        await upsertNodes(nodesToUpsert, db);
        db.close();

        // ── 5. Incremental BM25 index update (only changed nodes) ─────────────
        try {
          const bm25DbPath = getBm25DbPath(workspaceRoot);
          if (fs.existsSync(bm25DbPath)) {
            const bm25 = new Bm25Index(bm25DbPath);
            bm25.updateNodes(nodesToUpsert, [...affectedRelPaths]);
            Logger.info(`[incremental] BM25 index updated: ${nodesToUpsert.length} nodes`);
          }
        } catch (bm25Err) {
          Logger.warn(`[incremental] BM25 update failed: ${bm25Err instanceof Error ? bm25Err.message : bm25Err}`);
        }
      } catch (err) {
        Logger.warn(`[incremental] DB upsert failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    const duration = Date.now() - start;
    Logger.info(`[incremental] patch: ${changedFiles.length} changed files, ${deletedFiles.length} deleted files, -${nodesRemoved} nodes, +${nodesAdded} nodes, ${duration}ms`);

    return {
      filesProcessed: changedFiles.length,
      deletedFiles: deletedFiles.length,
      nodesRemoved,
      nodesAdded,
      duration,
    };
  }
}
