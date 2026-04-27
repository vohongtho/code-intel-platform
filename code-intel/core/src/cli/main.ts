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
import Logger from '../shared/logger.js';
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

const BANNER = `
  ◈  Code Intelligence Platform  v${_pkg.version}
  ──────────────────────────────────────────────────────────────────────────────
  Build a Knowledge Graph from source code and explore it via Web UI, HTTP API,
  CLI, and MCP server. Supports 14+ languages. Zero config.
  ──────────────────────────────────────────────────────────────────────────────
`;

program
  .name('code-intel')
  .description('Code Intelligence Platform — Static Analysis + Knowledge Graph')
  .version(_pkg.version)
  .addHelpText('beforeAll', BANNER)
  .addHelpText('after', `
  ┌─ Quick Start ────────────────────────────────────────────────────────────┐
  │                                                                          │
  │  code-intel setup                  Configure MCP for your editors        │
  │  code-intel analyze                Index current directory               │
  │  code-intel serve                  Start web UI at http://localhost:4747  │
  │  code-intel search "query"         Search the knowledge graph            │
  │  code-intel inspect <symbol>       Inspect a symbol's connections        │
  │  code-intel impact <symbol>        Show blast radius for a symbol        │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  ┌─ All Commands ─────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                                                    │
  │  setup                                                                                                             │
  │    code-intel setup                         Register the MCP server in your editor config (one-time)              │
  │                                                                                                                    │
  │  analyze                                                                                                           │
  │    code-intel analyze [path]                Parse source code and build the knowledge graph                        │
  │    code-intel analyze --force               Discard the existing index and perform a full re-analysis             │
  │    code-intel analyze --skills              Emit per-cluster SKILL.md files under .claude/skills/code-intel/      │
  │    code-intel analyze --embeddings          Build a vector index for semantic (natural-language) search           │
  │    code-intel analyze --skip-embeddings     Omit embedding generation for a significantly faster run             │
  │    code-intel analyze --skip-agents-md      Preserve any hand-edited content in AGENTS.md / CLAUDE.md            │
  │    code-intel analyze --skip-git            Allow analysis of directories that are not Git repositories           │
  │    code-intel analyze --verbose             Print every file skipped due to an unsupported parser                 │
  │                                                                                                                    │
  │  server                                                                                                            │
  │    code-intel mcp [path]                    Launch the MCP stdio server consumed by AI-enabled editors            │
  │    code-intel serve [path] --port <n>       Start the HTTP API and serve the interactive web UI (default :4747)   │
  │                                                                                                                    │
  │  registry                                                                                                          │
  │    code-intel list                          Display all repositories that have been indexed                       │
  │    code-intel status [path]                 Report index freshness, symbol counts, and last-run duration          │
  │    code-intel clean [path]                  Remove the .code-intel/ index for the specified repository            │
  │    code-intel clean --all --force           Permanently remove all indexed repositories (requires --force)        │
  │                                                                                                                    │
  │  exploration                                                                                                       │
  │    code-intel search <query>                Execute a BM25 keyword search across all indexed symbols              │
  │    code-intel inspect <symbol>              Show callers, callees, import edges, and source location              │
  │    code-intel impact <symbol>               Compute the transitive blast radius of a change to a symbol           │
  │                                                                                                                    │
  │  groups  (multi-repo / monorepo service tracking)                                                                  │
  │    code-intel group create <name>           Create a named group to track multiple repositories together          │
  │    code-intel group add <g> <path> <repo>   Enroll an indexed repo in a group under the given hierarchy path     │
  │    code-intel group remove <g> <path>       Remove a repository from a group by its hierarchy path               │
  │    code-intel group list [name]             List all groups, or print the full membership of one group            │
  │    code-intel group sync <name>             Extract cross-repo contracts and resolve provider/consumer links      │
  │    code-intel group contracts <name>        Inspect extracted contracts and confidence-ranked cross-links         │
  │    code-intel group query <name> <q>        Run a merged RRF search across every repository in a group           │
  │    code-intel group status <name>           Audit index freshness and sync staleness for all group members        │
  │                                                                                                                    │
  └────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Multi-language: TypeScript · JavaScript · Python · Java · Go · Rust · C/C++
                  C# · PHP · Kotlin · Ruby · Swift · Dart

  Docs: https://github.com/vohongtho/code-intel-platform
`);

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
  Logger.info(`analyze started: ${workspaceRoot}`);

  // --skip-git: skip the .git check (allow non-git folders)
  if (!options?.skipGit) {
    const gitDir = path.join(workspaceRoot, '.git');
    if (!fs.existsSync(gitDir)) {
      Logger.warn(`${workspaceRoot} is not a Git repository`);
    }
  }

  const graph = createKnowledgeGraph();

  // ── Progress bar + spinner helpers ───────────────────────────────────────
  const BAR_WIDTH = 30;
  let currentPhase = '';
  function renderBar(phase: string, done: number, total: number): void {
    const pct = total > 0 ? done / total : 1;
    const filled = Math.round(pct * BAR_WIDTH);
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    const pctStr = (pct * 100).toFixed(0).padStart(3);
    process.stdout.write(`\r  [${phase.padEnd(9)}] ${bar} ${pctStr}% (${done}/${total})`);
  }
  function clearBar(): void {
    process.stdout.write('\r' + ' '.repeat(70) + '\r');
  }

  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerIdx = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;
  function startSpinner(label: string): void {
    if (options?.silent) return;
    spinnerIdx = 0;
    spinnerTimer = setInterval(() => {
      process.stdout.write(`\r  ${SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length]} ${label}…`);
      spinnerIdx++;
    }, 80);
  }
  function stopSpinner(): void {
    if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
  }

  const context: PipelineContext = {
    workspaceRoot,
    graph,
    filePaths: [],
    verbose: options?.verbose,
    onProgress: options?.silent ? undefined : (phase, msg) => {
      if (!options?.silent) {
        if (currentPhase) clearBar();
        console.log(`  [${phase}] ${msg}`);
        currentPhase = '';
      }
    },
    onPhaseProgress: options?.silent ? undefined : (phase, done, total) => {
      currentPhase = phase;
      renderBar(phase, done, total);
      if (done >= total) {
        clearBar();
        currentPhase = '';
      }
    },
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
  startSpinner('Persisting graph to DB');
  try {
    const dbPath = getDbPath(workspaceRoot);
    // Remove stale / incompatible DB files before writing
    const staleFiles = [dbPath, `${dbPath}-shm`, `${dbPath}-wal`];
    for (const f of staleFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
    const db = new DbManager(dbPath);
    await db.init();
    const { nodeCount, edgeCount } = await loadGraphToDB(graph, db);
    db.close();
    stopSpinner();
    Logger.info(`DB persisted: ${nodeCount} nodes, ${edgeCount} edges`);
    if (!options?.silent) {
      console.log(`  ✓ DB: ${nodeCount} nodes, ${edgeCount} edges persisted`);
    }
  } catch (err) {
    stopSpinner();
    Logger.warn(`DB persist failed: ${err instanceof Error ? err.message : err}`);
  }

  // Vector embeddings (opt-in or --embeddings, skip if --skip-embeddings)
  const doEmbeddings = options?.embeddings && !options?.skipEmbeddings;
  if (doEmbeddings) {
    startSpinner('Building vector embeddings');
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
          if (!options?.silent) {
            stopSpinner();
            renderBar('vector', done, total);
            if (done >= total) clearBar();
          }
        },
      });
      stopSpinner();
      Logger.info(`Embeddings built: ${nodes.length} vectors`);
      await idx.buildIndex(nodes);
      if (!options?.silent) console.log(`  ✓ Embeddings: ${nodes.length} vectors built`);
      vdb.close();
    } catch (err) {
      stopSpinner();
      Logger.warn(`Embeddings failed: ${err instanceof Error ? err.message : err}`);
    }
  } else if (!options?.skipEmbeddings && !options?.silent) {
    console.log('  Embeddings: skipped (use --embeddings to enable)');
  }

  // Generate .claude/skills/code-intel/ skill files (always, unless --skills was set to false)
  const doSkills = options?.skills !== false;
  let skillSummaries: { name: string; label: string; symbolCount: number; fileCount: number }[] = [];
  if (doSkills) {
    startSpinner('Generating skill files');
    try {
      const { skills } = await writeSkillFiles(graph, workspaceRoot, repoName);
      skillSummaries = skills;
      stopSpinner();
      Logger.info(`Skills generated: ${skills.length}`);
      if (!options?.silent && skills.length > 0) {
        console.log(`  ✓ Skills: ${skills.length} generated → .claude/skills/code-intel/`);
      }
    } catch (err) {
      stopSpinner();
      Logger.warn(`Skills generation failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Write AGENTS.md + CLAUDE.md context blocks
  if (!options?.skipAgentsMd) {
    startSpinner('Writing context files');
    try {
      writeContextFiles(workspaceRoot, repoName, {
        nodes: graph.size.nodes,
        edges: graph.size.edges,
        files: context.filePaths.length,
        duration: result.totalDuration,
      }, skillSummaries);
      stopSpinner();
      Logger.info('Context files written: AGENTS.md + CLAUDE.md');
      if (!options?.silent) {
        console.log(`  ✓ Context: AGENTS.md + CLAUDE.md updated`);
      }
    } catch (err) {
      stopSpinner();
      Logger.warn(`Context file write failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!options?.silent) {
    const dur = result.totalDuration;
    const durStr = dur >= 1000 ? `${(dur / 1000).toFixed(1)}s` : `${dur}ms`;
    console.log(`\n  ✅  Done in ${durStr}  —  ${graph.size.nodes} nodes · ${graph.size.edges} edges · ${context.filePaths.length} files`);
  }
  Logger.info(`analyze complete: ${graph.size.nodes} nodes, ${graph.size.edges} edges, ${context.filePaths.length} files, ${result.totalDuration}ms`);

  return { graph, result, repoName, workspaceRoot };
}

// ─── 1. setup ────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Configure MCP server for your editors (one-time setup)')
  .addHelpText('after', `
  Configure the code-intel MCP server for Claude Desktop, VS Code, or any
  editor that supports the Model Context Protocol.

  Auto-writes to ~/.config/claude/claude_desktop_config.json when available.

  Examples:
    $ code-intel setup
`)
  .action(() => {
    const configDir = process.env.HOME ? `${process.env.HOME}/.config/claude` : null;

    console.log('\n  ◈  Code Intelligence — MCP Setup\n');
    console.log('  Add the following to your editor MCP configuration:\n');

    const mcpConfig = {
      mcpServers: {
        'code-intel': {
          command: 'npx',
          args: ['@vohongtho.infotech/code-intel', 'mcp', '.'],
        },
      },
    };

    console.log('  Claude Desktop / Claude Code  (~/.config/claude/claude_desktop_config.json)');
    console.log('  ' + JSON.stringify(mcpConfig, null, 2).split('\n').join('\n  '));

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
        console.log(`\n  ✅  Written to ${configFile}`);
      } catch (err) {
        Logger.warn(`\n  ⚠   Could not auto-write config: ${err instanceof Error ? err.message : err}`);
        console.log('  Please add the config above manually.');
      }
    }

    console.log('\n  VS Code / Cursor — add the same mcpServers block to settings.json or .vscode/mcp.json');
    console.log('\n  Next: run `code-intel analyze` inside your project to build the knowledge graph.\n');
  });

