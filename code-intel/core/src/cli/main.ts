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
import os from 'node:os';
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
import { loadGraphFromDB } from '../multi-repo/graph-from-db.js';
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
import { getOrCreateUsersDB } from '../auth/users-db.js';
import type { Role } from '../auth/users-db.js';
import { BackupService } from '../backup/backup-service.js';
import { v4 as uuidv4 } from 'uuid';
import { MigrationRunner, CURRENT_SCHEMA_VERSION } from '../migrations/migration-runner.js';
import Database from 'better-sqlite3';
import {
  loadSecrets,
  saveSecrets,
  setSecret,
  getSecret,
  deleteSecret,
  listSecretKeys,
} from '../auth/secret-store.js';
import { keychainBackend } from '../auth/keychain.js';
import { assertNoPlaintextSecrets } from '../shared/config-validator.js';
import { secureMkdir, tightenDbFiles } from '../shared/fs-secure.js';
import { initTracing } from '../observability/tracing.js';

// Bootstrap OTel tracing if enabled (must be called before any auto-instrumented code).
initTracing();

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

  // --force: wipe all existing DB files upfront so there's no stale state
  if (options?.force) {
    const dbPath = getDbPath(workspaceRoot);
    const { getVectorDbPath } = await import('../storage/index.js');
    const vdbPath = getVectorDbPath(workspaceRoot);
    const wipeFiles = [
      dbPath, `${dbPath}-shm`, `${dbPath}-wal`, `${dbPath}.shm`, `${dbPath}.wal`,
      vdbPath, `${vdbPath}-shm`, `${vdbPath}-wal`, `${vdbPath}.shm`, `${vdbPath}.wal`,
    ];
    for (const f of wipeFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }

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

  // Save metadata (bump indexVersion on every successful analysis)
  const repoName = path.basename(workspaceRoot);
  const indexVersion = uuidv4();
  saveMetadata(workspaceRoot, {
    indexedAt: new Date().toISOString(),
    indexVersion,
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

  // Persist graph to LadybugDB — atomic swap: write to graph.db.new then rename
  startSpinner('Persisting graph to DB');
  try {
    const dbPath = getDbPath(workspaceRoot);
    const dbPathNew = `${dbPath}.new`;
    // Clean up any previous failed .new file
    const newStaleFiles = [
      dbPathNew,
      `${dbPathNew}-shm`, `${dbPathNew}-wal`,
      `${dbPathNew}.shm`, `${dbPathNew}.wal`,
    ];
    for (const f of newStaleFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
    // Write to the .new file
    const db = new DbManager(dbPathNew);
    await db.init();
    const { nodeCount, edgeCount } = await loadGraphToDB(graph, db);
    db.close();
    // Atomic swap: remove old DB files, rename .new → live
    const staleFiles = [
      dbPath,
      `${dbPath}-shm`, `${dbPath}-wal`,
      `${dbPath}.shm`, `${dbPath}.wal`,
    ];
    for (const f of staleFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
    // Rename .new and its WAL/SHM companions atomically
    for (const f of newStaleFiles) {
      if (fs.existsSync(f)) {
        const dest = f.replace(dbPathNew, dbPath);
        try { fs.renameSync(f, dest); } catch { /* ignore */ }
      }
    }
    fs.renameSync(dbPathNew, dbPath);
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
      // Remove stale vector DB files before writing
      const staleVdb = [vdbPath, `${vdbPath}-shm`, `${vdbPath}-wal`, `${vdbPath}.shm`, `${vdbPath}.wal`];
      for (const f of staleVdb) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
      }
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
    const workspaceRoot = path.resolve(targetPath);
    const repoName = path.basename(workspaceRoot);
    const dbPath = getDbPath(workspaceRoot);
    const existingIndex = fs.existsSync(dbPath) && loadMetadata(workspaceRoot) !== null;

    if (existingIndex) {
      const graph = createKnowledgeGraph();
      const db = new DbManager(dbPath);
      await db.init();
      await loadGraphFromDB(graph, db);
      db.close();
      await startMcpStdio(graph, repoName, workspaceRoot);
    } else {
      const { graph, repoName: name, workspaceRoot: root } = await analyzeWorkspace(targetPath, { silent: true });
      await startMcpStdio(graph, name, root);
    }
  });

// ─── 4. serve ────────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start the local HTTP server + web UI for graph exploration')
  .argument('[path]', 'Path to analyze (default: current directory)', '.')
  .option('-p, --port <port>', 'Port to listen on', '4747')
  .option('--force', 'Force re-analysis even if an index already exists')
  .addHelpText('after', `
  If a .code-intel/graph.db index already exists for the path, the server
  loads the persisted graph directly and starts immediately — no re-analysis.
  Use --force to discard the existing index and re-analyze from scratch.

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
    $ code-intel serve --force
`)
  .action(async (targetPath: string, options: { port: string; force?: boolean }) => {
    const workspaceRoot = path.resolve(targetPath);
    const repoName = path.basename(workspaceRoot);
    const dbPath = getDbPath(workspaceRoot);
    const existingIndex = !options.force && fs.existsSync(dbPath) && loadMetadata(workspaceRoot) !== null;

    if (existingIndex) {
      // Load graph from persisted DB — no re-analysis needed
      console.log(`Loading index: ${workspaceRoot}`);
      const meta = loadMetadata(workspaceRoot)!;
      console.log(`  ◈  ${meta.stats.nodes} nodes · ${meta.stats.edges} edges · ${meta.stats.files} files  (indexed ${meta.indexedAt})`);
      const graph = createKnowledgeGraph();
      const db = new DbManager(dbPath);
      await db.init();
      await loadGraphFromDB(graph, db);
      db.close();
      startHttpServer(graph, repoName, parseInt(options.port, 10), workspaceRoot);
    } else {
      // No index or --force: run full analysis then serve
      const { graph, workspaceRoot: root, repoName: name } = await analyzeWorkspace(targetPath, { force: options.force });
      startHttpServer(graph, name, parseInt(options.port, 10), root);
    }
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

// Soft-delete helpers ──────────────────────────────────────────────────────────

const TRASH_TTL_DAYS = 30;

function trashDirName(repoPath: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `.code-intel-trash-${date}`;
}

function softDeleteCodeIntel(repoPath: string): void {
  const codeIntelDir = path.join(repoPath, '.code-intel');
  if (!fs.existsSync(codeIntelDir)) return;

  const trashName = trashDirName(repoPath);
  const trashDir = path.join(repoPath, trashName);

  // If a trash dir already exists for today, append a counter
  let dest = trashDir;
  let counter = 1;
  while (fs.existsSync(dest)) {
    dest = `${trashDir}-${counter++}`;
  }

  fs.renameSync(codeIntelDir, dest);
  fs.writeFileSync(
    path.join(dest, 'TRASH_META.json'),
    JSON.stringify({ deletedAt: new Date().toISOString(), repoPath, permanent: false }, null, 2),
  );
  console.log(`  ✓  Moved to trash: ${dest}`);
  console.log(`     (auto-purge in ${TRASH_TTL_DAYS} days, or run --purge to delete immediately)`);
}

function purgeStaleTrashes(repoPath: string): void {
  const cutoff = Date.now() - TRASH_TTL_DAYS * 24 * 60 * 60 * 1000;
  try {
    for (const entry of fs.readdirSync(repoPath)) {
      if (!entry.startsWith('.code-intel-trash-')) continue;
      const fullPath = path.join(repoPath, entry);
      const metaPath = path.join(fullPath, 'TRASH_META.json');
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { deletedAt: string };
          if (new Date(meta.deletedAt).getTime() < cutoff) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`  ✓  Auto-purged stale trash: ${fullPath}`);
          }
        } catch { /* skip corrupt meta */ }
      }
    }
  } catch { /* ignore if dir not readable */ }
}

program
  .command('clean')
  .description('Soft-delete the knowledge graph index for a repository (30-day trash)')
  .argument('[path]', 'Path to clean (default: current directory)', '.')
  .option('--all',        'Remove indexes for ALL indexed repositories')
  .option('--force',      'Required with --all to confirm the destructive operation')
  .option('--purge',      'Immediately hard-delete instead of moving to trash')
  .option('--list-trash', 'List all trash directories and their ages')
  .addHelpText('after', `
  By default, .code-intel/ is moved to .code-intel-trash-{date}/ for 30 days
  before being permanently purged. Use --purge to skip the trash period.

  ⚠  --all --force is irreversible (with --purge) — use with care.

  Examples:
    $ code-intel clean                       Soft-delete index for current directory
    $ code-intel clean ./my-project          Soft-delete index for a specific path
    $ code-intel clean --purge               Hard-delete immediately (no trash)
    $ code-intel clean --all --force         Soft-delete ALL indexes
    $ code-intel clean --all --force --purge Hard-delete ALL indexes immediately
    $ code-intel clean --list-trash          List all trash directories
`)
  .action((targetPath: string, opts: { all?: boolean; force?: boolean; purge?: boolean; listTrash?: boolean }) => {
    // ── list-trash ─────────────────────────────────────────────────────────
    if (opts.listTrash) {
      const repos = loadRegistry();
      const roots = repos.map((r) => r.path);
      if (roots.length === 0) roots.push(path.resolve('.'));
      let found = 0;
      for (const root of roots) {
        try {
          for (const entry of fs.readdirSync(root)) {
            if (!entry.startsWith('.code-intel-trash-')) continue;
            const fullPath = path.join(root, entry);
            const metaPath = path.join(fullPath, 'TRASH_META.json');
            let deletedAt = 'unknown';
            if (fs.existsSync(metaPath)) {
              try { deletedAt = (JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { deletedAt: string }).deletedAt; } catch { /* skip */ }
            }
            const ageDays = Math.floor((Date.now() - new Date(deletedAt).getTime()) / (24 * 60 * 60 * 1000));
            const purgeIn = Math.max(0, TRASH_TTL_DAYS - ageDays);
            console.log(`  ${fullPath}  (deleted: ${deletedAt.slice(0, 10)}, purge in ${purgeIn} days)`);
            found++;
          }
        } catch { /* skip */ }
      }
      if (found === 0) console.log('\n  No trash directories found.\n');
      return;
    }

    // ── --all ──────────────────────────────────────────────────────────────
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
        if (opts.purge) {
          const codeIntelDir = path.join(r.path, '.code-intel');
          if (fs.existsSync(codeIntelDir)) {
            fs.rmSync(codeIntelDir, { recursive: true, force: true });
            console.log(`  ✓  Hard-deleted ${codeIntelDir}`);
          }
        } else {
          softDeleteCodeIntel(r.path);
          purgeStaleTrashes(r.path);
        }
        removeRepo(r.path);
      }
      console.log(`\n  Cleaned ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}.\n`);
      return;
    }

    // ── single repo ────────────────────────────────────────────────────────
    const workspaceRoot = path.resolve(targetPath);
    if (opts.purge) {
      const codeIntelDir = path.join(workspaceRoot, '.code-intel');
      if (fs.existsSync(codeIntelDir)) {
        fs.rmSync(codeIntelDir, { recursive: true, force: true });
        console.log(`\n  ✓  Hard-deleted ${codeIntelDir}`);
      }
    } else {
      softDeleteCodeIntel(workspaceRoot);
      purgeStaleTrashes(workspaceRoot);
    }
    removeRepo(workspaceRoot);
    console.log('  Index cleaned.\n');
  });

