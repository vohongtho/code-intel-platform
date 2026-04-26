#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { createKnowledgeGraph } from '../graph/knowledge-graph.js';
import { runPipeline } from '../pipeline/orchestrator.js';
import {
  scanPhase,
  structurePhase,
  parsePhase,
  resolvePhase,
  clusterPhase,
  flowPhase,
} from '../pipeline/phases/index.js';
import { startHttpServer } from '../http/app.js';
import { startMcpStdio } from '../mcp-server/server.js';
import { textSearch } from '../search/text-search.js';
import type { PipelineContext } from '../pipeline/types.js';
import { saveMetadata, loadMetadata, getDbPath } from '../storage/metadata.js';
import { writeSkillFiles } from './skill-writer.js';
import { writeContextFiles } from './context-writer.js';
import { upsertRepo, loadRegistry, removeRepo } from '../storage/repo-registry.js';
import { DbManager, loadGraphToDB } from '../storage/index.js';

const program = new Command();

program
  .name('code-intel')
  .description('Code Intelligence Platform — Static Analysis + Knowledge Graph')
  .version('0.1.0');

async function analyzeWorkspace(targetPath: string, options?: { silent?: boolean }) {
  const workspaceRoot = path.resolve(targetPath);
  if (!options?.silent) console.log(`Analyzing: ${workspaceRoot}`);

  const graph = createKnowledgeGraph();
  const context: PipelineContext = {
    workspaceRoot,
    graph,
    filePaths: [],
    onProgress: options?.silent ? undefined : (phase, msg) => console.log(`  [${phase}] ${msg}`),
  };

  const phases = [scanPhase, structurePhase, parsePhase, resolvePhase, clusterPhase, flowPhase];
  const result = await runPipeline(phases, context);

  // Save metadata
  const repoName = path.basename(workspaceRoot);
  saveMetadata(workspaceRoot, {
    indexedAt: new Date().toISOString(),
    stats: {
      nodes: graph.size.nodes,
      edges: graph.size.edges,
      files: context.filePaths.length,
      duration: result.totalDuration,
    },
  });

  upsertRepo({
    name: repoName,
    path: workspaceRoot,
    indexedAt: new Date().toISOString(),
    stats: {
      nodes: graph.size.nodes,
      edges: graph.size.edges,
      files: context.filePaths.length,
    },
  });

  // Persist graph to LadybugDB
  try {
    const dbPath = getDbPath(workspaceRoot);
    const db = new DbManager(dbPath);
    await db.init();
    const { nodeCount, edgeCount } = await loadGraphToDB(graph, db);
    db.close();
    if (!options?.silent) {
      console.log(`  DB: ${nodeCount} nodes, ${edgeCount} edges persisted`);
    }
  } catch (err) {
    if (!options?.silent) {
      console.warn(`  DB persist warning: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Generate .claude/skills/code-intel/ skill files
  let skillSummaries: { name: string; label: string; symbolCount: number; fileCount: number }[] = [];
  try {
    const { skills } = await writeSkillFiles(graph, workspaceRoot, repoName);
    skillSummaries = skills;
    if (!options?.silent && skills.length > 0) {
      console.log(`  Skills: ${skills.length} generated → .claude/skills/code-intel/`);
    }
  } catch (err) {
    if (!options?.silent) {
      console.warn(`  Skills warning: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Write AGENTS.md + CLAUDE.md context blocks
  try {
    writeContextFiles(workspaceRoot, repoName, {
      nodes: graph.size.nodes,
      edges: graph.size.edges,
      files: context.filePaths.length,
      duration: result.totalDuration,
    }, skillSummaries);
    if (!options?.silent) {
      console.log(`  Context: AGENTS.md + CLAUDE.md updated`);
    }
  } catch (err) {
    if (!options?.silent) {
      console.warn(`  Context warning: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!options?.silent) {
    console.log(`\nDone in ${result.totalDuration}ms`);
    console.log(`  Nodes: ${graph.size.nodes}`);
    console.log(`  Edges: ${graph.size.edges}`);
    console.log(`  Files: ${context.filePaths.length}`);
    console.log(`  Success: ${result.success}`);
  }

  return { graph, result, repoName, workspaceRoot };
}

program
  .command('analyze')
  .description('Analyze a codebase and build the knowledge graph')
  .argument('[path]', 'Path to analyze', '.')
  .action(async (targetPath: string) => {
    await analyzeWorkspace(targetPath);
  });

program
  .command('serve')
  .description('Start the HTTP API server')
  .option('-p, --port <port>', 'Port number', '4747')
  .argument('[path]', 'Path to analyze', '.')
  .action(async (targetPath: string, options: { port: string }) => {
    const { graph, repoName, workspaceRoot } = await analyzeWorkspace(targetPath);
    startHttpServer(graph, repoName, parseInt(options.port, 10), workspaceRoot);
  });

program
  .command('mcp')
  .description('Start MCP server (stdio transport)')
  .argument('[path]', 'Path to analyze', '.')
  .action(async (targetPath: string) => {
    const { graph, repoName } = await analyzeWorkspace(targetPath, { silent: true });
    await startMcpStdio(graph, repoName);
  });

program
  .command('search')
  .description('Search the knowledge graph')
  .argument('<query>', 'Search query')
  .option('-l, --limit <limit>', 'Max results', '20')
  .option('-p, --path <path>', 'Path to analyze', '.')
  .action(async (query: string, options: { limit: string; path: string }) => {
    const { graph } = await analyzeWorkspace(options.path, { silent: true });
    const results = textSearch(graph, query, parseInt(options.limit, 10));
    if (results.length === 0) {
      console.log('No results found.');
      return;
    }
    console.log(`Found ${results.length} results for "${query}":\n`);
    for (const r of results) {
      console.log(`  ${r.kind.padEnd(12)} ${r.name.padEnd(30)} ${r.filePath}`);
    }
  });

program
  .command('inspect')
  .description('Inspect a symbol')
  .argument('<symbol>', 'Symbol name')
  .option('-p, --path <path>', 'Path to analyze', '.')
  .action(async (symbol: string, options: { path: string }) => {
    const { graph } = await analyzeWorkspace(options.path, { silent: true });

    let found = false;
    for (const node of graph.allNodes()) {
      if (node.name === symbol) {
        found = true;
        console.log(`\n${node.kind}: ${node.name}`);
        console.log(`  File: ${node.filePath}:${node.startLine ?? '?'}`);
        console.log(`  Exported: ${node.exported ?? 'unknown'}`);

        const incoming = [...graph.findEdgesTo(node.id)];
        const outgoing = [...graph.findEdgesFrom(node.id)];

        const callers = incoming.filter((e) => e.kind === 'calls');
        const callees = outgoing.filter((e) => e.kind === 'calls');

        if (callers.length > 0) {
          console.log(`  Callers (${callers.length}):`);
          for (const c of callers.slice(0, 10)) {
            const n = graph.getNode(c.source);
            console.log(`    ← ${n?.name ?? c.source} (${n?.filePath})`);
          }
        }
        if (callees.length > 0) {
          console.log(`  Callees (${callees.length}):`);
          for (const c of callees.slice(0, 10)) {
            const n = graph.getNode(c.target);
            console.log(`    → ${n?.name ?? c.target} (${n?.filePath})`);
          }
        }
        break;
      }
    }

    if (!found) console.log(`Symbol "${symbol}" not found.`);
  });

program
  .command('impact')
  .description('Show blast radius for a symbol')
  .argument('<symbol>', 'Symbol name')
  .option('-p, --path <path>', 'Path to analyze', '.')
  .option('-d, --depth <depth>', 'Max hops', '5')
  .action(async (symbol: string, options: { path: string; depth: string }) => {
    const { graph } = await analyzeWorkspace(options.path, { silent: true });
    const maxHops = parseInt(options.depth, 10);

    let targetNode = null;
    for (const node of graph.allNodes()) {
      if (node.name === symbol) { targetNode = node; break; }
    }
    if (!targetNode) { console.log(`Symbol "${symbol}" not found.`); return; }

    const affected = new Set<string>();
    const queue: { id: string; depth: number }[] = [{ id: targetNode.id, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxHops) continue;
      visited.add(id);
      affected.add(id);
      for (const edge of graph.findEdgesTo(id)) {
        if (edge.kind === 'calls' || edge.kind === 'imports') {
          queue.push({ id: edge.source, depth: depth + 1 });
        }
      }
    }

    console.log(`\nBlast radius for "${symbol}": ${affected.size} affected symbols\n`);
    for (const id of affected) {
      const n = graph.getNode(id);
      if (n) console.log(`  ${n.kind.padEnd(12)} ${n.name.padEnd(30)} ${n.filePath}`);
    }
  });

program
  .command('list')
  .description('List indexed repositories')
  .action(() => {
    const repos = loadRegistry();
    if (repos.length === 0) {
      console.log('No indexed repositories. Run `code-intel analyze <path>` first.');
      return;
    }
    console.log(`\nIndexed repositories (${repos.length}):\n`);
    for (const r of repos) {
      console.log(`  ${r.name.padEnd(25)} ${r.stats.nodes} nodes, ${r.stats.edges} edges, ${r.stats.files} files`);
      console.log(`    Path: ${r.path}`);
      console.log(`    Indexed: ${r.indexedAt}`);
    }
  });

program
  .command('status')
  .description('Show index status for current directory')
  .argument('[path]', 'Path to check', '.')
  .action((targetPath: string) => {
    const workspaceRoot = path.resolve(targetPath);
    const meta = loadMetadata(workspaceRoot);
    if (!meta) {
      console.log('Not indexed. Run `code-intel analyze` first.');
      return;
    }
    console.log(`\nIndex status for ${workspaceRoot}:`);
    console.log(`  Indexed at: ${meta.indexedAt}`);
    console.log(`  Nodes: ${meta.stats.nodes}`);
    console.log(`  Edges: ${meta.stats.edges}`);
    console.log(`  Files: ${meta.stats.files}`);
    console.log(`  Duration: ${meta.stats.duration}ms`);
  });

program
  .command('clean')
  .description('Remove index data')
  .argument('[path]', 'Path to clean', '.')
  .action((targetPath: string) => {
    const workspaceRoot = path.resolve(targetPath);
    const codeIntelDir = path.join(workspaceRoot, '.code-intel');
    if (fs.existsSync(codeIntelDir)) {
      fs.rmSync(codeIntelDir, { recursive: true, force: true });
      console.log(`Removed ${codeIntelDir}`);
    }
    removeRepo(workspaceRoot);
    console.log('Index cleaned.');
  });

program.parse();
