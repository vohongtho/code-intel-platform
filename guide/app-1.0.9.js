const VERSION = '1.0.9';
const REF = 'release/1.0.9';
const ROOT = `/libraries/code-intel-platform/versions/${VERSION}/pages`;

const pages = [
  { group: 'Getting Started', slug: 'overview', title: 'Overview', markdown: `# Code Intelligence Platform 1.0.9

Code Intelligence Platform is a local static code-intelligence tool that parses source code, builds a knowledge graph, and exposes it through a Web UI, CLI, HTTP API, and MCP server.

It is designed for developers and AI coding agents that need symbol-aware navigation, dependency reasoning, blast-radius analysis, contextual search, and code-quality checks.

## What is new in 1.0.9

Version 1.0.9 improves incremental vector update correctness and efficiency.

- Any non-empty source change still triggers a correctness-first full graph rebuild.
- Embeddings are deleted and regenerated only for changed files.
- Deleted files remove only their own vectors.
- Unchanged vectors are preserved.
- Zero-change analysis performs no vector writes.
- A full vector rebuild happens only for first use, \`--force\`, missing vector storage, stale or incompatible metadata, or unknown change scope.

## Recommended workflow

\`Search → Inspect → Impact → Context → Change → Validate\`

## Main interfaces

- **Web UI** for graph exploration, source preview, GQL queries, and AI chat.
- **CLI** for analysis, search, inspection, impact analysis, health, complexity, coverage, and security scanning.
- **MCP server** for Codex, Claude Code, Cursor, Copilot, OpenCode, and other agents.
- **HTTP API** for automation and integration.

## Supported languages

TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Ruby, Swift, Kotlin, Dart, and HTML.` },
  { group: 'Getting Started', slug: 'installation', title: 'Installation', markdown: `# Installation

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git
- Linux, macOS, or Windows through WSL2

Verify prerequisites:

\`\`\`bash
node --version
npm --version
git --version
\`\`\`

## Install version 1.0.9 from npm

\`\`\`bash
npm install -g @vohongtho.infotech/code-intel@1.0.9
\`\`\`

Verify:

\`\`\`bash
code-intel --version
\`\`\`

Expected output:

\`\`\`text
1.0.9
\`\`\`

## Upgrade from an earlier version

\`\`\`bash
npm install -g @vohongtho.infotech/code-intel@1.0.9
code-intel --version
\`\`\`

A forced rebuild is not required only because of the 1.0.9 vector planner change. Use \`code-intel analyze --force\` when upgrading an old pre-1.0.8 index, when metadata is stale or incompatible, when vector storage is missing or corrupted, or when you intentionally need a complete rebuild.

## Install from source

\`\`\`bash
git clone --branch release/1.0.9 https://github.com/vohongtho/code-intel-platform.git
cd code-intel-platform
npm install
npm run build
npm install -g ./code-intel/core
code-intel --version
\`\`\`

## Diagnose installation

\`\`\`bash
code-intel doctor
\`\`\`

The doctor command checks Node.js, Git, configuration, registry access, graph database integrity, and network prerequisites.

## Common issues

### Command not found

Ensure the npm global binary directory is present in \`PATH\`, then restart the terminal.

### Permission denied

Use a Node version manager or configure a user-owned npm prefix instead of running arbitrary npm installs with \`sudo\`.

### Install-script warnings

The package may require install scripts for LadybugDB, ONNX Runtime, Sharp, and Protobuf. Approve only dependencies expected by the package and review security policy before enabling scripts globally.` },
  { group: 'Getting Started', slug: 'quick-start', title: 'Quick Start', markdown: `# Quick Start

## 1. Open the target repository

\`\`\`bash
cd /path/to/project
\`\`\`

## 2. Analyze the repository

\`\`\`bash
code-intel analyze
\`\`\`

Assign a stable repository name:

\`\`\`bash
code-intel analyze . --name api-core
\`\`\`

## 3. Start the Web UI

\`\`\`bash
code-intel serve
\`\`\`

Open \`http://localhost:4747\`.

## 4. Search for behavior

\`\`\`bash
code-intel search "authentication middleware"
\`\`\`

## 5. Inspect a symbol

\`\`\`bash
code-intel inspect AuthService.login
\`\`\`

## 6. Check impact

\`\`\`bash
code-intel impact AuthService.login
\`\`\`

## 7. Build focused AI context

\`\`\`bash
code-intel context AuthService.login --show-context
\`\`\`

## 8. Keep the index updated

\`\`\`bash
code-intel watch
\`\`\`` },
  { group: 'Core Usage', slug: 'analyze', title: 'Analyze a Repository', markdown: `# Analyze a Repository

## Purpose

\`code-intel analyze\` creates or refreshes the knowledge graph, BM25 index, metadata, and optional vector embeddings.

## Syntax

\`\`\`bash
code-intel analyze [path] [options]
\`\`\`

## Common examples

\`\`\`bash
code-intel analyze
code-intel analyze ../my-api
code-intel analyze ../my-api --name api-core
code-intel analyze --embeddings
code-intel analyze --parallel
code-intel analyze --profile
code-intel analyze --dry-run
code-intel analyze --force
\`\`\`

## Incremental graph behavior in 1.0.9

Code Intel detects committed, staged, unstaged, untracked, mtime-changed, and deleted files.

- **Zero changes:** keep the fast path and preserve existing graph and vector state.
- **Any source change:** perform a clean full graph rebuild to preserve cross-file calls, imports, inheritance, clusters, and flows.

## Incremental vector behavior in 1.0.9

Graph execution scope and vector update scope are separate.

- Changed files: delete and upsert vectors only for those files.
- Deleted files: remove vectors only for those files.
- Unchanged files: preserve existing vectors.
- Zero-change run: do not write the vector database.

A full vector rebuild is limited to:

1. First embedding build.
2. Explicit \`--force\`.
3. Missing vector storage.
4. Stale or incompatible embedding metadata.
5. Unknown change scope.

## Exclusions

Use \`.codeintelignore\` for team rules and \`.codeintelignore.local\` for personal rules.

\`\`\`gitignore
node_modules
coverage
dist
src/generated
**/*.generated.ts
\`\`\`

## When to use --force

Use it after old index migrations, parser changes, index corruption, incompatible metadata, or when you explicitly need a complete graph and vector rebuild.` },
  { group: 'Core Usage', slug: 'web-ui', title: 'Web UI', markdown: `# Web UI

## Start the server

\`\`\`bash
code-intel serve
\`\`\`

Specify a path and port:

\`\`\`bash
code-intel serve /path/to/project --port 4747
\`\`\`

## Main areas

### Graph Explorer

Explore files, classes, methods, functions, and relationships in a force-directed graph.

### Source Preview

Open syntax-highlighted source at the exact symbol location and use the editor deep link when supported.

### Query Console

Run GQL statements and inspect sortable results, history, and examples.

### Settings

Authenticated users can view configuration. Admin users can update supported server settings.

### AI Chat

The grounded assistant uses indexed source context and cites source files.

## Keep data synchronized

Run \`code-intel watch\` in another terminal.

## Reloading deep routes

Version 1.0.9 includes the SPA routing fix introduced before this release, so direct access and reloads for routes such as \`/explore\` and \`/settings/...\` should serve the Web UI correctly.` },
  { group: 'Core Usage', slug: 'search-inspect-impact', title: 'Search, Inspect & Impact', markdown: `# Search, Inspect, and Impact

## Search

\`\`\`bash
code-intel search "payment retry"
\`\`\`

Search supports lexical BM25, semantic vector search, and hybrid behavior. Search responses report requested and actual modes truthfully when vector fallback occurs.

## Inspect

\`\`\`bash
code-intel inspect PaymentService.retry
\`\`\`

Use inspect to review source location, signature, snippet, callers, callees, imports, dependencies, and inheritance.

## Impact

\`\`\`bash
code-intel impact PaymentService.retry
\`\`\`

Impact analysis identifies direct and transitive dependents, affected modules, and likely tests.

## Recommended workflow

\`\`\`bash
code-intel search "payment retry"
code-intel inspect PaymentService.retry
code-intel impact PaymentService.retry
code-intel context PaymentService.retry --show-context
\`\`\`

Avoid opening many complete files before identifying the correct symbol and dependency path.` },
  { group: 'AI & MCP', slug: 'mcp-setup', title: 'MCP Setup', markdown: `# MCP Setup

## Prepare the repository

\`\`\`bash
cd /path/to/project
code-intel analyze
code-intel setup
\`\`\`

## Generic MCP configuration

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

Use the exact configuration generated by \`code-intel setup\` for your editor or agent.

## Verify connection

1. Restart the MCP client.
2. Confirm Code Intel tools appear.
3. Ask the client to search for a known symbol.
4. Confirm results reference the intended repository.

## Generated agent instructions

Analysis can generate AGENTS.md, CLAUDE.md, Copilot instructions, Cursor rules, Kiro steering, Cline rules, Windsurf rules, and other supported files.

## Troubleshooting

Use an absolute \`cwd\`, run \`code-intel doctor\`, inspect \`~/.code-intel/logs/\`, and rerun setup after changing the CLI installation path.` },
  { group: 'AI & MCP', slug: 'mcp-tools', title: 'MCP Tools & Workflows', markdown: `# MCP Tools and Workflows

## Core workflow

\`search → inspect → blast_radius → context\`

## Review workflow

\`pr_impact → explain_relationship → suggest_tests → health_report\`

## Useful tools

- \`search\` with \`auto | bm25 | vector\` mode.
- \`context\` with seed symbols, intent, and token budget.
- \`explain_relationship\` for connection reasoning.
- \`pr_impact\` for changed-file impact.
- \`similar_symbols\` for related implementations.
- \`health_report\` for code-health summaries.
- \`suggest_tests\` for impacted test recommendations.
- \`cluster_summary\` for architecture clusters.
- \`complexity_hotspots\` for high-complexity functions.

## Token-efficient use

Start with default limits, paginate only when needed, and prefer symbol-level context over complete files. Enable next-tool hints with:

\`\`\`bash
export CODE_INTEL_SUGGEST_NEXT_TOOLS=true
\`\`\`` },
  { group: 'Advanced Features', slug: 'context-builder', title: 'Context Builder', markdown: `# Context Builder

## Basic use

\`\`\`bash
code-intel context AuthService.login --show-context
\`\`\`

Multiple seeds:

\`\`\`bash
code-intel context AuthController.login AuthService.login UserRepository.findByEmail --show-context
\`\`\`

## Output blocks

- \`[SUMMARY]\`
- \`[LOGIC]\`
- \`[RELATION]\`
- \`[FOCUS CODE]\`

## Intent presets

Use \`code\`, \`callers\`, \`architecture\`, or \`auto\`.

## Token budget

The builder enforces the requested maximum across the complete returned document. Start with precise seed symbols and add related symbols only when needed.` },
  { group: 'Quality & Security', slug: 'quality-security', title: 'Quality & Security', markdown: `# Quality and Security

## Health

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

## Secrets

\`\`\`bash
code-intel secrets
\`\`\`

## Vulnerability scan

\`\`\`bash
code-intel scan
code-intel scan --severity high --format json
code-intel scan --format sarif > code-intel.sarif
\`\`\`

## Deprecated APIs

\`\`\`bash
code-intel deprecated
\`\`\`

Treat findings as static-analysis signals that require developer review, especially around framework wrappers and non-relational query APIs.` },
  { group: 'Configuration', slug: 'configuration', title: 'Configuration', markdown: `# Configuration

## Initialize

\`\`\`bash
code-intel init
\`\`\`

The wizard creates \`~/.code-intel/config.json\`.

## Manage configuration

\`\`\`bash
code-intel config list
code-intel config get <key>
code-intel config set <key> <value>
code-intel config validate
code-intel config reset
\`\`\`

## Embeddings

Run once with:

\`\`\`bash
code-intel analyze --embeddings
\`\`\`

The repository remembers the embedding preference. Later normal analyses keep embeddings updated unless \`--skip-embeddings\` is used.

## Logging

Logs are stored under \`~/.code-intel/logs/\`. Use debug mode when investigating startup, analysis, MCP, or vector-planner problems.

## Repository management

\`\`\`bash
code-intel repo list
code-intel repo show api-core
code-intel repo rename api-core api-platform
code-intel repo relink api-platform ../new-location
\`\`\`` },
  { group: 'Operations', slug: 'troubleshooting', title: 'Troubleshooting', markdown: `# Troubleshooting

## Run diagnostics

\`\`\`bash
code-intel doctor
\`\`\`

## Web UI reports no index

\`\`\`bash
code-intel analyze
code-intel serve
\`\`\`

## Search falls back from vector mode

Check whether embeddings are enabled and ready. Missing, empty, or unavailable vector state should report \`VECTOR_INDEX_UNAVAILABLE\`; vector execution failures should report \`VECTOR_QUERY_FAILED\`.

## Vectors rebuild more often than expected

Check for:

- \`--force\`
- missing vector storage
- stale or incompatible metadata
- unknown change scope
- first-time embedding generation

A normal one-file change should update vectors only for that file while the graph rebuilds fully.

## Deleted source still appears in semantic results

Run a normal analysis. Version 1.0.9 removes vectors belonging to deleted files while preserving unchanged vectors.

## Zero-change run writes vector data

This is not expected in 1.0.9. Run with debug logging and inspect planner output and metadata health.

## Stale or inconsistent graph

\`\`\`bash
code-intel analyze --force
\`\`\`

Use force only when the index, metadata, or storage is unhealthy or a complete rebuild is intentional.

## Logs

Inspect \`~/.code-intel/logs/\` and include the CLI version, repository path, command, and error code when reporting a problem.` }
];