// ─── loadOrAnalyzeWorkspace ───────────────────────────────────────────────────
// Shared helper for read-only commands (search, inspect, impact).
// If an existing .code-intel/graph.db index is found it loads directly from DB —
// no re-analysis needed. Falls back to a full analysis only when no index exists.
async function loadOrAnalyzeWorkspace(targetPath: string) {
  const workspaceRoot = path.resolve(targetPath);
  const dbPath = getDbPath(workspaceRoot);
  const existingIndex = fs.existsSync(dbPath) && loadMetadata(workspaceRoot) !== null;

  if (existingIndex) {
    const graph = createKnowledgeGraph();
    const db = new DbManager(dbPath);
    await db.init();
    await loadGraphFromDB(graph, db);
    db.close();
    return { graph, workspaceRoot, repoName: path.basename(workspaceRoot) };
  }

  // No index yet — run full analysis and persist for next time
  return analyzeWorkspace(targetPath, { silent: true });
}

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
    const { graph } = await loadOrAnalyzeWorkspace(options.path);
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
    const { graph } = await loadOrAnalyzeWorkspace(options.path);

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
    const { graph } = await loadOrAnalyzeWorkspace(options.path);
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

// ─── 12. user ────────────────────────────────────────────────────────────────
const userCmd = program
  .command('user')
  .description('Manage local user accounts');