// ─── 2. analyze ──────────────────────────────────────────────────────────────
program
  .command('analyze')
  .description('Index a repository and build the knowledge graph')
  .argument('[path]', 'Path to the repository (default: current directory)', '.')
  .option('--force',             'Force full re-index, ignoring cached data')
  .option('--skills',            'Generate .claude/skills/ SKILL.md files from detected clusters')
  .option('--embeddings',        'Build vector embeddings for semantic search (slower, recommended)')
  .option('--skip-embeddings',   'Skip embedding generation (faster, text-search only)')
  .option('--skip-agents-md',    'Preserve any custom edits inside AGENTS.md / CLAUDE.md')
  .option('--skip-git',          'Allow indexing directories that are not Git repositories')
  .option('--verbose',           'Log every file skipped due to missing parser support')
  .addHelpText('after', `
  Parses your source code with tree-sitter, builds a Knowledge Graph of
  symbols and their relationships, persists it to .code-intel/graph.db,
  and auto-generates AGENTS.md + CLAUDE.md context blocks.

  Examples:
    $ code-intel analyze                        Index current directory
    $ code-intel analyze ./my-project           Index a specific path
    $ code-intel analyze --force                Force full re-index
    $ code-intel analyze --embeddings           Enable semantic (vector) search
    $ code-intel analyze --skills               Generate .claude/skills/ files
    $ code-intel analyze --skip-embeddings      Skip vectors for a faster run
    $ code-intel analyze --skip-agents-md       Preserve your custom AGENTS.md edits
    $ code-intel analyze --skip-git             Index a non-Git folder
    $ code-intel analyze --verbose              Show files skipped by the parser
`)
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
  .description('Start MCP server over stdio — exposes all tools to your AI editor')
  .argument('[path]', 'Path to analyze (default: current directory)', '.')
  .addHelpText('after', `
  Starts the Model Context Protocol server over stdio transport.
  Your editor (Claude Desktop, VS Code, Cursor, etc.) connects to it
  and gains access to search, inspect, blast-radius, and flow tools.

  Typically invoked automatically by your editor via the config from \`code-intel setup\`.

  Examples:
    $ code-intel mcp
    $ code-intel mcp ./my-project
`)
  .action(async (targetPath: string) => {
    const { graph, repoName, workspaceRoot } = await analyzeWorkspace(targetPath, { silent: true });
    await startMcpStdio(graph, repoName, workspaceRoot);
  });