const $ = (s) => document.querySelector(s);
const els = { nav: $('#pageNav'), count: $('#pageCount'), title: $('#pageTitle'), meta: $('#pageMeta'), crumbs: $('#breadcrumbs'), content: $('#content'), toc: $('#tocNav'), source: $('#sourceLink'), search: $('#searchInput'), results: $('#searchResults'), mobileTitle: $('#mobilePageTitle'), sidebar: $('#sidebar'), tocPanel: $('#toc'), backdrop: $('#backdrop'), toast: $('#toast'), copy: $('#copyMarkdown'), openNav: $('#openNav'), openToc: $('#openToc'), version: $('#versionSelect') };

marked.setOptions({ gfm: true, breaks: false });

function slugify(v) { return v.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'section'; }
function route(slug) { return `${ROOT}/${slug}`; }
function activeSlug() { const m = location.pathname.match(/\/pages\/([^/?#]+)/); return m?.[1] || 'overview'; }
function escapeHtml(v) { const d = document.createElement('div'); d.textContent = v; return d.innerHTML; }

function renderNav(slug) {
  els.nav.innerHTML = '';
  els.count.textContent = pages.length;
  let group = '';
  pages.forEach((p) => {
    if (p.group !== group) {
      group = p.group;
      const h = document.createElement('div'); h.className = 'nav-group'; h.textContent = group; els.nav.appendChild(h);
    }
    const a = document.createElement('a');
    a.className = `page-link${p.slug === slug ? ' active' : ''}`;
    a.href = route(p.slug); a.textContent = p.title;
    a.onclick = (e) => { e.preventDefault(); history.pushState({}, '', a.href); render(); closeDrawers(); window.scrollTo(0, 0); };
    els.nav.appendChild(a);
  });
}

function buildToc() {
  els.toc.innerHTML = '';
  const used = new Map();
  const hs = [...els.content.querySelectorAll('h2,h3')];
  hs.forEach((h) => {
    const base = slugify(h.textContent); const n = used.get(base) || 0; used.set(base, n + 1); h.id = n ? `${base}-${n + 1}` : base;
    const a = document.createElement('a'); a.href = `#${h.id}`; a.textContent = h.textContent; a.className = h.tagName === 'H3' ? 'level-3' : 'level-2'; els.toc.appendChild(a);
  });
  if (!hs.length) els.toc.innerHTML = '<span class="search-empty">No subsections</span>';
}

function addCopyButtons() {
  els.content.querySelectorAll('pre').forEach((pre) => {
    const b = document.createElement('button'); b.className = 'copy-code'; b.textContent = 'Copy';
    b.onclick = async () => { await navigator.clipboard.writeText(pre.querySelector('code')?.innerText || pre.innerText); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200); };
    pre.appendChild(b);
  });
}

function render() {
  const slug = activeSlug();
  const page = pages.find((p) => p.slug === slug) || pages[0];
  if (page.slug !== slug) history.replaceState({}, '', route(page.slug));
  els.title.textContent = page.title;
  els.mobileTitle.textContent = page.title;
  els.meta.innerHTML = `<span class="meta-pill">${VERSION}</span><span class="meta-pill">release/1.0.9</span><span class="meta-pill">Native guide content</span>`;
  els.crumbs.innerHTML = `<span>Libraries</span><span>code-intel-platform</span><span>${VERSION}</span><span>${escapeHtml(page.title)}</span>`;
  els.content.innerHTML = DOMPurify.sanitize(marked.parse(page.markdown));
  els.content.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
  addCopyButtons(); buildToc(); renderNav(page.slug);
  els.source.href = `https://github.com/vohongtho/code-intel-platform/tree/${REF}`;
  document.title = `${page.title} — Code Intel ${VERSION}`;
  els.copy.onclick = async () => { await navigator.clipboard.writeText(page.markdown); showToast('Guide copied'); };
}

function search(q) {
  const value = q.trim().toLowerCase();
  if (!value) { els.results.hidden = true; els.results.innerHTML = ''; return; }
  const found = pages.filter((p) => `${p.title} ${p.markdown}`.toLowerCase().includes(value)).slice(0, 10);
  els.results.hidden = false;
  els.results.innerHTML = `<h2>${found.length} result${found.length === 1 ? '' : 's'} for “${escapeHtml(q)}”</h2>`;
  found.forEach((p) => {
    const a = document.createElement('a'); a.className = 'search-result'; a.href = route(p.slug); a.innerHTML = `<strong>${escapeHtml(p.title)}</strong><span>${escapeHtml(p.markdown.replace(/[#*`]/g, ' ').slice(0, 180))}…</span>`;
    a.onclick = (e) => { e.preventDefault(); history.pushState({}, '', a.href); els.search.value = ''; search(''); render(); window.scrollTo(0,0); };
    els.results.appendChild(a);
  });
}

function showToast(m) { els.toast.textContent = m; els.toast.classList.add('show'); setTimeout(() => els.toast.classList.remove('show'), 1500); }
function closeDrawers() { els.sidebar.classList.remove('open'); els.tocPanel.classList.remove('open'); els.backdrop.hidden = true; }
function openDrawer(el) { closeDrawers(); el.classList.add('open'); els.backdrop.hidden = false; }

els.version.innerHTML = `<option value="${REF}">${VERSION}</option>`;
els.search.addEventListener('input', (e) => search(e.target.value));
els.openNav?.addEventListener('click', () => openDrawer(els.sidebar));
els.openToc?.addEventListener('click', () => openDrawer(els.tocPanel));
els.backdrop?.addEventListener('click', closeDrawers);
window.addEventListener('popstate', render);
document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== els.search) { e.preventDefault(); els.search.focus(); } });
render();
