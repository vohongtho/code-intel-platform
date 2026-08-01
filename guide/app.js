const ROOT_ROUTE = '/libraries/code-intel-platform/versions/1.0.8/pages';
const VERSION = '1.0.8';

const pages = [
  { group: 'Getting Started', slug: 'overview', title: 'Overview', markdown: `# Code Intelligence Platform

Code Intelligence Platform is a local static code-intelligence tool that parses a repository, builds a knowledge graph, and exposes the result through a Web UI, CLI, HTTP API, and MCP server.

It is designed for developers and AI coding agents that need more than text search. Instead of only finding matching lines, Code Intel identifies symbols, calls, imports, inheritance, blast radius, related code, architecture clusters, and test gaps.

## What the tool builds

After analysis, the repository contains a generated \`.code-intel\` directory with graph data, search indexes, repository metadata, and optional vector embeddings.

The graph contains files, classes, interfaces, methods, functions, variables, and modules. Relationships include calls, imports, contains, belongs-to, extends, and implements.

## Main ways to use Code Intel

- **Web UI** for visual exploration, source preview, graph navigation, and GQL queries.
- **CLI** for analysis, search, inspection, impact analysis, health checks, scanning, and automation.
- **MCP server** for Codex, Claude Code, Cursor, Copilot, OpenCode, and other AI agents.
- **HTTP API** for application and workflow integration.

## Recommended workflow

\`Search → Inspect → Impact → Context → Change → Validate\`

1. Search for the relevant concept or symbol.
2. Inspect the exact definition and relationships.
3. Check blast radius before modifying code.
4. Build focused AI context when needed.
5. Make the change.
6. Re-analyze and run tests or quality checks.

## Supported languages

Version 1.0.8 supports TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Ruby, Swift, Kotlin, Dart, and HTML through Tree-sitter parsers.` },
  { group: 'Getting Started', slug: 'installation', title: 'Installation', markdown: `# Installation

## Requirements

- Node.js 22.17 or newer
- npm 10 or newer
- Git
- Linux, macOS, or Windows through WSL2

Verify prerequisites:

\`\`\`bash
node --version
npm --version
git --version
\`\`\`

## Install globally from npm

\`\`\`bash
npm install -g @vohongtho.infotech/code-intel
\`\`\`

Verify the installation:

\`\`\`bash
code-intel --version
\`\`\`

The expected version is \`1.0.8\` or newer.

## Upgrade an existing installation

\`\`\`bash
npm install -g @vohongtho.infotech/code-intel@latest
\`\`\`

After upgrading to 1.0.8, perform one forced analysis for every existing indexed repository:

\`\`\`bash
cd /path/to/project
code-intel analyze --force
\`\`\`

This publishes the atomic generation layout and refreshes graph relationships, BM25 data, optional vector data, and metadata.

## Install from source

\`\`\`bash
git clone https://github.com/vohongtho/code-intel-platform.git
cd code-intel-platform
npm install
npm run build
npm install -g ./code-intel/core
code-intel --version
\`\`\`

## Diagnose installation problems

\`\`\`bash
code-intel doctor
\`\`\`

The doctor command checks Node.js, Git, configuration, registry access, database integrity, and network prerequisites.

## Common installation issues

### Command not found

Confirm the npm global binary directory is in \`PATH\`, then restart the terminal.

### Permission denied

Avoid running arbitrary npm packages with \`sudo\`. Configure a user-owned npm prefix or use a Node version manager such as nvm.

### Native dependency warning

The package may install native or postinstall dependencies such as LadybugDB, ONNX Runtime, Sharp, or Protobuf. Review npm's allow-scripts warning and approve only dependencies distributed by the package.` },
  { group: 'Getting Started', slug: 'quick-start', title: 'Quick Start', markdown: `# Quick Start

## 1. Open the target repository

\`\`\`bash
cd /path/to/my-project
\`\`\`

## 2. Analyze the repository

\`\`\`bash
code-intel analyze
\`\`\`

Code Intel discovers supported files, parses symbols, resolves relationships, builds the BM25 index, writes repository metadata, and generates AI-agent instruction files.

Assign a stable repository name:

\`\`\`bash
code-intel analyze . --name api-core
\`\`\`

## 3. Start the Web UI

\`\`\`bash
code-intel serve
\`\`\`

Open \`http://localhost:4747\`.

Use another port when required:

\`\`\`bash
code-intel serve . --port 5050
\`\`\`

## 4. Search the repository

\`\`\`bash
code-intel search "authentication middleware"
\`\`\`

## 5. Inspect a symbol

\`\`\`bash
code-intel inspect AuthService.login
\`\`\`

## 6. Check impact before editing

\`\`\`bash
code-intel impact AuthService.login
\`\`\`

## 7. Keep the index updated

\`\`\`bash
code-intel watch
\`\`\`

The watcher detects source saves and refreshes the graph. Version 1.0.8 also detects committed, staged, unstaged, untracked, modified-time changed, and deleted files during analysis.` },
  { group: 'Core Usage', slug: 'analyze', title: 'Analyze a Repository', markdown: `# Analyze a Repository

## Purpose

\`code-intel analyze\` creates or refreshes the knowledge graph and search indexes for a repository.

## Syntax

\`\`\`bash
code-intel analyze [path] [options]
\`\`\`

## Common commands

\`\`\`bash
# Current directory
code-intel analyze

# Another repository
code-intel analyze ../my-api

# Stable repository name
code-intel analyze ../my-api --name api-core

# Clean rebuild
code-intel analyze --force

# Semantic embeddings
code-intel analyze --embeddings

# Parallel parse and resolve
code-intel analyze --parallel

# Preview without changes
code-intel analyze --dry-run

# Pipeline profile
code-intel analyze --profile
\`\`\`

## Incremental behavior in 1.0.8

A zero-change analysis keeps the fast path. When any source change is detected, version 1.0.8 performs a correctness-first clean graph rebuild so cross-file calls, imports, inheritance, clusters, and flows cannot be lost.

Detected changes include committed, staged, unstaged, untracked, modified-time changed, and deleted files.

## Excluding files and folders

Use \`.codeintelignore\` for tracked team rules and \`.codeintelignore.local\` for personal rules.

\`\`\`gitignore
node_modules
coverage
src/generated
**/*.generated.ts
**/*.min.js
\`\`\`

Per-run exclusions are available through \`--skip-folders\` and \`--skip-files\`.

## When to use --force

Use a forced rebuild after a major upgrade, parser change, index corruption, discovery configuration change, or when graph results appear stale.` },
  { group: 'Core Usage', slug: 'web-ui', title: 'Web UI', markdown: `# Web UI

## Start the server

The repository must already have an index.

\`\`\`bash
code-intel serve
\`\`\`

Specify a repository path and port:

\`\`\`bash
code-intel serve /path/to/project --port 4747
\`\`\`

## Main screens

### Graph Explorer

Explore files, classes, methods, functions, and relationships in a force-directed graph. Filter by node type and inspect connected code.

### Source Preview

Selecting a graph node opens syntax-highlighted source at the exact line. Open in editor uses a \`vscode://\` link when supported.

### Query Console

Run Graph Query Language statements and inspect sortable results, query history, and examples.

### AI Chat

The grounded assistant uses indexed source context and cites source files. Configure an LLM provider before using it.

## Keep the UI synchronized

Run in another terminal:

\`\`\`bash
code-intel watch
\`\`\`

## Troubleshooting

If no index exists, run \`code-intel analyze\`. If the port is occupied, use \`--port 5050\`. If data appears stale, run \`code-intel analyze --force\`.` },
  { group: 'Core Usage', slug: 'search-inspect-impact', title: 'Search, Inspect & Impact', markdown: `# Search, Inspect, and Impact

These commands form the core investigation workflow.

## Search

\`\`\`bash
code-intel search "payment retry"
\`\`\`

Use conceptual phrases for behavior or exact names for known symbols. Search modes include BM25, vector, and hybrid behavior. When vector data is available, hybrid ranking combines lexical and vector results using reciprocal rank fusion.

## Inspect

\`\`\`bash
code-intel inspect PaymentService.retry
\`\`\`

Review source location, signature, snippet, enclosing type, callers, callees, imports, dependencies, and inheritance relationships.

## Impact

\`\`\`bash
code-intel impact PaymentService.retry
\`\`\`

Use impact analysis to identify direct callers, transitive dependents, affected modules, and likely tests.

## Recommended workflow

\`\`\`bash
code-intel search "payment retry"
code-intel inspect PaymentService.retry
code-intel impact PaymentService.retry
code-intel context PaymentService.retry --show-context
\`\`\`

## Common mistake

Do not begin by opening many complete files. Search for the concept, inspect the best symbol, and expand through relationships.` },
  { group: 'AI & MCP', slug: 'mcp-setup', title: 'MCP Setup', markdown: `# MCP Setup

The MCP server exposes Code Intel search and reasoning tools to AI coding agents.

## Prepare the repository

\`\`\`bash
cd /path/to/project
code-intel analyze
code-intel setup
\`\`\`

The setup wizard configures supported editors and agents, LLM provider, embeddings, authentication, port, shell completion, and hooks.

## General MCP configuration

An MCP client needs a command that launches Code Intel and a working directory pointing to the indexed repository.

\`\`\`json
{
  "mcpServers": {
    "code-intel": {
      "command": "code-intel",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/project"
    }
  }
}
\`\`\`

Use the exact command generated by \`code-intel setup\` for your installed version and client.

## Verify connection

1. Restart the MCP client.
2. Confirm Code Intel tools appear.
3. Ask the agent to search for a known symbol.
4. Verify results reference the indexed repository.

## Generated instructions

Analysis can generate \`AGENTS.md\`, \`CLAUDE.md\`, Copilot instructions, Cursor rules, Kiro steering, Cline rules, Windsurf rules, and others.

## Troubleshooting MCP

Run \`code-intel doctor\`, use an absolute working directory, restart the client, inspect \`~/.code-intel/logs/\`, and re-run setup when the executable path changes.` },
  { group: 'AI & MCP', slug: 'mcp-tools', title: 'MCP Tools & Workflows', markdown: `# MCP Tools and Workflows

## Reasoning tools

Version 1.0.8 includes tools such as:

- \`explain_relationship\` — explain how symbols or modules connect.
- \`pr_impact\` — analyze likely impact of changed files.
- \`similar_symbols\` — find structurally or semantically similar code.
- \`health_report\` — summarize code-health findings.
- \`suggest_tests\` — recommend tests for changed or impacted symbols.
- \`cluster_summary\` — summarize an architecture cluster.
- \`complexity_hotspots\` — identify high-complexity functions.

## Feature investigation

\`search → inspect → blast_radius → context\`

## Code review

\`pr_impact → explain_relationship → suggest_tests → health_report\`

## Refactoring workflow

1. Search for the responsibility.
2. Inspect the primary symbol.
3. Find similar symbols.
4. Calculate blast radius.
5. Request suggested tests.
6. Make the smallest safe change.
7. Re-analyze and validate.

## Token-efficient use

Start with default limits and paginate only when needed. Enable next-tool hints with \`CODE_INTEL_SUGGEST_NEXT_TOOLS=true\`. Prefer symbol-level context over sending many full files.` },
  { group: 'Advanced Features', slug: 'context-builder', title: 'Context Builder', markdown: `# Context Builder

The Context Builder creates a focused document for AI tasks from one or more seed symbols.

## Basic command

\`\`\`bash
code-intel context AuthService.login --show-context
\`\`\`

Use multiple symbols for cross-component work:

\`\`\`bash
code-intel context AuthController.login AuthService.login UserRepository.findByEmail --show-context
\`\`\`

## Context structure

- \`[SUMMARY]\` — concise explanation.
- \`[LOGIC]\` — important implementation snippets.
- \`[RELATION]\` — callers, callees, and graph relationships.
- \`[FOCUS CODE]\` — primary source for requested symbols.

## Intent presets

Use \`code\` for implementation, \`callers\` for dependency analysis, \`architecture\` for component understanding, or \`auto\` for inference.

## Best practices

Start with one or two precise symbols, inspect first, add related symbols only when required, and verify output includes expected callers and logic.

## Token budget

The builder estimates tokens across summary, logic, relation, and focus-code blocks. Inspect the generated output when downstream model limits are strict.` },
  { group: 'Quality & Security', slug: 'quality-security', title: 'Quality & Security', markdown: `# Quality and Security Commands

## Code health

\`\`\`bash
code-intel health
\`\`\`

Reports dead code, circular dependencies, god nodes, orphan files, and a 0–100 health score.

## Complexity

\`\`\`bash
code-intel complexity --top 20
\`\`\`

## Coverage gaps

\`\`\`bash
code-intel coverage
code-intel coverage --threshold 80
\`\`\`

## Secret detection

\`\`\`bash
code-intel secrets
\`\`\`

Detects hardcoded API keys, database URLs, RSA keys, and related patterns.

## Security scan

\`\`\`bash
code-intel scan
code-intel scan --format sarif > code-intel.sarif
\`\`\`

Checks patterns related to SQL injection, XSS, SSRF, path traversal, and command injection.

## Deprecated APIs

\`\`\`bash
code-intel deprecated
\`\`\`

## CI recommendation

Run analysis first, then health, coverage, secrets, scan, and deprecated checks. Store SARIF and profile outputs as workflow artifacts.` },
  { group: 'Configuration', slug: 'configuration', title: 'Configuration', markdown: `# Configuration

## Initialize

\`\`\`bash
code-intel init
\`\`\`

The wizard creates \`~/.code-intel/config.json\`.

## Commands

\`\`\`bash
code-intel config list
code-intel config get <key>
code-intel config set <key> <value>
code-intel config validate
code-intel config reset
\`\`\`

Environment references are supported and secret output is masked.

## LLM providers

AI summaries and chat can use OpenAI, Anthropic, or Ollama. Never commit API keys.

## Embeddings

\`\`\`bash
code-intel analyze --embeddings
\`\`\`

The default model is based on \`all-MiniLM-L6-v2\`. Version 1.0.8 remembers previous semantic-index usage.

## Logging

Logs are stored under \`~/.code-intel/logs/\` with rotation and sensitive-data masking.

## Repository registry

\`\`\`bash
code-intel repo list
code-intel repo show api-core
code-intel repo rename api-core api-platform
code-intel repo relink api-platform ../new-location
\`\`\`

Repository IDs remain stable across rename and relink operations.` },
  { group: 'Operations', slug: 'troubleshooting', title: 'Troubleshooting', markdown: `# Troubleshooting

## Run diagnostics first

\`\`\`bash
code-intel doctor
\`\`\`

Use \`--debug\` with a failing command for stack traces.

## Index is missing

\`\`\`bash
code-intel analyze
\`\`\`

## Results are stale or relationships are missing

\`\`\`bash
code-intel analyze --force
\`\`\`

Restart serve or the MCP client afterward.

## Vector search falls back

\`\`\`bash
code-intel analyze --embeddings
\`\`\`

Responses may report \`VECTOR_INDEX_UNAVAILABLE\` for missing, unbuilt, or empty vector state, and \`VECTOR_QUERY_FAILED\` for execution errors.

## MCP client does not show tools

Use an absolute path, confirm the executable is accessible, re-run setup, restart the client, and inspect logs.

## Port is occupied

\`\`\`bash
code-intel serve --port 5050
\`\`\`

## Memory usage is high

\`\`\`bash
code-intel analyze --max-memory 2048
code-intel analyze --profile
\`\`\`

## OpenAPI YAML is not extracted

Version 1.0.8 discovers YAML filenames but contract extraction parses JSON OpenAPI/Swagger specifications. Convert YAML to JSON for extraction.` }
];