// ─── 4. serve ────────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start the local HTTP server + web UI for graph exploration')
  .argument('[path]', 'Path to analyze (default: current directory)', '.')
  .option('-p, --port <port>', 'Port to listen on', '4747')
  .addHelpText('after', `
  Analyzes the repository, starts an HTTP server, and serves the interactive
  Web UI at http://localhost:<port>.

  The web UI offers:
    · Force-directed Knowledge Graph with color-coded node types
    · BM25 text search + optional semantic (vector) search
    · Node detail panel: callers, callees, blast radius, source preview
    · AI Code Chat grounded on your codebase
    · Multi-repo group view (if groups are configured)

  Examples:
    $ code-intel serve
    $ code-intel serve ./my-project
    $ code-intel serve --port 8080
`)
  .action(async (targetPath: string, options: { port: string }) => {
    const { graph, repoName, workspaceRoot } = await analyzeWorkspace(targetPath);
    startHttpServer(graph, repoName, parseInt(options.port, 10), workspaceRoot);
  });

// ─── 5. list ─────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all indexed repositories in the registry')
  .addHelpText('after', `
  Shows every repository that has been indexed with \`code-intel analyze\`.
  Useful for checking what is available before using \`code-intel group add\`.

  Examples:
    $ code-intel list
`)
  .action(() => {
    const repos = loadRegistry();
    if (repos.length === 0) {
      console.log('\n  No indexed repositories found.');
      console.log('  Run `code-intel analyze <path>` to index a project.\n');
      return;
    }
    console.log(`\n  Indexed repositories (${repos.length}):\n`);
    for (const r of repos) {
      console.log(`  ◆  ${r.name}`);
      console.log(`     Nodes:   ${r.stats.nodes}  ·  Edges: ${r.stats.edges}  ·  Files: ${r.stats.files}`);
      console.log(`     Path:    ${r.path}`);
      console.log(`     Indexed: ${r.indexedAt}\n`);
    }
  });

