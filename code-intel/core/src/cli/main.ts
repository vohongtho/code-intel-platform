#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Resolve package.json relative to the built CLI file (dist/cli/main.js → ../../package.json)
const _pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string };

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
import {
  loadGroup,
  saveGroup,
  listGroups,
  deleteGroup,
  groupExists,
  addMember,
  removeMember,
  saveSyncResult,
  loadSyncResult,
} from '../multi-repo/group-registry.js';
import { syncGroup } from '../multi-repo/group-sync.js';
import { queryGroup } from '../multi-repo/group-query.js';

const program = new Command();

program
  .name('code-intel')
  .description('Code Intelligence Platform — Static Analysis + Knowledge Graph')
  .version(_pkg.version);

async function analyzeWorkspace(targetPath: string, options?: {
  silent?: boolean;
  force?: boolean;
  skills?: boolean;
  skipEmbeddings?: boolean;
  skipAgentsMd?: boolean;
  skipGit?: boolean;
  embeddings?: boolean;
  verbose?: boolean;
}) {
  const workspaceRoot = path.resolve(targetPath);
  if (!options?.silent) console.log(`Analyzing: ${workspaceRoot}`);

  // --skip-git: skip the .git check (allow non-git folders)
  if (!options?.skipGit) {
    const gitDir = path.join(workspaceRoot, '.git');
    if (!fs.existsSync(gitDir)) {
      console.warn(`  Warning: ${workspaceRoot} is not a Git repository. Use --skip-git to suppress this warning.`);
    }
  }

  const graph = createKnowledgeGraph();
  const context: PipelineContext = {
    workspaceRoot,
    graph,
    filePaths: [],
    verbose: options?.verbose,
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

  // Vector embeddings (opt-in or --embeddings, skip if --skip-embeddings)
  const doEmbeddings = options?.embeddings && !options?.skipEmbeddings;
  if (doEmbeddings) {
    if (!options?.silent) console.log('  Embeddings: building vector index…');
    try {
      const { embedNodes } = await import('../search/embedder.js');
      const { getVectorDbPath } = await import('../storage/index.js');
      const { VectorIndex } = await import('../search/vector-index.js');
      const vdbPath = getVectorDbPath(workspaceRoot);
      const vdb = new DbManager(vdbPath);
      await vdb.init();
      const idx = new VectorIndex(vdb);
      await idx.init();
      const nodes = await embedNodes(graph, {
        onProgress: (done, total) => {
          if (!options?.silent) process.stdout.write(`\r  [vector] ${done}/${total}`);
        },
      });
      if (!options?.silent) console.log('');
      await idx.buildIndex(nodes);
      if (!options?.silent) console.log(`  Embeddings: ${nodes.length} vectors built`);
      vdb.close();
    } catch (err) {
      if (!options?.silent) {
        console.warn(`  Embeddings warning: ${err instanceof Error ? err.message : err}`);
      }
    }
  } else if (!options?.skipEmbeddings && !options?.silent) {
    console.log('  Embeddings: skipped (use --embeddings to enable)');
  }

  // Generate .claude/skills/code-intel/ skill files (always, unless --skills was set to false)
  const doSkills = options?.skills !== false;
  let skillSummaries: { name: string; label: string; symbolCount: number; fileCount: number }[] = [];
  if (doSkills) {
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
  }

  // Write AGENTS.md + CLAUDE.md context blocks
  if (!options?.skipAgentsMd) {
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

// ─── 1. setup ────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Configure MCP server for your editors (one-time setup)')
  .action(() => {
    const configDir = process.env.HOME ? `${process.env.HOME}/.config/claude` : null;

    console.log('\n📡 Code Intelligence MCP Setup\n');
    console.log('Add the following to your editor MCP configuration:\n');

    const mcpConfig = {
      mcpServers: {
        'code-intel': {
          command: 'npx',
          args: ['@vohongtho.infotech/code-intel', 'mcp', '.'],
        },
      },
    };

    console.log('For Claude Desktop / Claude Code (~/.config/claude/claude_desktop_config.json):');
    console.log(JSON.stringify(mcpConfig, null, 2));

    if (configDir) {
      const configFile = `${configDir}/claude_desktop_config.json`;
      try {
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(configFile)) {
          existing = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as Record<string, unknown>;
        }
        const merged = {
          ...existing,
          mcpServers: {
            ...(existing.mcpServers as Record<string, unknown> ?? {}),
            ...mcpConfig.mcpServers,
          },
        };
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(configFile, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
        console.log(`\n✅ Written to ${configFile}`);
      } catch (err) {
        console.warn(`\n⚠ Could not auto-write config: ${err instanceof Error ? err.message : err}`);
        console.log('Please add the config above manually.');
      }
    }

    console.log('\nFor VS Code (settings.json or .vscode/mcp.json), use the same mcpServers block.');
    console.log('\nThen run `code-intel analyze` in your project to index it.\n');
  });

// ─── 2. analyze ──────────────────────────────────────────────────────────────
program
  .command('analyze')
  .description('Index a repository (or update stale index)')
  .argument('[path]', 'Path to analyze', '.')
  .option('--force',              'Force full re-index even if already indexed')
  .option('--skills',             'Generate repo-specific skill files from detected communities')
  .option('--skip-embeddings',    'Skip embedding generation (faster)')
  .option('--skip-agents-md',     'Preserve custom AGENTS.md/CLAUDE.md code-intel section edits')
  .option('--skip-git',           'Index folders that are not Git repositories')
  .option('--embeddings',         'Enable embedding generation (slower, better search)')
  .option('--verbose',            'Log skipped files when parsers are unavailable')
  .addHelpText('after', `
Examples:
  code-intel analyze                       Index current directory
  code-intel analyze ./my-project          Index a specific path
  code-intel analyze --force               Force full re-index
  code-intel analyze --skills              Also generate .claude/skills/ files
  code-intel analyze --skip-embeddings     Skip vector embeddings (faster)
  code-intel analyze --skip-agents-md      Preserve custom AGENTS.md edits
  code-intel analyze --skip-git            Allow non-Git folders
  code-intel analyze --embeddings          Enable vector embeddings
  code-intel analyze --verbose             Show skipped files`)
  .action(async (targetPath: string, opts: {
    force?: boolean;
    skills?: boolean;
    skipEmbeddings?: boolean;
    skipAgentsMd?: boolean;
    skipGit?: boolean;
    embeddings?: boolean;
    verbose?: boolean;
  }) => {
    await analyzeWorkspace(targetPath, {
      force: opts.force,
      skills: opts.skills,
      skipEmbeddings: opts.skipEmbeddings,
      skipAgentsMd: opts.skipAgentsMd,
      skipGit: opts.skipGit,
      embeddings: opts.embeddings,
      verbose: opts.verbose,
    });
  });

// ─── 3. mcp ──────────────────────────────────────────────────────────────────
program
  .command('mcp')
  .description('Start MCP server (stdio) — serves all indexed repos')
  .argument('[path]', 'Path to analyze', '.')
  .action(async (targetPath: string) => {
    const { graph, repoName } = await analyzeWorkspace(targetPath, { silent: true });
    await startMcpStdio(graph, repoName);
  });

// ─── 4. serve ────────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start local HTTP server + web UI (http://localhost:4747)')
  .argument('[path]', 'Path to analyze', '.')
  .option('-p, --port <port>', 'Port number', '4747')
  .action(async (targetPath: string, options: { port: string }) => {
    const { graph, repoName, workspaceRoot } = await analyzeWorkspace(targetPath);
    startHttpServer(graph, repoName, parseInt(options.port, 10), workspaceRoot);
  });

// ─── 5. list ─────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all indexed repositories')
  .action(() => {
    const repos = loadRegistry();
    if (repos.length === 0) {
      console.log('No indexed repositories. Run `code-intel analyze <path>` first.');
      return;
    }
    console.log(`\nIndexed repositories (${repos.length}):\n`);
    for (const r of repos) {
      console.log(`  ${r.name.padEnd(25)} ${r.stats.nodes} nodes, ${r.stats.edges} edges, ${r.stats.files} files`);
      console.log(`    Path:    ${r.path}`);
      console.log(`    Indexed: ${r.indexedAt}`);
    }
  });

// ─── 6. status ───────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show index status for current repo')
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
    console.log(`  Nodes:      ${meta.stats.nodes}`);
    console.log(`  Edges:      ${meta.stats.edges}`);
    console.log(`  Files:      ${meta.stats.files}`);
    console.log(`  Duration:   ${meta.stats.duration}ms`);
  });

// ─── 7. clean ────────────────────────────────────────────────────────────────
program
  .command('clean')
  .description('Delete index for current repo (or all repos with --all --force)')
  .argument('[path]', 'Path to clean', '.')
  .option('--all',   'Clean all indexed repositories')
  .option('--force', 'Required with --all to confirm destructive operation')
  .action((targetPath: string, opts: { all?: boolean; force?: boolean }) => {
    if (opts.all) {
      if (!opts.force) {
        console.error('Error: --all requires --force to confirm. Run: code-intel clean --all --force');
        process.exit(1);
      }
      const repos = loadRegistry();
      if (repos.length === 0) {
        console.log('No indexed repositories to clean.');
        return;
      }
      for (const r of repos) {
        const codeIntelDir = path.join(r.path, '.code-intel');
        if (fs.existsSync(codeIntelDir)) {
          fs.rmSync(codeIntelDir, { recursive: true, force: true });
          console.log(`  Removed ${codeIntelDir}`);
        }
        removeRepo(r.path);
      }
      console.log(`\nCleaned ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}.`);
      return;
    }

    const workspaceRoot = path.resolve(targetPath);
    const codeIntelDir = path.join(workspaceRoot, '.code-intel');
    if (fs.existsSync(codeIntelDir)) {
      fs.rmSync(codeIntelDir, { recursive: true, force: true });
      console.log(`Removed ${codeIntelDir}`);
    }
    removeRepo(workspaceRoot);
    console.log('Index cleaned.');
  });

// ─── 8. search ───────────────────────────────────────────────────────────────
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

// ─── 9. inspect ──────────────────────────────────────────────────────────────
program
  .command('inspect')
  .description('Inspect a symbol: callers, callees, location')
  .argument('<symbol>', 'Symbol name')
  .option('-p, --path <path>', 'Path to analyze', '.')
  .action(async (symbol: string, options: { path: string }) => {
    const { graph } = await analyzeWorkspace(options.path, { silent: true });

    let found = false;
    for (const node of graph.allNodes()) {
      if (node.name === symbol) {
        found = true;
        console.log(`\n${node.kind}: ${node.name}`);
        console.log(`  File:     ${node.filePath}:${node.startLine ?? '?'}`);
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

// ─── 10. impact ──────────────────────────────────────────────────────────────
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

// ─── 11. group ───────────────────────────────────────────────────────────────
const groupCmd = program
  .command('group')
  .description('Manage repository groups (multi-repo / monorepo service tracking)');

// group create <name>
groupCmd
  .command('create <name>')
  .description('Create a repository group')
  .action((name: string) => {
    if (groupExists(name)) {
      console.error(`Error: Group "${name}" already exists.`);
      process.exit(1);
    }
    saveGroup({ name, createdAt: new Date().toISOString(), members: [] });
    console.log(`✅ Group "${name}" created.`);
  });

// group add <group> <groupPath> <registryName>
groupCmd
  .command('add <group> <groupPath> <registryName>')
  .description('Add a repo to a group. <groupPath> is a hierarchy path (e.g. hr/hiring/backend); <registryName> is from `code-intel list`')
  .action((group: string, groupPath: string, registryName: string) => {
    // Validate the registry entry exists
    const registry = loadRegistry();
    const regEntry = registry.find((r) => r.name === registryName);
    if (!regEntry) {
      console.error(`Error: Registry entry "${registryName}" not found. Run \`code-intel list\` to see available repos.`);
      process.exit(1);
    }
    if (!groupExists(group)) {
      console.error(`Error: Group "${group}" does not exist. Create it first with \`code-intel group create ${group}\`.`);
      process.exit(1);
    }
    addMember(group, { groupPath, registryName });
    console.log(`✅ Added "${registryName}" to group "${group}" at path "${groupPath}".`);
  });

// group remove <group> <groupPath>
groupCmd
  .command('remove <group> <groupPath>')
  .description('Remove a repo from a group by its hierarchy path')
  .action((group: string, groupPath: string) => {
    if (!groupExists(group)) {
      console.error(`Error: Group "${group}" does not exist.`);
      process.exit(1);
    }
    try {
      removeMember(group, groupPath);
      console.log(`✅ Removed member at path "${groupPath}" from group "${group}".`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// group list [name]
groupCmd
  .command('list [name]')
  .description('List all groups, or show one group\'s config')
  .action((name?: string) => {
    if (name) {
      const group = loadGroup(name);
      if (!group) {
        console.error(`Error: Group "${name}" not found.`);
        process.exit(1);
      }
      console.log(`\nGroup: ${group.name}`);
      console.log(`Created: ${group.createdAt}`);
      if (group.lastSync) console.log(`Last sync: ${group.lastSync}`);
      console.log(`\nMembers (${group.members.length}):`);
      if (group.members.length === 0) {
        console.log('  (none — use `code-intel group add` to add repos)');
      } else {
        for (const m of group.members) {
          console.log(`  ${m.groupPath.padEnd(35)} → ${m.registryName}`);
        }
      }
    } else {
      const groups = listGroups();
      if (groups.length === 0) {
        console.log('No groups found. Create one with `code-intel group create <name>`.');
        return;
      }
      console.log(`\nRepository groups (${groups.length}):\n`);
      for (const g of groups) {
        const sync = g.lastSync ? `synced ${g.lastSync}` : 'not synced';
        console.log(`  ${g.name.padEnd(25)} ${g.members.length} member(s)  [${sync}]`);
      }
    }
  });

// group sync <name>
groupCmd
  .command('sync <name>')
  .description('Extract contracts and match across repos/services in a group')
  .action(async (name: string) => {
    const group = loadGroup(name);
    if (!group) {
      console.error(`Error: Group "${name}" not found.`);
      process.exit(1);
    }
    if (group.members.length === 0) {
      console.error(`Error: Group "${name}" has no members. Add repos with \`code-intel group add\`.`);
      process.exit(1);
    }

    console.log(`\n🔄 Syncing group "${name}" (${group.members.length} member(s))…\n`);
    const result = await syncGroup(group);

    // Persist sync result and update lastSync timestamp
    saveSyncResult(result);
    group.lastSync = result.syncedAt;
    saveGroup(group);

    console.log(`\n✅ Sync complete:`);
    console.log(`   Repos synced:  ${result.memberCount}`);
    console.log(`   Contracts:     ${result.contracts.length}`);
    console.log(`   Cross-links:   ${result.links.length}`);

    if (result.links.length > 0) {
      console.log(`\nTop cross-repo links:`);
      for (const link of result.links.slice(0, 10)) {
        const conf = (link.confidence * 100).toFixed(0).padStart(3);
        console.log(`  ${conf}%  ${link.providerRepo} ∷ ${link.providerContract.padEnd(30)} ↔  ${link.consumerRepo} ∷ ${link.consumerContract}`);
      }
      if (result.links.length > 10) {
        console.log(`  … and ${result.links.length - 10} more. Run \`code-intel group contracts ${name}\` for full details.`);
      }
    }
  });

// group contracts <name>
groupCmd
  .command('contracts <name>')
  .description('Inspect extracted contracts and cross-links from the last sync')
  .option('--kind <kind>', 'Filter by contract kind: export | route | schema | event')
  .option('--repo <repo>', 'Filter by registry name')
  .option('--min-confidence <pct>', 'Minimum link confidence 0-100 (default: 0)', '0')
  .action((name: string, opts: { kind?: string; repo?: string; minConfidence: string }) => {
    const result = loadSyncResult(name);
    if (!result) {
      console.error(`No sync data for group "${name}". Run \`code-intel group sync ${name}\` first.`);
      process.exit(1);
    }

    const minConf = parseInt(opts.minConfidence, 10) / 100;

    let contracts = result.contracts;
    if (opts.kind) contracts = contracts.filter((c) => c.kind === opts.kind);
    if (opts.repo) contracts = contracts.filter((c) => c.repoName === opts.repo);

    let links = result.links.filter((l) => l.confidence >= minConf);
    if (opts.repo) links = links.filter((l) => l.providerRepo === opts.repo || l.consumerRepo === opts.repo);

    console.log(`\n📦 Group "${name}" — synced ${result.syncedAt}\n`);

    console.log(`Contracts (${contracts.length}):`);
    for (const c of contracts) {
      const sig = c.signature ? `  ${c.signature.slice(0, 60)}` : '';
      console.log(`  [${c.kind.padEnd(6)}] ${c.repoName.padEnd(20)} ${c.name.padEnd(35)}${sig}`);
    }

    console.log(`\nCross-repo links (${links.length}):`);
    if (links.length === 0) {
      console.log('  (none)');
    } else {
      for (const link of links) {
        const conf = (link.confidence * 100).toFixed(0).padStart(3);
        console.log(`  ${conf}%  [${link.matchKind}]  ${link.providerRepo} ∷ ${link.providerContract.padEnd(30)} ↔  ${link.consumerRepo} ∷ ${link.consumerContract}`);
      }
    }
  });

// group query <name> <q>
groupCmd
  .command('query <name> <q>')
  .description('Search execution flows across all repos in a group')
  .option('-l, --limit <limit>', 'Max results per repo', '10')
  .action(async (name: string, q: string, opts: { limit: string }) => {
    const group = loadGroup(name);
    if (!group) {
      console.error(`Error: Group "${name}" not found.`);
      process.exit(1);
    }

    console.log(`\n🔍 Querying group "${name}" for: "${q}"\n`);
    const limit = parseInt(opts.limit, 10);
    const { perRepo, merged } = await queryGroup(group, q, limit);

    if (merged.length === 0) {
      console.log('No results found across any repo in this group.');
      return;
    }

    console.log(`Merged results (${merged.length} total, ranked by Reciprocal Rank Fusion):\n`);
    for (const r of merged) {
      console.log(`  ${r.kind.padEnd(12)} ${r.name.padEnd(30)} ${r.filePath}`);
      if (r.snippet) console.log(`             ${r.snippet.slice(0, 100)}`);
    }

    console.log(`\nPer-repo breakdown:`);
    for (const rr of perRepo) {
      console.log(`  ${rr.repoName} (${rr.groupPath}): ${rr.results.length} result(s)`);
    }
  });

// group status <name>
groupCmd
  .command('status <name>')
  .description('Check staleness of repos in a group')
  .action((name: string) => {
    const group = loadGroup(name);
    if (!group) {
      console.error(`Error: Group "${name}" not found.`);
      process.exit(1);
    }

    const registry = loadRegistry();
    const now = Date.now();

    console.log(`\n📊 Group "${name}" status\n`);
    if (group.lastSync) {
      const age = Math.round((now - new Date(group.lastSync).getTime()) / 60000);
      console.log(`Last sync: ${group.lastSync} (${age} min ago)`);
    } else {
      console.log('Last sync: never  (run `code-intel group sync ' + name + '`)');
    }
    console.log(`\nMembers (${group.members.length}):\n`);

    for (const m of group.members) {
      const regEntry = registry.find((r) => r.name === m.registryName);
      if (!regEntry) {
        console.log(`  ✗ ${m.groupPath.padEnd(35)} [${m.registryName}]  — NOT IN REGISTRY`);
        continue;
      }

      const metaPath = path.join(regEntry.path, '.code-intel', 'meta.json');
      let indexedAt = regEntry.indexedAt;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { indexedAt: string; stats: { nodes: number; edges: number; files: number } };
        indexedAt = meta.indexedAt;
        const ageMin = Math.round((now - new Date(indexedAt).getTime()) / 60000);
        const stale = ageMin > 1440 ? ' ⚠ STALE (>24h)' : '';
        console.log(`  ✓ ${m.groupPath.padEnd(35)} [${m.registryName}]  indexed ${indexedAt} (${ageMin} min ago)${stale}`);
        console.log(`    ${regEntry.path}`);
        console.log(`    ${meta.stats.nodes} nodes, ${meta.stats.edges} edges, ${meta.stats.files} files`);
      } catch {
        console.log(`  ✗ ${m.groupPath.padEnd(35)} [${m.registryName}]  — NOT INDEXED  (run: code-intel analyze ${regEntry.path})`);
      }
    }
  });

program.parse();
