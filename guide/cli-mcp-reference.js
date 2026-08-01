(() => {
  const ROOT = '/libraries/code-intel-platform/versions/1.0.9/pages';

  const CLI_MARKDOWN = `# CLI Reference

This page lists the main CLI commands available in Code Intelligence Platform 1.0.9. The command names are taken from the 1.0.9 CLI source.

## Setup and configuration

\`\`\`bash
code-intel init
code-intel init --reset
code-intel init --yes
code-intel setup
code-intel config get <key>
code-intel config set <key> <value>
code-intel config list
code-intel config validate
code-intel config reset
code-intel completion bash
code-intel completion zsh
code-intel completion fish
code-intel update
code-intel doctor
\`\`\`

## Analysis and indexing

\`\`\`bash
code-intel analyze [path]
code-intel analyze [path] --name <repo-name>
code-intel analyze --force
code-intel analyze --incremental
code-intel analyze --embeddings
code-intel analyze --skip-embeddings
code-intel analyze --parallel
code-intel analyze --profile
code-intel analyze --dry-run
code-intel analyze --skip-agents-md
code-intel analyze --skip-git
code-intel analyze --skip-folders <patterns>
code-intel analyze --skip-files <patterns>
code-intel analyze --verbose
code-intel watch [path]
\`\`\`

### Important behavior in 1.0.9

A non-empty source change triggers a correctness-first full graph rebuild. Vector maintenance is scoped separately: only changed or deleted files have their embeddings updated, while unchanged vectors are preserved.

## Server and MCP

\`\`\`bash
code-intel serve [path]
code-intel serve [path] --port 4747
code-intel serve --detach
code-intel stop [path]
code-intel mcp [path]
\`\`\`

- \`serve\` starts the HTTP API and Web UI.
- \`mcp\` starts the stdio MCP server used by AI coding clients.
- \`stop\` stops a detached server.

## Repository registry

\`\`\`bash
code-intel list
code-intel status [path]
code-intel clean [path]
code-intel clean --all --force
code-intel repo list
code-intel repo show <name>
code-intel repo rename <old-name> <new-name>
code-intel repo relink <name> <new-path>
code-intel repo remove <name>
\`\`\`

Use stable repository names when the same machine indexes multiple projects with similar folder names.

## Search and code exploration

\`\`\`bash
code-intel search <query>
code-intel inspect <symbol>
code-intel impact <symbol>
code-intel context <symbols...> --show-context
code-intel query <gql>
\`\`\`

Recommended workflow:

\`\`\`text
search → inspect → impact → context → change → validate
\`\`\`

## Quality and security

\`\`\`bash
code-intel health
code-intel complexity --top 20
code-intel coverage
code-intel coverage --threshold 80
code-intel secrets
code-intel scan
code-intel scan --severity high --format json
code-intel scan --format sarif
code-intel deprecated
\`\`\`

Static-analysis findings should be reviewed by a developer before being treated as confirmed defects.

## Multi-repository groups

\`\`\`bash
code-intel group create <name>
code-intel group add <group> <hierarchy-path> <repo>
code-intel group remove <group> <hierarchy-path>
code-intel group list [name]
code-intel group sync <name>
code-intel group contracts <name>
code-intel group query <name> <query>
code-intel group status <name>
code-intel group delete <name>
\`\`\`

Groups support monorepo and multi-service investigation, contract extraction, and cross-repository search.

## Global options

\`\`\`bash
code-intel --version
code-intel --help
code-intel --debug <command>
\`\`\`

Use \`--debug\` when you need full stack traces and additional diagnostics.`;

  const MCP_MARKDOWN = `# MCP Tool Reference

Code Intel 1.0.9 exposes the following tools through the stdio MCP server. Start it with:

\`\`\`bash
code-intel mcp /absolute/path/to/indexed-repository
\`\`\`

When \`CODE_INTEL_TOKEN\` is configured, every MCP request must include the \`_token\` property.

## Repository discovery

### \`repos\`
Lists all indexed repositories, including stable IDs, names, paths, indexing time, and statistics.

### \`overview\`
Returns repository node and edge totals, breakdowns by kind, and a high-level health summary. This is the recommended first tool for an unfamiliar repository.

## Search and symbol inspection

### \`search\`
Searches indexed symbols.

Main inputs:

- \`query\` — required search text.
- \`mode\` — \`auto\`, \`bm25\`, or \`vector\`.
- \`scope\` — canonical repository or group scope.
- \`offset\` and \`limit\` — pagination.

Vector mode is vector-preferred with BM25 fallback. Responses report the requested and actual search behavior.

### \`inspect\`
Returns a 360-degree symbol view: definition, source preview, callers, callees, inheritance, members, and cluster.

Input: \`symbol_name\`.

### \`context\`
Builds token-budgeted context containing summary, logic, relationships, and focused source code.

Inputs:

- \`symbols\` — required list of seed symbols.
- \`intent\` — \`code\`, \`callers\`, \`architecture\`, or \`auto\`.
- \`max_tokens\` — maximum context size, capped by the server.
- \`limit\` — maximum number of resolved seeds.

### \`blast_radius\`
Traverses dependencies around a target symbol and returns affected symbols plus a LOW, MEDIUM, or HIGH risk level.

Inputs: \`target\`, \`direction\`, and \`max_hops\`.

### \`file_symbols\`
Lists symbols declared in a file without requiring the agent to read the complete file.

### \`find_path\`
Finds the shortest call/import path between two symbols.

### \`list_exports\`
Lists exported symbols, optionally filtered by symbol kind.

## Routes, architecture, and flows

### \`routes\`
Lists detected HTTP route-handler mappings.

### \`clusters\`
Lists detected code communities and their important symbols.

### \`flows\`
Lists execution flows from entry points through ordered graph steps.

### \`cluster_summary\`
Returns a richer explanation of a selected cluster, including purpose, key symbols, dependencies, and health.

## Change and pull-request analysis

### \`detect_changes\`
Reads a Git diff, maps changed lines to symbols, and calculates combined impact.

Inputs: \`base_ref\` or raw \`diff_text\`.

### \`pr_impact\`
Summarizes the impact of pull-request or changed-file scope, including likely affected symbols and modules.

### \`explain_relationship\`
Explains why and how two symbols or modules are related in the graph.

### \`suggest_tests\`
Suggests tests for a symbol based on callers, call paths, existing tests, and uncovered dependents.

## Graph query tools

### \`query\`
Executes Code Intel GQL.

Examples:

\`\`\`text
FIND function WHERE name CONTAINS "auth"
TRAVERSE CALLS FROM "handleLogin" DEPTH 3
PATH FROM "createUser" TO "sendEmail"
COUNT function GROUP BY cluster
\`\`\`

### \`raw_query\`
Runs a simplified Cypher-like query such as \`name='runPipeline'\` or \`:function\`.

## Multi-repository tools

### \`group_list\`
Lists groups or the complete membership of one group.

### \`group_sync\`
Extracts cross-repository contracts and resolves provider-consumer links.

### \`group_contracts\`
Returns contracts and confidence-ranked cross-repository links, with filters for kind, repository, and confidence.

### \`group_query\`
Runs merged search across all repositories in a group.

### \`group_status\`
Reports repository freshness and synchronization status for group members.

## Similarity, health, and quality

### \`similar_symbols\`
Finds symbols with similar names or structures.

### \`health_report\`
Returns dead code, cycles, god nodes, orphan files, and complexity hotspots for a scope.

### \`complexity_hotspots\`
Ranks functions and methods by cyclomatic complexity.

### \`coverage_gaps\`
Finds exported symbols without detected test coverage and ranks them by blast radius.

### \`deprecated_usage\`
Finds usage of deprecated APIs.

## Security tools

### \`secrets\`
Scans for hardcoded API keys, passwords, tokens, private keys, and high-entropy strings.

Inputs include \`scope\` and \`includeTestFiles\`.

### \`vulnerability_scan\`
Scans for SQL injection, XSS, SSRF, path traversal, and command injection signals.

Inputs include repository, scope, vulnerability types, and minimum severity.

## Recommended MCP workflows

### Understand a feature

\`\`\`text
overview → search → inspect → context
\`\`\`

### Safely change a symbol

\`\`\`text
search → inspect → blast_radius → suggest_tests → context
\`\`\`

### Review a pull request

\`\`\`text
detect_changes / pr_impact → explain_relationship → suggest_tests → health_report
\`\`\`

### Investigate architecture

\`\`\`text
clusters → cluster_summary → find_path → list_exports
\`\`\`

### Security review

\`\`\`text
secrets → vulnerability_scan → inspect → blast_radius
\`\`\`

## Timeouts and response size

MCP tools default to a 30-second timeout. Configure \`CODE_INTEL_MCP_TIMEOUT_MS\` to change it. A timeout returns a non-fatal truncated response rather than terminating the MCP session.

Use default limits first and paginate only when needed to keep agent token usage low.`;

  const customPages = {
    'cli-reference': { title: 'CLI Reference', group: 'Reference', markdown: CLI_MARKDOWN },
    'mcp-reference': { title: 'MCP Tool Reference', group: 'Reference', markdown: MCP_MARKDOWN },
  };

  function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
  }

  function addCodeButtons(container) {
    container.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-code')) return;
      const button = document.createElement('button');
      button.className = 'copy-code';
      button.type = 'button';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(pre.querySelector('code')?.innerText || pre.innerText);
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = 'Copy'), 1200);
      });
      pre.appendChild(button);
    });
  }

  function buildToc(container) {
    const toc = document.querySelector('#tocNav');
    if (!toc) return;
    toc.innerHTML = '';
    const used = new Map();
    container.querySelectorAll('h2, h3').forEach((heading) => {
      const base = slugify(heading.textContent || 'section');
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      heading.id = count ? `${base}-${count + 1}` : base;
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      link.className = heading.tagName === 'H3' ? 'level-3' : 'level-2';
      toc.appendChild(link);
    });
  }

  function renderCustom(slug, push = false) {
    const page = customPages[slug];
    if (!page) return false;
    if (push) history.pushState({}, '', `${ROOT}/${slug}`);

    const content = document.querySelector('#content');
    const title = document.querySelector('#pageTitle');
    const mobile = document.querySelector('#mobilePageTitle');
    const meta = document.querySelector('#pageMeta');
    const breadcrumbs = document.querySelector('#breadcrumbs');
    if (!content || !title) return false;

    title.textContent = page.title;
    if (mobile) mobile.textContent = page.title;
    if (meta) meta.innerHTML = '<span class="meta-pill">1.0.9</span><span class="meta-pill">Source verified</span><span class="meta-pill">CLI & MCP reference</span>';
    if (breadcrumbs) breadcrumbs.innerHTML = '<span>Libraries</span><span>code-intel-platform</span><span>1.0.9</span><span>Reference</span>';
    document.title = `${page.title} — Code Intelligence Platform 1.0.9`;

    content.innerHTML = DOMPurify.sanitize(marked.parse(page.markdown));
    content.querySelectorAll('pre code').forEach((block) => window.hljs?.highlightElement(block));
    addCodeButtons(content);
    buildToc(content);

    document.querySelectorAll('.page-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.customSlug === slug);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }

  function installLinks() {
    const nav = document.querySelector('#pageNav');
    if (!nav || nav.dataset.referenceInstalled === 'true') return;
    nav.dataset.referenceInstalled = 'true';

    const heading = document.createElement('div');
    heading.className = 'sidebar-heading';
    heading.innerHTML = '<span>Reference</span><span class="count">2</span>';
    nav.appendChild(heading);

    Object.entries(customPages).forEach(([slug, page]) => {
      const link = document.createElement('a');
      link.className = 'page-link';
      link.href = `${ROOT}/${slug}`;
      link.textContent = page.title;
      link.dataset.customSlug = slug;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        renderCustom(slug, true);
      });
      nav.appendChild(link);
    });

    const count = document.querySelector('#pageCount');
    if (count) count.textContent = String(Number(count.textContent || '0') + 2);
  }

  function route() {
    installLinks();
    const slug = location.pathname.match(/\/pages\/([^/]+)/)?.[1];
    if (slug && customPages[slug]) renderCustom(slug);
  }

  window.addEventListener('DOMContentLoaded', () => setTimeout(route, 100));
  window.addEventListener('popstate', () => setTimeout(route, 0));
  setTimeout(route, 350);
})();