// ─── 6. status ───────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show index freshness and statistics for a repository')
  .argument('[path]', 'Path to check (default: current directory)', '.')
  .addHelpText('after', `
  Reads the metadata from .code-intel/meta.json and reports when the index
  was last built and how many symbols were found.

  Examples:
    $ code-intel status
    $ code-intel status ./my-project
`)
  .action((targetPath: string) => {
    const workspaceRoot = path.resolve(targetPath);
    const meta = loadMetadata(workspaceRoot);
    if (!meta) {
      console.log(`\n  ✗  ${workspaceRoot} is not indexed.`);
      console.log('     Run `code-intel analyze` to build the index.\n');
      return;
    }
    console.log(`\n  ◈  Index status — ${workspaceRoot}\n`);
    console.log(`     Indexed at : ${meta.indexedAt}`);
    console.log(`     Nodes      : ${meta.stats.nodes}`);
    console.log(`     Edges      : ${meta.stats.edges}`);
    console.log(`     Files      : ${meta.stats.files}`);
    console.log(`     Duration   : ${meta.stats.duration}ms\n`);
  });

// ─── 7. clean ────────────────────────────────────────────────────────────────
program
  .command('clean')
  .description('Remove the knowledge graph index for a repository')
  .argument('[path]', 'Path to clean (default: current directory)', '.')
  .option('--all',   'Remove indexes for ALL indexed repositories')
  .option('--force', 'Required with --all to confirm the destructive operation')
  .addHelpText('after', `
  Deletes the .code-intel/ directory and removes the entry from the registry.

  ⚠  --all --force is irreversible — it deletes every indexed repo's data.

  Examples:
    $ code-intel clean                   Remove index for current directory
    $ code-intel clean ./my-project      Remove index for a specific path
    $ code-intel clean --all --force     Remove ALL indexes (requires --force)
`)
  .action((targetPath: string, opts: { all?: boolean; force?: boolean }) => {
    if (opts.all) {
      if (!opts.force) {
        console.error('\n  ✗  --all requires --force to confirm the destructive operation.');
        console.error('     Run: code-intel clean --all --force\n');
        process.exit(1);
      }
      const repos = loadRegistry();
      if (repos.length === 0) {
        console.log('\n  No indexed repositories to clean.\n');
        return;
      }
      for (const r of repos) {
        const codeIntelDir = path.join(r.path, '.code-intel');
        if (fs.existsSync(codeIntelDir)) {
          fs.rmSync(codeIntelDir, { recursive: true, force: true });
          console.log(`  ✓  Removed ${codeIntelDir}`);
        }
        removeRepo(r.path);
      }
      console.log(`\n  Cleaned ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}.\n`);
      return;
    }

    const workspaceRoot = path.resolve(targetPath);
    const codeIntelDir = path.join(workspaceRoot, '.code-intel');
    if (fs.existsSync(codeIntelDir)) {
      fs.rmSync(codeIntelDir, { recursive: true, force: true });
      console.log(`\n  ✓  Removed ${codeIntelDir}`);
    }
    removeRepo(workspaceRoot);
    console.log('  Index cleaned.\n');
  });