// user create <username>
userCmd
  .command('create <username>')
  .description('Create a new local user account')
  .requiredOption('--role <role>', 'Role: admin | analyst | viewer | repo-owner')
  .option('--password <password>', 'Password (prompted if omitted)')
  .addHelpText('after', `
  Examples:
    $ code-intel user create admin --role admin --password mypass
    $ code-intel user create alice --role analyst
`)
  .action(async (username: string, opts: { role: string; password?: string }) => {
    const validRoles = ['admin', 'analyst', 'viewer', 'repo-owner'];
    if (!validRoles.includes(opts.role)) {
      console.error(`\n  ✗  Invalid role "${opts.role}". Must be one of: ${validRoles.join(', ')}\n`);
      process.exit(1);
    }
    let password = opts.password;
    if (!password) {
      // prompt for password
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      password = await new Promise<string>((resolve) => {
        rl.question(`  Password for ${username}: `, (ans) => {
          rl.close();
          resolve(ans);
        });
      });
    }
    const db = getOrCreateUsersDB();
    try {
      const user = db.createUser(username, password, opts.role as Role);
      console.log(`\n  ✅  User created:`);
      console.log(`     ID       : ${user.id}`);
      console.log(`     Username : ${user.username}`);
      console.log(`     Role     : ${user.role}`);
      console.log(`     Created  : ${user.createdAt}\n`);
    } catch (err) {
      console.error(`\n  ✗  Failed to create user: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

// user list
userCmd
  .command('list')
  .description('List all local user accounts')
  .action(() => {
    const db = getOrCreateUsersDB();
    const users = db.listUsers();
    if (users.length === 0) {
      console.log('\n  No users found. Create one with: code-intel user create <username> --role <role>\n');
      return;
    }
    console.log(`\n  Local accounts (${users.length}):\n`);
    for (const u of users) {
      console.log(`  ◆  ${u.username.padEnd(20)} role: ${u.role.padEnd(12)} id: ${u.id}  created: ${u.createdAt}`);
    }
    console.log('');
  });

// user delete <username>
userCmd
  .command('delete <username>')
  .description('Delete a local user account')
  .action((username: string) => {
    const db = getOrCreateUsersDB();
    const user = db.findUserByUsername(username);
    if (!user) {
      console.error(`\n  ✗  User "${username}" not found.\n`);
      process.exit(1);
    }
    db.deleteUser(username);
    console.log(`\n  ✅  User "${username}" deleted.\n`);
  });

// user reset-password <username>
userCmd
  .command('reset-password <username>')
  .description('Reset the password for a local user account')
  .option('--password <password>', 'New password (prompted if omitted)')
  .action(async (username: string, opts: { password?: string }) => {
    const db = getOrCreateUsersDB();
    const user = db.findUserByUsername(username);
    if (!user) {
      console.error(`\n  ✗  User "${username}" not found.\n`);
      process.exit(1);
    }
    let password = opts.password;
    if (!password) {
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      password = await new Promise<string>((resolve) => {
        rl.question(`  New password for ${username}: `, (ans) => {
          rl.close();
          resolve(ans);
        });
      });
    }
    db.resetPassword(username, password);
    console.log(`\n  ✅  Password reset for "${username}".\n`);
  });

// user set-role <username> <role>
userCmd
  .command('set-role <username> <role>')
  .description('Change the role of a local user account')
  .action((username: string, role: string) => {
    const validRoles = ['admin', 'analyst', 'viewer', 'repo-owner'];
    if (!validRoles.includes(role)) {
      console.error(`\n  ✗  Invalid role "${role}". Must be one of: ${validRoles.join(', ')}\n`);
      process.exit(1);
    }
    const db = getOrCreateUsersDB();
    const user = db.findUserByUsername(username);
    if (!user) {
      console.error(`\n  ✗  User "${username}" not found.\n`);
      process.exit(1);
    }
    db.setRole(username, role as Role);
    console.log(`\n  ✅  Role for "${username}" set to "${role}".\n`);
  });

// ─── 13. token ───────────────────────────────────────────────────────────────
const tokenCmd = program
  .command('token')
  .description('Manage API tokens for programmatic access');

// token create
tokenCmd
  .command('create')
  .description('Create a new API token (raw token shown once)')
  .requiredOption('--name <name>', 'Token name / description')
  .requiredOption('--role <role>', 'Role: admin | analyst | viewer | repo-owner')
  .option('--expires <duration>', 'Expiry duration, e.g. 90d, 30d, 365d (omit for no expiry)')
  .option('--repos <repos>', 'Comma-separated list of repo names to scope this token to (omit for all repos)')
  .option('--tools <tools>', 'Comma-separated list of tool names to scope this token to (omit for all tools)')
  .addHelpText('after', `
  Examples:
    $ code-intel token create --name "CI bot" --role analyst
    $ code-intel token create --name "Read-only" --role viewer --expires 90d
    $ code-intel token create --name "Scoped bot" --role analyst --repos my-repo,other-repo
    $ code-intel token create --name "Limited" --role viewer --tools search,inspect
`)
  .action((opts: { name: string; role: string; expires?: string; repos?: string; tools?: string }) => {
    const validRoles = ['admin', 'analyst', 'viewer', 'repo-owner'];
    if (!validRoles.includes(opts.role)) {
      console.error(`\n  ✗  Invalid role "${opts.role}". Must be one of: ${validRoles.join(', ')}\n`);
      process.exit(1);
    }
    let expiresAt: string | undefined;
    if (opts.expires) {
      const match = opts.expires.match(/^(\d+)d$/);
      if (!match) {
        console.error(`\n  ✗  Invalid expiry format "${opts.expires}". Use e.g. 90d\n`);
        process.exit(1);
      }
      const days = parseInt(match[1]!, 10);
      const exp = new Date();
      exp.setDate(exp.getDate() + days);
      expiresAt = exp.toISOString();
    }
    const scopedRepos = opts.repos ? opts.repos.split(',').map((r) => r.trim()).filter(Boolean) : undefined;
    const scopedTools = opts.tools ? opts.tools.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const db = getOrCreateUsersDB();
    const { token, rawToken } = db.createToken(opts.name, opts.role as Role, expiresAt, scopedRepos, scopedTools);
    console.log('\n  ✅  Token created — save this token now; it will NOT be shown again!\n');
    console.log(`     Token    : ${rawToken}`);
    console.log(`     ID       : ${token.id}`);
    console.log(`     Name     : ${token.name}`);
    console.log(`     Role     : ${token.role}`);
    if (token.expiresAt) console.log(`     Expires  : ${token.expiresAt}`);
    if (token.scopedRepos) console.log(`     Repos    : ${token.scopedRepos.join(', ')}`);
    if (token.scopedTools) console.log(`     Tools    : ${token.scopedTools.join(', ')}`);
    console.log('\n  Usage: Authorization: Bearer <token>\n');
  });

// token list
tokenCmd
  .command('list')
  .description('List all active API tokens')
  .action(() => {
    const db = getOrCreateUsersDB();
    const tokens = db.listTokens();
    if (tokens.length === 0) {
      console.log('\n  No active tokens. Create one with: code-intel token create --name <name> --role <role>\n');
      return;
    }
    console.log(`\n  Active API tokens (${tokens.length}):\n`);
    for (const t of tokens) {
      const exp = t.expiresAt ? `expires: ${t.expiresAt}` : 'no expiry';
      const last = t.lastUsedAt ? `last used: ${t.lastUsedAt}` : 'never used';
      console.log(`  ◆  ${t.name.padEnd(25)} role: ${t.role.padEnd(12)} ${exp}  ${last}`);
      console.log(`     ID: ${t.id}  created: ${t.createdAt}`);
    }
    console.log('');
  });

// token revoke <id>
tokenCmd
  .command('revoke <id>')
  .description('Revoke an API token immediately')
  .action((id: string) => {
    const db = getOrCreateUsersDB();
    const tokens = db.listTokens();
    const token = tokens.find((t) => t.id === id);
    if (!token) {
      console.error(`\n  ✗  Token "${id}" not found or already revoked.\n`);
      process.exit(1);
    }
    db.revokeToken(id);
    console.log(`\n  ✅  Token "${token.name}" (${id}) revoked immediately.\n`);
  });

// ─── 14. backup ──────────────────────────────────────────────────────────────
const backupCmd = program
  .command('backup')
  .description('Backup and restore knowledge graph data');

// backup create [path]
backupCmd
  .command('create [path]')
  .description('Create an encrypted backup of the index for a repository')
  .addHelpText('after', `
  Backs up graph.db, vector.db, meta.json, registry.json, and users.db
  into ~/.code-intel/backups/ using AES-256-GCM encryption.

  Examples:
    $ code-intel backup create
    $ code-intel backup create ./my-project
`)
  .action((targetPath: string = '.') => {
    const repoPath = path.resolve(targetPath);
    const svc = new BackupService();
    try {
      const entry = svc.createBackup(repoPath);
      console.log(`\n  ✅  Backup created:`);
      console.log(`     ID       : ${entry.id}`);
      console.log(`     Created  : ${entry.createdAt}`);
      console.log(`     Size     : ${(entry.size / 1024).toFixed(1)} KB`);
      console.log(`     Path     : ${entry.path}\n`);
    } catch (err) {
      console.error(`\n  ✗  Backup failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

// backup list
backupCmd
  .command('list')
  .description('List all available backups')
  .action(() => {
    const svc = new BackupService();
    const entries = svc.listBackups();
    if (entries.length === 0) {
      console.log('\n  No backups found. Run: code-intel backup create\n');
      return;
    }
    console.log(`\n  Backups (${entries.length}):\n`);
    for (const e of entries) {
      const exists = fs.existsSync(e.path);
      const status = exists ? '✓' : '✗ (missing)';
      console.log(`  ${status}  ${e.id.slice(0, 8)}  ${e.createdAt}  ${(e.size / 1024).toFixed(1)} KB  →  ${e.repoPath}`);
    }
    console.log('');
  });

// backup restore <id>
backupCmd
  .command('restore <id>')
  .description('Restore a backup by ID')
  .option('--target <path>', 'Restore to a different path (default: original repo path)')
  .addHelpText('after', `
  Examples:
    $ code-intel backup restore abc123ef
    $ code-intel backup restore abc123ef --target ./my-project-restored
`)
  .action((id: string, opts: { target?: string }) => {
    const svc = new BackupService();
    try {
      const targetPath = opts.target ? path.resolve(opts.target) : undefined;
      svc.restoreBackup(id, targetPath);
      console.log(`\n  ✅  Backup "${id}" restored successfully.\n`);
    } catch (err) {
      console.error(`\n  ✗  Restore failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

// ─── 15. migrate ──────────────────────────────────────────────────────────────
program
  .command('migrate')
  .description('Manage database schema migrations')
  .option('--dry-run', 'Preview pending migrations without applying them')
  .option('--status', 'Show current migration status')
  .option('--rollback', 'Roll back the last applied migration')
  .option('--db <path>', 'Path to database file (default: ~/.code-intel/users.db)')
  .addHelpText('after', `
  Examples:
    $ code-intel migrate --status
    $ code-intel migrate --dry-run
    $ code-intel migrate
    $ code-intel migrate --rollback
`)
  .action((opts: { dryRun?: boolean; status?: boolean; rollback?: boolean; db?: string }) => {
    const dbPath = opts.db ?? path.join(os.homedir(), '.code-intel', 'users.db');
    if (!fs.existsSync(dbPath)) {
      console.error(`\n  ✗  Database not found: ${dbPath}\n  Run \`code-intel serve\` or \`code-intel user create\` first.\n`);
      process.exit(1);
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    const runner = new MigrationRunner(db);

    try {
      if (opts.status) {
        const statuses = runner.getStatus();
        console.log(`\n  Migration status (current schema: v${CURRENT_SCHEMA_VERSION})\n`);
        for (const s of statuses) {
          const mark = s.pending ? '○ pending' : `✓ applied ${s.appliedAt ?? ''}`;
          console.log(`  v${String(s.version).padStart(3, '0')}  ${mark.padEnd(45)} ${s.description}`);
        }
        console.log('');
        return;
      }

      if (opts.rollback) {
        const ok = runner.migrateDown();
        if (ok) {
          console.log(`\n  ✅  Last migration rolled back.\n`);
        } else {
          console.log(`\n  No migrations to roll back.\n`);
        }
        return;
      }

      if (opts.dryRun) {
        const count = runner.migrateUp(true);
        console.log(`\n  Dry run: ${count} pending migration(s) would be applied.\n`);
        return;
      }

      runner.checkCompatibility();
      const count = runner.migrateUp();
      if (count === 0) {
        console.log(`\n  ✓  All migrations up to date (schema v${CURRENT_SCHEMA_VERSION}).\n`);
      } else {
        console.log(`\n  ✅  Applied ${count} migration(s). Schema is now v${runner.getCurrentVersion()}.\n`);
      }
    } finally {
      db.close();
    }
  });

// ─── 16. auth login (OIDC Device Flow) ───────────────────────────────────────
const authCmd = program
  .command('auth')
  .description('Authentication commands (OIDC / OAuth2)');

authCmd
  .command('login')
  .description('Authenticate via OIDC device flow — opens a browser and stores the token')
  .option('--server <url>', 'Code-intel server URL (default: http://localhost:4747)')
  .addHelpText('after', `
  Requires CODE_INTEL_OIDC_ISSUER, CODE_INTEL_OIDC_CLIENT_ID,
  CODE_INTEL_OIDC_CLIENT_SECRET to be configured on the server.

  Examples:
    $ code-intel auth login
    $ code-intel auth login --server https://code-intel.company.com
`)
  .action(async (opts: { server?: string }) => {
    const serverUrl = (opts.server ?? 'http://localhost:4747').replace(/\/$/, '');

    // ── Dynamic import so openid-client is only loaded when needed ────────────
    const {
      initiateDeviceFlow,
      pollDeviceFlow,
      isOIDCConfigured,
    } = await import('../auth/oidc.js');

    if (!isOIDCConfigured()) {
      console.error('\n  ✗  OIDC is not configured on this installation.');
      console.error('     Set CODE_INTEL_OIDC_ISSUER, CODE_INTEL_OIDC_CLIENT_ID,');
      console.error('     and CODE_INTEL_OIDC_CLIENT_SECRET and restart the server.\n');
      process.exit(1);
    }

    console.log('\n  ◈  Code Intelligence — OIDC Login (Device Flow)\n');

    let deviceInit: Awaited<ReturnType<typeof initiateDeviceFlow>>;
    try {
      const result = await initiateDeviceFlow();
      if (!result) {
        console.error('\n  ✗  OIDC is not configured or provider is unreachable.\n');
        process.exit(1);
      }
      deviceInit = result;
    } catch (err) {
      console.error(`\n  ✗  Failed to initiate device flow: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }

    const { deviceResponse, config } = deviceInit;
    const dr = deviceResponse as {
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
      expires_in?: number;
    };

    console.log(`  1. Open this URL in your browser:\n`);
    console.log(`     ${dr.verification_uri_complete ?? dr.verification_uri}\n`);
    console.log(`  2. Enter the code:  ${dr.user_code}\n`);
    console.log(`  Waiting for authorization${dr.expires_in ? ` (expires in ${dr.expires_in}s)` : ''}…\n`);

    // Attempt to open the browser automatically
    try {
      const { exec } = await import('node:child_process');
      const openUrl = dr.verification_uri_complete ?? dr.verification_uri;
      const cmd =
        process.platform === 'win32'
          ? `start "" "${openUrl}"`
          : process.platform === 'darwin'
          ? `open "${openUrl}"`
          : `xdg-open "${openUrl}"`;
      exec(cmd, (err) => {
        if (err) Logger.debug('[auth] Could not auto-open browser:', err.message);
      });
    } catch { /* not critical */ }

    try {
      const tokens = await pollDeviceFlow(config, deviceResponse);

      // Store token in ~/.code-intel/oidc-token.json (simple OS keychain substitute)
      const tokenPath = path.join(os.homedir(), '.code-intel', 'oidc-token.json');
      const tokenData = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        server: serverUrl,
        storedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
      fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2), { mode: 0o600 });

      console.log(`  ✅  Authenticated successfully!`);
      console.log(`  Token stored at: ${tokenPath}`);
      console.log(`  Use CODE_INTEL_TOKEN env var or --token flag to use it with CLI/MCP.\n`);
    } catch (err) {
      console.error(`\n  ✗  Authentication failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Show the current OIDC authentication status')
  .action(() => {
    const tokenPath = path.join(os.homedir(), '.code-intel', 'oidc-token.json');
    if (!fs.existsSync(tokenPath)) {
      console.log('\n  Not authenticated via OIDC. Run: code-intel auth login\n');
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(tokenPath, 'utf-8')) as {
        server?: string;
        storedAt?: string;
        accessToken?: string;
      };
      console.log(`\n  ✅  OIDC token stored`);
      console.log(`  Server : ${data.server ?? 'unknown'}`);
      console.log(`  Stored : ${data.storedAt ?? 'unknown'}`);
      console.log(`  Token  : ${data.accessToken ? data.accessToken.slice(0, 12) + '…' : 'missing'}`);
      console.log('');
    } catch {
      console.error('\n  ✗  Could not read token file. Try: code-intel auth login\n');
    }
  });

authCmd
  .command('logout')
  .description('Remove locally stored OIDC token')
  .action(() => {
    const tokenPath = path.join(os.homedir(), '.code-intel', 'oidc-token.json');
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
      console.log('\n  ✅  OIDC token removed. You are now logged out.\n');
    } else {
      console.log('\n  No stored token found.\n');
    }
  });

// ─── auth rotate-token ────────────────────────────────────────────────────────
authCmd
  .command('rotate-token <id>')
  .description('Rotate an API token — issues a new token with the same role/scope; old token works for a 24h grace period')
  .addHelpText('after', `
  The original token continues to work for 24 hours after rotation so that
  running CI pipelines can be updated without an outage.

  Examples:
    $ code-intel auth rotate-token <token-id>
`)
  .action((id: string) => {
    const db = getOrCreateUsersDB();
    const tokens = db.listTokens();
    const old = tokens.find((t) => t.id === id);
    if (!old) {
      console.error(`\n  ✗  Token "${id}" not found or already revoked.\n`);
      process.exit(1);
    }
    // Create a replacement with the same config
    const graceExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    // Schedule revocation of old token after grace period
    // We encode the intended revocation time in the name so ops teams can audit it.
    const newName = `${old.name} (rotated ${new Date().toISOString().slice(0, 10)})`;
    const { token: newToken, rawToken } = db.createToken(
      newName,
      old.role,
      old.expiresAt,
      old.scopedRepos,
      old.scopedTools,
    );
    // Store the old token id and grace expiry in the secrets store for
    // the grace-period enforcement hook (checked by authMiddleware below).
    const graceKey = `rotate-grace:${old.id}`;
    try {
      setSecret(graceKey, graceExpiry);
    } catch {
      // If secret store fails, still proceed — old token will be revoked immediately
      db.revokeToken(id);
    }

    console.log('\n  ✅  Token rotated!\n');
    console.log(`     OLD token  : ${id} → works until ${graceExpiry} (24h grace period)`);
    console.log(`     NEW token ID   : ${newToken.id}`);
    console.log(`     NEW token name : ${newToken.name}`);
    console.log(`     NEW raw token  : ${rawToken}`);
    console.log('\n  Save the new token now — it will NOT be shown again!\n');
    console.log('  Usage: Authorization: Bearer <new-token>\n');
  });

// ─── 17. secrets ─────────────────────────────────────────────────────────────
const secretsCmd = program
  .command('secrets')
  .description('Manage the encrypted .code-intel/.secrets store (AES-256-GCM)');

secretsCmd
  .command('set <key> <value>')
  .description('Store a secret by key')
  .action((key: string, value: string) => {
    try {
      setSecret(key, value);
      console.log(`\n  ✅  Secret "${key}" stored.\n`);
    } catch (err) {
      console.error(`\n  ✗  Failed to store secret: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

secretsCmd
  .command('get <key>')
  .description('Retrieve a secret by key')
  .action((key: string) => {
    try {
      const value = getSecret(key);
      if (value === undefined) {
        console.log(`\n  (no secret named "${key}")\n`);
      } else {
        console.log(`\n  ${key}=${value}\n`);
      }
    } catch (err) {
      console.error(`\n  ✗  Failed to read secrets: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

secretsCmd
  .command('delete <key>')
  .description('Remove a secret by key')
  .action((key: string) => {
    try {
      deleteSecret(key);
      console.log(`\n  ✅  Secret "${key}" deleted.\n`);
    } catch (err) {
      console.error(`\n  ✗  Failed to delete secret: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

secretsCmd
  .command('list')
  .description('List all stored secret keys (values are not shown)')
  .action(() => {
    try {
      const keys = listSecretKeys();
      if (keys.length === 0) {
        console.log('\n  No secrets stored.\n');
      } else {
        console.log(`\n  Stored secrets (${keys.length}):\n`);
        keys.forEach((k) => console.log(`    - ${k}`));
        console.log('');
      }
    } catch (err) {
      console.error(`\n  ✗  Failed to list secrets: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

secretsCmd
  .command('backend')
  .description('Show which secret storage backend is active (keytar OS keychain or encrypted file)')
  .action(async () => {
    const { backend } = await keychainBackend();
    console.log(`\n  Backend: ${backend}\n`);
  });

// ─── 18. config validate ──────────────────────────────────────────────────────
program
  .command('config-validate <file>')
  .description('Validate a JSON config file — rejects plaintext secrets, requires $ENV_VAR references')
  .addHelpText('after', `
  Any secret-bearing key (password, api_key, client_secret, etc.) must reference
  an environment variable using $ENV_VAR or \${ENV_VAR} syntax.

  Examples:
    $ code-intel config-validate ./config.json
    $ code-intel config-validate ~/.code-intel/config.json
`)
  .action((file: string) => {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(`\n  ✗  File not found: ${filePath}\n`);
      process.exit(1);
    }
    let cfg: unknown;
    try {
      cfg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`\n  ✗  Could not parse JSON: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
    try {
      assertNoPlaintextSecrets(cfg, file);
      console.log(`\n  ✅  ${file} — no plaintext secrets found.\n`);
    } catch (err) {
      console.error(`\n${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

// ─── ensure .code-intel/ has correct permissions at startup ──────────────────
(function ensurePermissions() {
  try {
    const dir = path.join(os.homedir(), '.code-intel');
    secureMkdir(dir);
    tightenDbFiles(dir);
  } catch {
    /* non-fatal */
  }
})();

program.parse();
