(() => {
  const ROOT = '/libraries/code-intel-platform/versions/1.0.9/pages';
  const MARKDOWN = `# MCP Client Setup

This page shows how to connect Code Intelligence Platform 1.0.9 to common AI coding clients. The recommended approach is the same style used by GitNexus: install Code Intel globally, index the repository once, then register the local stdio MCP server with a one-line client command where supported.

## Before configuring a client

From the repository root:

\`\`\`bash
npm install -g @vohongtho.infotech/code-intel@1.0.9
code-intel analyze --embeddings
code-intel --version
\`\`\`

Use an absolute repository path in MCP configuration. Example:

\`\`\`text
/home/thomas/projects/api-core
\`\`\`

The MCP server command is:

\`\`\`bash
code-intel mcp /absolute/path/to/repository
\`\`\`

## Claude Code

### Recommended one-line setup

Run from the target repository:

\`\`\`bash
claude mcp add --scope project code-intel -- code-intel mcp "$(pwd)"
\`\`\`

Use user scope when one registration should be available in every project:

\`\`\`bash
claude mcp add --scope user code-intel -- code-intel mcp /absolute/path/to/repository
\`\`\`

Verify:

\`\`\`bash
claude mcp list
claude mcp get code-intel
\`\`\`

Inside Claude Code, run:

\`\`\`text
/mcp
\`\`\`

Then ask:

\`\`\`text
Use Code Intel MCP. Start with overview, search for the authentication flow,
inspect the main symbols, then explain the blast radius before proposing changes.
\`\`\`

### Manual project configuration

Claude Code project scope is stored in \`.mcp.json\`:

\`\`\`json
{
  "mcpServers": {
    "code-intel": {
      "type": "stdio",
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"]
    }
  }
}
\`\`\`

### Recommended CLAUDE.md instruction

\`\`\`markdown
## Code intelligence workflow

Always use Code Intel MCP before broad file reading.
Start with overview or search, then inspect relevant symbols.
Before modifying code, run blast_radius or detect_changes.
After implementation, use suggest_tests and health_report.
Prefer context over loading complete files when symbol-level context is sufficient.
\`\`\`

## OpenAI Codex CLI and Codex app

### Recommended one-line setup

Run from the target repository:

\`\`\`bash
codex mcp add code-intel -- code-intel mcp "$(pwd)"
\`\`\`

Verify:

\`\`\`bash
codex mcp list
\`\`\`

Then start Codex in the repository and ask:

\`\`\`text
Use the code-intel MCP server to understand this repository.
Call overview first, then search, inspect, blast_radius, and context before editing.
\`\`\`

### Manual Codex configuration

Edit \`~/.codex/config.toml\`:

\`\`\`toml
[mcp_servers.code-intel]
command = "code-intel"
args = ["mcp", "/absolute/path/to/repository"]
enabled = true
\`\`\`

Codex app users can also open **Settings → MCP Servers → Add server** and enter the same command and arguments.

### Recommended AGENTS.md instruction

\`\`\`markdown
## Code Intel MCP

For repository understanding and change planning, always use Code Intel MCP.
Use overview/search before reading files, inspect/context for implementation details,
and blast_radius or pr_impact before edits. Use suggest_tests after changes.
\`\`\`

## Cursor

Open **Cursor Settings → Tools & Integrations → MCP** and add a stdio server, or create a project MCP file supported by your Cursor version:

\`\`\`json
{
  "mcpServers": {
    "code-intel": {
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"]
    }
  }
}
\`\`\`

Restart Cursor, open MCP tools, and verify that \`overview\`, \`search\`, and \`inspect\` are visible.

Add a repository rule:

\`\`\`markdown
Use Code Intel MCP for architecture discovery, symbol search, dependency tracing,
blast-radius checks, and test suggestions before making repository-wide changes.
\`\`\`

## VS Code and GitHub Copilot

Use the MCP server configuration supported by your installed VS Code/Copilot version. The stdio server definition is:

\`\`\`json
{
  "servers": {
    "code-intel": {
      "type": "stdio",
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"]
    }
  }
}
\`\`\`

Reload VS Code and confirm Code Intel appears in the MCP server/tool list. Add the same workflow instruction to \`.github/copilot-instructions.md\`.

## Cline

Open **Cline → MCP Servers → Configure MCP Servers** and add:

\`\`\`json
{
  "mcpServers": {
    "code-intel": {
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"],
      "disabled": false
    }
  }
}
\`\`\`

Restart the MCP server from Cline and test with:

\`\`\`text
Use code-intel overview and search to explain the main modules in this repository.
\`\`\`

## Windsurf

Open **Windsurf Settings → Cascade → MCP Servers** and add a stdio server:

\`\`\`json
{
  "mcpServers": {
    "code-intel": {
      "command": "code-intel",
      "args": ["mcp", "/absolute/path/to/repository"]
    }
  }
}
\`\`\`

Reload Windsurf and confirm the Code Intel tools are enabled in Cascade.

## OpenCode

Add Code Intel to the MCP section of your OpenCode configuration using a local stdio command:

\`\`\`json
{
  "mcp": {
    "code-intel": {
      "type": "local",
      "command": ["code-intel", "mcp", "/absolute/path/to/repository"],
      "enabled": true
    }
  }
}
\`\`\`

Restart OpenCode and ask it to call \`overview\` before analyzing the repository.

## Generic MCP-compatible client

Use this server definition:

\`\`\`json
{
  "name": "code-intel",
  "transport": "stdio",
  "command": "code-intel",
  "args": ["mcp", "/absolute/path/to/repository"]
}
\`\`\`

The client must keep stdin/stdout connected to the Code Intel process for the complete MCP session.

## Optional authentication

Set a token before starting the AI client:

\`\`\`bash
export CODE_INTEL_TOKEN="replace-with-a-long-random-token"
\`\`\`

Pass the same environment variable to the MCP process when the client does not inherit your shell environment. Every Code Intel MCP tool request must then include \`_token\`.

## Windows and WSL

Prefer running Code Intel and the AI client inside the same WSL distribution.

Find the executable:

\`\`\`bash
which code-intel
\`\`\`

When the client runs on Windows but Code Intel runs in WSL, use a wrapper command instead of mixing Windows and Linux paths. Native Windows clients may require \`cmd /c\` for npm-based commands.

## Verify the integration

Use this sequence after setup:

1. Confirm the repository is indexed with \`code-intel status\`.
2. Confirm the client lists the \`code-intel\` MCP server.
3. Call \`overview\`.
4. Search for a known class or function.
5. Inspect one returned symbol.
6. Run \`blast_radius\` for that symbol.
7. Restart the client and repeat one call to confirm the configuration persists.

## Recommended first prompt

\`\`\`text
Use Code Intel MCP as the primary repository intelligence source.

1. Call overview to understand the repository shape.
2. Search for the feature or defect described in my request.
3. Inspect the most relevant symbols.
4. Use find_path or explain_relationship when the connection is unclear.
5. Run blast_radius before proposing edits.
6. Build focused context for implementation.
7. After changes, run detect_changes or pr_impact and suggest_tests.

Do not begin with broad recursive file reading unless Code Intel cannot resolve the target.
\`\`\`

## Troubleshooting

### Command not found

Use the absolute executable returned by \`which code-intel\` as the MCP command.

### Server connects but no repository data appears

Run:

\`\`\`bash
cd /absolute/path/to/repository
code-intel analyze --embeddings
code-intel status
\`\`\`

### Wrong repository is queried

Use a fixed absolute repository path in the MCP arguments rather than relying on client working directory.

### Client reports connection closed

Run the exact server command in a terminal. It should remain active and wait on stdio:

\`\`\`bash
code-intel mcp /absolute/path/to/repository
\`\`\`

Check \`~/.code-intel/logs/\` and retry with the absolute Code Intel executable path.`;

  function slugify(v) { return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
  function render(push = false) {
    if (push) history.pushState({}, '', `${ROOT}/mcp-client-setup`);
    const content = document.querySelector('#content');
    if (!content) return;
    document.querySelector('#pageTitle').textContent = 'MCP Client Setup';
    const mobile = document.querySelector('#mobilePageTitle'); if (mobile) mobile.textContent = 'MCP Client Setup';
    const meta = document.querySelector('#pageMeta'); if (meta) meta.innerHTML = '<span class="meta-pill">1.0.9</span><span class="meta-pill">Claude Code</span><span class="meta-pill">Codex</span><span class="meta-pill">Multi-client</span>';
    const breadcrumbs = document.querySelector('#breadcrumbs'); if (breadcrumbs) breadcrumbs.innerHTML = '<span>Libraries</span><span>code-intel-platform</span><span>1.0.9</span><span>AI & MCP</span>';
    document.title = 'MCP Client Setup — Code Intelligence Platform 1.0.9';
    content.innerHTML = DOMPurify.sanitize(marked.parse(MARKDOWN));
    content.querySelectorAll('pre code').forEach((b) => window.hljs?.highlightElement(b));
    document.querySelectorAll('.page-link').forEach((l) => l.classList.toggle('active', l.dataset.mcpClientSetup === 'true'));
    const toc = document.querySelector('#tocNav'); if (toc) { toc.innerHTML = ''; content.querySelectorAll('h2,h3').forEach((h) => { h.id = slugify(h.textContent || 'section'); const a = document.createElement('a'); a.href = `#${h.id}`; a.textContent = h.textContent; a.className = h.tagName === 'H3' ? 'level-3' : 'level-2'; toc.appendChild(a); }); }
    window.scrollTo({top:0});
  }
  function install() {
    const nav = document.querySelector('#pageNav');
    if (!nav || nav.dataset.mcpClientSetupInstalled) return;
    nav.dataset.mcpClientSetupInstalled = 'true';
    const link = document.createElement('a'); link.className = 'page-link'; link.href = `${ROOT}/mcp-client-setup`; link.textContent = 'MCP Client Setup'; link.dataset.mcpClientSetup = 'true'; link.addEventListener('click', (e) => { e.preventDefault(); render(true); });
    const mcpLink = [...nav.querySelectorAll('.page-link')].find((a) => /MCP Setup/i.test(a.textContent || ''));
    if (mcpLink?.nextSibling) nav.insertBefore(link, mcpLink.nextSibling); else nav.appendChild(link);
    const count = document.querySelector('#pageCount'); if (count) count.textContent = String(Number(count.textContent || '0') + 1);
  }
  function route() { install(); const route = new URLSearchParams(location.search).get('route'); const path = route || location.pathname; if (path.endsWith('/mcp-client-setup')) render(false); }
  window.addEventListener('DOMContentLoaded', () => setTimeout(route, 120));
  window.addEventListener('popstate', () => setTimeout(route, 0));
  setTimeout(route, 400);
})();