// ─── 8. search ───────────────────────────────────────────────────────────────
program
  .command('search')
  .description('Search the knowledge graph for symbols matching a query')
  .argument('<query>', 'Search query (name, kind, or partial match)')
  .option('-l, --limit <n>', 'Maximum number of results', '20')
  .option('-p, --path <path>', 'Path to the repository (default: current directory)', '.')
  .addHelpText('after', `
  Runs BM25 text search across all indexed symbols — functions, classes,
  files, routes, interfaces, and more.

  Examples:
    $ code-intel search "handleRequest"
    $ code-intel search "auth" --limit 10
    $ code-intel search "UserService" --path ./backend
`)
  .action(async (query: string, options: { limit: string; path: string }) => {
    const { graph } = await analyzeWorkspace(options.path, { silent: true });
    const results = textSearch(graph, query, parseInt(options.limit, 10));
    if (results.length === 0) {
      console.log(`\n  No results found for "${query}".\n`);
      return;
    }
    console.log(`\n  ${results.length} result(s) for "${query}":\n`);
    for (const r of results) {
      console.log(`  ${r.kind.padEnd(14)} ${r.name.padEnd(32)} ${r.filePath}`);
    }
    console.log('');
  });

// ─── 9. inspect ──────────────────────────────────────────────────────────────
program
  .command('inspect')
  .description('Inspect a symbol — show callers, callees, file location, and export status')
  .argument('<symbol>', 'Exact symbol name to inspect')
  .option('-p, --path <path>', 'Path to the repository (default: current directory)', '.')
  .addHelpText('after', `
  Finds the symbol in the knowledge graph and prints its full connection
  profile: where it lives, who calls it, and what it calls.

  Use this before renaming a symbol to understand its blast radius.

  Examples:
    $ code-intel inspect runPipeline
    $ code-intel inspect ApiClient --path ./frontend
`)
  .action(async (symbol: string, options: { path: string }) => {
    const { graph } = await analyzeWorkspace(options.path, { silent: true });

    let found = false;
    for (const node of graph.allNodes()) {
      if (node.name === symbol) {
        found = true;
        console.log(`\n  ◆  ${node.kind}: ${node.name}`);
        console.log(`     File     : ${node.filePath}:${node.startLine ?? '?'}`);
        console.log(`     Exported : ${node.exported ?? 'unknown'}`);

        const incoming = [...graph.findEdgesTo(node.id)];
        const outgoing = [...graph.findEdgesFrom(node.id)];
        const callers = incoming.filter((e) => e.kind === 'calls');
        const callees = outgoing.filter((e) => e.kind === 'calls');

        if (callers.length > 0) {
          console.log(`\n     Callers (${callers.length}):`);
          for (const c of callers.slice(0, 10)) {
            const n = graph.getNode(c.source);
            console.log(`       ←  ${n?.name ?? c.source}  (${n?.filePath})`);
          }
          if (callers.length > 10) console.log(`       … and ${callers.length - 10} more`);
        }
        if (callees.length > 0) {
          console.log(`\n     Callees (${callees.length}):`);
          for (const c of callees.slice(0, 10)) {
            const n = graph.getNode(c.target);
            console.log(`       →  ${n?.name ?? c.target}  (${n?.filePath})`);
          }
          if (callees.length > 10) console.log(`       … and ${callees.length - 10} more`);
        }
        console.log('');
        break;
      }
    }

    if (!found) {
      console.log(`\n  Symbol "${symbol}" not found.`);
      console.log(`  Try: code-intel search "${symbol}"\n`);
    }
  });

