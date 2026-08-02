# MCP Tools and Resources

Start the local stdio server with:

```bash
code-intel mcp /absolute/path/to/indexed-repository
```

## Core repository tools

| Tool | Purpose |
|---|---|
| `repos` | List indexed repositories and statistics. |
| `overview` | Repository node, edge, and health summary. |
| `search` | Scoped BM25 or vector-preferred symbol search. |
| `inspect` | Definition, preview, callers, callees, heritage, members, and cluster. |
| `context` | Token-budgeted summary, logic, relations, and focused code. |
| `blast_radius` | Traverse callers, callees, or both and return a risk level. |
| `file_symbols` | List symbols declared in a file. |
| `find_path` | Find the shortest call/import path between symbols. |
| `list_exports` | List the public API surface, optionally filtered by kind. |
| `routes` | List detected HTTP routes and handlers. |
| `clusters` | List detected code communities. |
| `flows` | List detected execution flows. |

## Change and pull-request analysis

| Tool | Purpose |
|---|---|
| `detect_changes` | Map a Git diff to changed symbols and combined blast radius. |
| `pr_impact` | Summarize changed scope and affected modules. |
| `explain_relationship` | Explain how two symbols or modules are connected. |
| `suggest_tests` | Suggest tests from call paths, callers, and existing tests. |
| `similar_symbols` | Find related names and structures. |

## Query and multi-repository tools

| Tool | Purpose |
|---|---|
| `query` | Execute Code Intel GQL. |
| `raw_query` | Execute the simplified Cypher-like query surface. |
| `group_list` | List groups or group membership. |
| `group_sync` | Extract contracts and resolve cross-repository links. |
| `group_contracts` | Inspect contracts and confidence-ranked links. |
| `group_query` | Search all repositories in a group. |
| `group_status` | Check member index and sync freshness. |

## Quality and security tools

| Tool | Purpose |
|---|---|
| `health_report` | Dead code, cycles, god nodes, orphan files, and hotspots. |
| `cluster_summary` | Purpose, important symbols, dependencies, and health for a cluster. |
| `deprecated_usage` | Find deprecated API usages. |
| `complexity_hotspots` | Rank cyclomatic-complexity hotspots. |
| `coverage_gaps` | Find untested exports ranked by blast radius. |
| `secrets` | Scan for hardcoded secret signals. |
| `vulnerability_scan` | Scan for SQL injection, XSS, SSRF, path traversal, and command injection signals. |

## Search behavior

`search.mode` accepts:

- `auto`
- `bm25`
- `vector`

In 1.0.9, vector mode is vector-preferred with BM25 fallback. The response should distinguish the requested mode from the actual execution mode.

Canonical scope:

```json
{
  "query": "authentication flow",
  "mode": "auto",
  "scope": {
    "type": "repo",
    "name": "api-core"
  },
  "limit": 10
}
```

The legacy top-level `repo` and `group` fields remain available during migration but are deprecated.

## MCP resources

Code Intel 1.0.9 also registers three read-only resources for the active repository:

```text
codeintel://repo/<repo-name>/overview
codeintel://repo/<repo-name>/clusters
codeintel://repo/<repo-name>/flows
```

Use resources for stable repository context and tools for parameterized investigation.

## MCP prompts

The 1.0.9 MCP server does **not** register a `prompts` capability. Guided prompt templates such as architecture mapping or impact review currently live in the documentation and agent instruction files, not in MCP prompt discovery.

## Authentication

When `CODE_INTEL_TOKEN` is configured, every tool schema exposes an `_token` input and calls must provide the matching value.

```bash
export CODE_INTEL_TOKEN="replace-with-a-long-random-token"
code-intel mcp /absolute/path/to/repository
```

This is tool-argument authentication. Most MCP clients do not automatically inject `_token`, so confirm that the selected client can provide it before enabling the variable.

## Timeout

The default MCP tool timeout is 30 seconds.

```bash
export CODE_INTEL_MCP_TIMEOUT_MS=60000
```

A timeout returns a non-fatal truncated response instead of terminating the MCP session.

## Recommended workflows

### Understand a feature

```text
overview → search → inspect → context
```

### Safely change a symbol

```text
search → inspect → blast_radius → suggest_tests → context
```

### Review a pull request

```text
detect_changes / pr_impact → explain_relationship → suggest_tests → health_report
```

### Investigate architecture

```text
clusters → cluster_summary → find_path → list_exports
```

### Security review

```text
secrets → vulnerability_scan → inspect → blast_radius
```

## Metadata note

The package version is 1.0.9, but the MCP server currently identifies itself internally as version `0.1.0`. This is a product-code issue to fix in a later release; clients should use the installed CLI version as the authoritative package version.