const state = { active: 'overview', markdown: '' };
const $ = (s) => document.querySelector(s);
const els = { pageNav: $('#pageNav'), pageCount: $('#pageCount'), title: $('#pageTitle'), meta: $('#pageMeta'), breadcrumbs: $('#breadcrumbs'), content: $('#content'), tocNav: $('#tocNav'), copy: $('#copyMarkdown'), source: $('#sourceLink'), search: $('#searchInput'), searchResults: $('#searchResults'), mobilePageTitle: $('#mobilePageTitle'), sidebar: $('#sidebar'), toc: $('#toc'), backdrop: $('#backdrop'), openNav: $('#openNav'), openToc: $('#openToc'), toast: $('#toast'), version: $('#versionSelect') };
marked.setOptions({ gfm: true });
function slugify(v){return v.toLowerCase().replace(/[`*_]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')||'section'}
function escapeHtml(v){const d=document.createElement('div');d.textContent=v;return d.innerHTML}
function route(slug){return `${ROOT_ROUTE}/${slug}`}
function parseRoute(){const m=location.pathname.match(/\/pages\/([^/]+)/);if(m&&pages.some(p=>p.slug===m[1]))state.active=m[1]}
function setRoute(slug,replace=false){state.active=slug;history[replace?'replaceState':'pushState']({},'',route(slug))}
function renderSidebar(){els.pageNav.innerHTML='';let group='';for(const p of pages){if(p.group!==group){group=p.group;const h=document.createElement('div');h.className='nav-group';h.textContent=group;els.pageNav.appendChild(h)}const a=document.createElement('a');a.className=`page-link${p.slug===state.active?' active':''}`;a.href=route(p.slug);a.textContent=p.title;a.onclick=e=>{e.preventDefault();setRoute(p.slug);renderPage();closeDrawers();scrollTo(0,0)};els.pageNav.appendChild(a)}els.pageCount.textContent=pages.length}
function headingIds(container){const used=new Map();container.querySelectorAll('h1,h2,h3').forEach(h=>{const b=slugify(h.textContent);const n=used.get(b)||0;used.set(b,n+1);h.id=n?`${b}-${n+1}`:b})}
function buildToc(){els.tocNav.innerHTML='';els.content.querySelectorAll('h2,h3').forEach(h=>{const a=document.createElement('a');a.href=`#${h.id}`;a.textContent=h.textContent;a.className=h.tagName==='H3'?'level-3':'level-2';els.tocNav.appendChild(a)})}
function codeButtons(){els.content.querySelectorAll('pre').forEach(pre=>{const b=document.createElement('button');b.className='copy-code';b.textContent='Copy';b.onclick=async()=>{await navigator.clipboard.writeText(pre.querySelector('code')?.innerText||pre.innerText);b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1200)};pre.appendChild(b)})}
function renderPage(){const p=pages.find(x=>x.slug===state.active)||pages[0];state.markdown=p.markdown;els.title.textContent=p.title;els.mobilePageTitle.textContent=p.title;document.title=`${p.title} — Code Intel Guide`;els.breadcrumbs.innerHTML='<span>Code Intel Guide</span><span>1.0.8</span><span>'+escapeHtml(p.group)+'</span>';els.meta.innerHTML=`<span class="meta-pill">Version ${VERSION}</span><span class="meta-pill">${p.group}</span><span class="meta-pill">Step-by-step guide</span>`;els.content.innerHTML=DOMPurify.sanitize(marked.parse(p.markdown));headingIds(els.content);els.content.querySelectorAll('pre code').forEach(b=>hljs.highlightElement(b));codeButtons();buildToc();renderSidebar();els.source.href='https://github.com/vohongtho/code-intel-platform/tree/release/1.0.8'}
function search(q){q=q.trim().toLowerCase();if(!q){els.searchResults.hidden=true;return}const found=pages.filter(p=>(p.title+' '+p.markdown).toLowerCase().includes(q));els.searchResults.hidden=false;els.searchResults.innerHTML=`<h2>${found.length} result${found.length===1?'':'s'} for “${escapeHtml(q)}”</h2>`;for(const p of found){const a=document.createElement('a');a.className='search-result';a.href=route(p.slug);a.innerHTML=`<strong>${escapeHtml(p.title)}</strong><span>${escapeHtml(p.group)}</span>`;a.onclick=e=>{e.preventDefault();setRoute(p.slug);renderPage();els.search.value='';els.searchResults.hidden=true};els.searchResults.appendChild(a)}}
function toast(m){els.toast.textContent=m;els.toast.classList.add('show');setTimeout(()=>els.toast.classList.remove('show'),1600)}
function closeDrawers(){els.sidebar.classList.remove('open');els.toc.classList.remove('open');els.backdrop.hidden=true}
function openDrawer(x){closeDrawers();x.classList.add('open');els.backdrop.hidden=false}
els.version.innerHTML='<option value="release/1.0.8">1.0.8</option>';els.copy.onclick=async()=>{await navigator.clipboard.writeText(state.markdown);toast('Guide Markdown copied')};els.search.oninput=e=>search(e.target.value);els.openNav.onclick=()=>openDrawer(els.sidebar);els.openToc.onclick=()=>openDrawer(els.toc);els.backdrop.onclick=closeDrawers;window.onpopstate=()=>{parseRoute();renderPage()};document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==els.search){e.preventDefault();els.search.focus()}});parseRoute();renderPage();