// ─── 10. impact ──────────────────────────────────────────────────────────────
program
  .command('impact')
  .description('Show the blast radius — all symbols that break if this one changes')
  .argument('<symbol>', 'Symbol name to analyse')
  .option('-p, --path <path>', 'Path to the repository (default: current directory)', '.')
  .option('-d, --depth <n>', 'Maximum traversal depth (hops)', '5')
  .addHelpText('after', `
  Traverses the call graph upward from the target symbol, collecting every
  symbol that transitively depends on it via calls or imports.

  ⚠  If impact shows ≥ 5 direct callers, treat the change as HIGH risk.

  Examples:
    $ code-intel impact runPipeline
    $ code-intel impact ApiClient --depth 3
    $ code-intel impact UserService --path ./backend
`)
  .action(async (symbol: string, options: { path: string; depth: string }) => {
    const { graph } = await analyzeWorkspace(options.path, { silent: true });
    const maxHops = parseInt(options.depth, 10);

    let targetNode = null;
    for (const node of graph.allNodes()) {
      if (node.name === symbol) { targetNode = node; break; }
    }
    if (!targetNode) {
      console.log(`\n  Symbol "${symbol}" not found.`);
      console.log(`  Try: code-intel search "${symbol}"\n`);
      return;
    }

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

    const risk = affected.size > 10 ? '⚠  HIGH' : affected.size > 5 ? '⚡ MEDIUM' : '✓  LOW';
    console.log(`\n  ◈  Blast radius for "${symbol}"\n`);
    console.log(`     Affected symbols : ${affected.size}`);
    console.log(`     Risk level       : ${risk}\n`);
    for (const id of affected) {
      const n = graph.getNode(id);
      if (n) console.log(`  ${n.kind.padEnd(14)} ${n.name.padEnd(32)} ${n.filePath}`);
    }
    console.log('');
  });

// ─── 11. group ───────────────────────────────────────────────────────────────
const groupCmd = program
  .command('group')
  .description('Manage repository groups for multi-repo / monorepo service tracking')
  .addHelpText('after', `
  Repository groups let you track contracts (exports, routes, schemas, events)
  across multiple indexed repos and detect cross-repo dependencies automatically.

  Subcommands:
    create <name>                        Create a new group
    add <group> <groupPath> <registry>   Add a repo to the group
    remove <group> <groupPath>           Remove a repo from the group
    list [name]                          List all groups or inspect one
    sync <name>                          Extract contracts + detect cross-links
    contracts <name>                     View extracted contracts and links
    query <name> <q>                     Search across all repos in the group
    status <name>                        Check index freshness of group members

  Examples:
    $ code-intel group create my-platform
    $ code-intel group add my-platform services/auth auth-service
    $ code-intel group sync my-platform
    $ code-intel group contracts my-platform --kind route
`);

// group create <name>
groupCmd
  .command('create <name>')
  .description('Create a new repository group')
  .addHelpText('after', `
  Examples:
    $ code-intel group create my-platform
    $ code-intel group create hr-services
`)
  .action((name: string) => {
    if (groupExists(name)) {
      console.error(`\n  ✗  Group "${name}" already exists.\n`);
      process.exit(1);
    }
    saveGroup({ name, createdAt: new Date().toISOString(), members: [] });
    console.log(`\n  ✅  Group "${name}" created.`);
    console.log(`      Add repos with: code-intel group add ${name} <groupPath> <registryName>\n`);
  });

// group add <group> <groupPath> <registryName>
groupCmd
  .command('add <group> <groupPath> <registryName>')
  .description('Add an indexed repository to a group at the given hierarchy path')
  .addHelpText('after', `
  <groupPath>     Dot-separated or slash-separated hierarchy path, e.g. hr/hiring/backend
  <registryName>  The repo's name as shown by \`code-intel list\`

  Examples:
    $ code-intel group add my-platform services/auth      auth-service
    $ code-intel group add my-platform services/payments  payments-api
    $ code-intel group add my-platform frontend           web-app
`)
  .action((group: string, groupPath: string, registryName: string) => {
    const registry = loadRegistry();
    const regEntry = registry.find((r) => r.name === registryName);
    if (!regEntry) {
      console.error(`\n  ✗  Registry entry "${registryName}" not found.`);
      console.error(`     Run \`code-intel list\` to see available repos.\n`);
      process.exit(1);
    }
    if (!groupExists(group)) {
      console.error(`\n  ✗  Group "${group}" does not exist.`);
      console.error(`     Create it first: code-intel group create ${group}\n`);
      process.exit(1);
    }
    addMember(group, { groupPath, registryName });
    console.log(`\n  ✅  Added "${registryName}" → group "${group}" at path "${groupPath}"\n`);
  });

// group remove <group> <groupPath>
groupCmd
  .command('remove <group> <groupPath>')
  .description('Remove a repository from a group by its hierarchy path')
  .addHelpText('after', `
  Examples:
    $ code-intel group remove my-platform services/auth
`)
  .action((group: string, groupPath: string) => {
    if (!groupExists(group)) {
      console.error(`\n  ✗  Group "${group}" does not exist.\n`);
      process.exit(1);
    }
    try {
      removeMember(group, groupPath);
      console.log(`\n  ✅  Removed "${groupPath}" from group "${group}"\n`);
    } catch (err) {
      console.error(`\n  ✗  ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

// group list [name]
groupCmd
  .command('list [name]')
  .description('List all groups, or show the full config of one group')
  .addHelpText('after', `
  Examples:
    $ code-intel group list
    $ code-intel group list my-platform
`)
  .action((name?: string) => {
    if (name) {
      const group = loadGroup(name);
      if (!group) {
        console.error(`\n  ✗  Group "${name}" not found.\n`);
        process.exit(1);
      }
      console.log(`\n  ◈  Group: ${group.name}`);
      console.log(`     Created  : ${group.createdAt}`);
      if (group.lastSync) console.log(`     Last sync: ${group.lastSync}`);
      console.log(`\n     Members (${group.members.length}):`);
      if (group.members.length === 0) {
        console.log('       (none — use `code-intel group add` to add repos)');
      } else {
        for (const m of group.members) {
          console.log(`       ${m.groupPath.padEnd(35)} →  ${m.registryName}`);
        }
      }
      console.log('');
    } else {
      const groups = listGroups();
      if (groups.length === 0) {
        console.log('\n  No groups found.');
        console.log('  Create one with: code-intel group create <name>\n');
        return;
      }
      console.log(`\n  Repository groups (${groups.length}):\n`);
      for (const g of groups) {
        const sync = g.lastSync ? `synced ${g.lastSync}` : 'never synced';
        console.log(`  ◆  ${g.name.padEnd(25)} ${g.members.length} member(s)  [${sync}]`);
      }
      console.log('');
    }
  });

// group sync <name>
groupCmd
  .command('sync <name>')
  .description('Extract contracts and detect cross-repo dependencies in a group')
  .addHelpText('after', `
  Scans every member repo's knowledge graph for exported symbols, routes,
  schemas, and events, then cross-matches names across repos to find
  likely provider → consumer relationships.

  Examples:
    $ code-intel group sync my-platform
`)
  .action(async (name: string) => {
    const group = loadGroup(name);
    if (!group) {
      console.error(`\n  ✗  Group "${name}" not found.\n`);
      process.exit(1);
    }
    if (group.members.length === 0) {
      console.error(`\n  ✗  Group "${name}" has no members.`);
      console.error(`     Add repos with \`code-intel group add\`.\n`);
      process.exit(1);
    }

    console.log(`\n  ⟳  Syncing group "${name}" (${group.members.length} member(s))…\n`);
    const result = await syncGroup(group);

    saveSyncResult(result);
    group.lastSync = result.syncedAt;
    saveGroup(group);

    console.log(`  ✅  Sync complete\n`);
    console.log(`     Repos synced  : ${result.memberCount}`);
    console.log(`     Contracts     : ${result.contracts.length}`);
    console.log(`     Cross-links   : ${result.links.length}`);

    if (result.links.length > 0) {
      console.log(`\n  Top cross-repo links:\n`);
      for (const link of result.links.slice(0, 10)) {
        const conf = (link.confidence * 100).toFixed(0).padStart(3);
        console.log(`  ${conf}%  ${link.providerRepo} ∷ ${link.providerContract.padEnd(30)} ↔  ${link.consumerRepo} ∷ ${link.consumerContract}`);
      }
      if (result.links.length > 10) {
        console.log(`\n  … and ${result.links.length - 10} more. Run \`code-intel group contracts ${name}\` for full details.`);
      }
    }
    console.log('');
  });

// group contracts <name>
groupCmd
  .command('contracts <name>')
  .description('Inspect extracted contracts and cross-links from the last sync')
  .option('--kind <kind>',           'Filter by contract kind: export | route | schema | event')
  .option('--repo <repo>',           'Filter by registry name')
  .option('--min-confidence <pct>',  'Minimum link confidence 0–100 (default: 0)', '0')
  .addHelpText('after', `
  Examples:
    $ code-intel group contracts my-platform
    $ code-intel group contracts my-platform --kind route
    $ code-intel group contracts my-platform --repo auth-service --min-confidence 70
`)
  .action((name: string, opts: { kind?: string; repo?: string; minConfidence: string }) => {
    const result = loadSyncResult(name);
    if (!result) {
      console.error(`\n  ✗  No sync data for group "${name}".`);
      console.error(`     Run: code-intel group sync ${name}\n`);
      process.exit(1);
    }

    const minConf = parseInt(opts.minConfidence, 10) / 100;

    let contracts = result.contracts;
    if (opts.kind) contracts = contracts.filter((c) => c.kind === opts.kind);
    if (opts.repo) contracts = contracts.filter((c) => c.repoName === opts.repo);

    let links = result.links.filter((l) => l.confidence >= minConf);
    if (opts.repo) links = links.filter((l) => l.providerRepo === opts.repo || l.consumerRepo === opts.repo);

    console.log(`\n  ◈  Group "${name}"  —  synced ${result.syncedAt}\n`);

    console.log(`  Contracts (${contracts.length}):\n`);
    for (const c of contracts) {
      const sig = c.signature ? `  ${c.signature.slice(0, 55)}` : '';
      console.log(`  [${c.kind.padEnd(6)}]  ${c.repoName.padEnd(22)} ${c.name.padEnd(35)}${sig}`);
    }

    console.log(`\n  Cross-repo links (${links.length}):\n`);
    if (links.length === 0) {
      console.log('  (none)');
    } else {
      for (const link of links) {
        const conf = (link.confidence * 100).toFixed(0).padStart(3);
        console.log(`  ${conf}%  [${link.matchKind}]  ${link.providerRepo} ∷ ${link.providerContract.padEnd(30)} ↔  ${link.consumerRepo} ∷ ${link.consumerContract}`);
      }
    }
    console.log('');
  });

// group query <name> <q>
groupCmd
  .command('query <name> <q>')
  .description('Search execution flows across all repos in a group')
  .option('-l, --limit <n>', 'Max results per repo', '10')
  .addHelpText('after', `
  Uses BM25 search within each member repo's graph, then merges the results
  using Reciprocal Rank Fusion (RRF) for a unified ranked list.

  Examples:
    $ code-intel group query my-platform "handlePayment"
    $ code-intel group query my-platform "UserAuth" --limit 5
`)
  .action(async (name: string, q: string, opts: { limit: string }) => {
    const group = loadGroup(name);
    if (!group) {
      console.error(`\n  ✗  Group "${name}" not found.\n`);
      process.exit(1);
    }

    console.log(`\n  ◈  Querying group "${name}" for: "${q}"\n`);
    const limit = parseInt(opts.limit, 10);
    const { perRepo, merged } = await queryGroup(group, q, limit);

    if (merged.length === 0) {
      console.log('  No results found across any repo in this group.\n');
      return;
    }

    console.log(`  Merged results (${merged.length}, ranked by RRF):\n`);
    for (const r of merged) {
      console.log(`  ${r.kind.padEnd(14)} ${r.name.padEnd(32)} ${r.filePath}`);
      if (r.snippet) console.log(`                 ${r.snippet.slice(0, 95)}`);
    }

    console.log(`\n  Per-repo breakdown:\n`);
    for (const rr of perRepo) {
      console.log(`    ${rr.repoName.padEnd(25)} (${rr.groupPath})  →  ${rr.results.length} result(s)`);
    }
    console.log('');
  });

// group status <name>
groupCmd
  .command('status <name>')
  .description('Check index freshness and sync status of all repos in a group')
  .addHelpText('after', `
  Examples:
    $ code-intel group status my-platform
`)
  .action((name: string) => {
    const group = loadGroup(name);
    if (!group) {
      console.error(`\n  ✗  Group "${name}" not found.\n`);
      process.exit(1);
    }

    const registry = loadRegistry();
    const now = Date.now();

    console.log(`\n  ◈  Group "${name}" — status\n`);
    if (group.lastSync) {
      const age = Math.round((now - new Date(group.lastSync).getTime()) / 60000);
      console.log(`     Last sync : ${group.lastSync} (${age} min ago)`);
    } else {
      console.log(`     Last sync : never  →  run \`code-intel group sync ${name}\``);
    }
    console.log(`\n     Members (${group.members.length}):\n`);

    for (const m of group.members) {
      const regEntry = registry.find((r) => r.name === m.registryName);
      if (!regEntry) {
        console.log(`  ✗  ${m.groupPath.padEnd(35)} [${m.registryName}]  — NOT IN REGISTRY`);
        continue;
      }

      const metaPath = path.join(regEntry.path, '.code-intel', 'meta.json');
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { indexedAt: string; stats: { nodes: number; edges: number; files: number } };
        const indexedAt = meta.indexedAt;
        const ageMin = Math.round((now - new Date(indexedAt).getTime()) / 60000);
        const stale = ageMin > 1440 ? '  ⚠  STALE (>24h)' : '';
        console.log(`  ✓  ${m.groupPath.padEnd(35)} [${m.registryName}]${stale}`);
        console.log(`       indexed ${indexedAt} (${ageMin} min ago)`);
        console.log(`       ${meta.stats.nodes} nodes · ${meta.stats.edges} edges · ${meta.stats.files} files`);
        console.log(`       ${regEntry.path}\n`);
      } catch {
        console.log(`  ✗  ${m.groupPath.padEnd(35)} [${m.registryName}]  — NOT INDEXED`);
        console.log(`       run: code-intel analyze ${regEntry.path}\n`);
      }
    }
  });

program.parse();
