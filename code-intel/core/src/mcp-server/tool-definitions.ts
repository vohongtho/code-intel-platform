/**
 * tool-definitions.ts
 *
 * Canonical MCP tool definitions (name, description, JSON-Schema-shaped input schema),
 * with the repo-selector properties already merged in. This is the exact shape the live
 * `ListToolsRequestSchema` handler in `server.ts` returns, hoisted to a standalone module
 * with no runtime dependencies (no SDK classes, no graph/storage imports) so it can be
 * imported cheaply by anything that needs the tool inventory — workflow manifests, workflow
 * schema validation, docs/release-note generation — without pulling in the entire MCP
 * server dependency graph. `server.ts` re-exports `MCP_TOOL_DEFINITIONS` and consumes it
 * directly in its `ListToolsRequestSchema` handler, so there is exactly one source of truth.
 */

// ── Shared _token property injected into every tool schema ─────────────────
const _tokenProp = {
  _token: { type: 'string' as const, description: 'Required if CODE_INTEL_TOKEN is configured' },
};
const _repoSelectorProps = {
  repoId: { type: 'string' as const, description: 'Canonical repository identity (preferred)' },
  repo: { type: 'string' as const, description: 'Legacy repo selector during migration (deprecated)' },
};
const REPO_SELECTABLE_TOOL_NAMES = new Set([
  'overview', 'search', 'context', 'blast_radius', 'file_symbols', 'find_path', 'list_exports', 'routes', 'clusters', 'flows',
  'detect_changes', 'query', 'raw_query', 'explain_relationship', 'pr_impact', 'similar_symbols', 'health_report',
  'suggest_tests', 'cluster_summary', 'deprecated_usage', 'complexity_hotspots', 'coverage_gaps', 'secrets', 'vulnerability_scan',
  'api_contract', 'api_impact', 'api_drift', 'graph_diff',
]);
const withRepoSelector = <T extends { name: string; inputSchema?: { type?: string; properties?: Record<string, unknown> } }>(tool: T): T => (
  REPO_SELECTABLE_TOOL_NAMES.has(tool.name) && tool.inputSchema?.type === 'object'
    ? {
        ...tool,
        inputSchema: {
          ...tool.inputSchema,
          properties: {
            ..._repoSelectorProps,
            ...(tool.inputSchema.properties ?? {}),
          },
        },
      } as T
    : tool
);

/**
 * Canonical MCP tool definitions (name, description, JSON-Schema-shaped input schema),
 * with the repo-selector properties already merged in — this is the exact shape returned
 * by the live `ListToolsRequestSchema` handler below. It is the single source of truth for
 * any tool-name/schema inventory (workflow manifests, workflow validation, docs generation)
 * so those consumers can never drift from what the server actually registers.
 */
export const MCP_TOOL_DEFINITIONS = [
  // ── Core repo tools ──────────────────────────────────────────────────
  {
    name: 'repos',
    description: 'List all indexed repositories with node and edge counts',
    inputSchema: { type: 'object' as const, properties: { ..._tokenProp } },
  },
  {
    name: 'overview',
    description: 'Repository summary: total nodes/edges and a full breakdown of node and edge counts by kind. Use this first to understand the shape of the codebase.',
    inputSchema: { type: 'object' as const, properties: { ..._tokenProp } },
  },

  // ── Search & inspect ─────────────────────────────────────────────────
  {
    name: 'search',
    description: 'Scoped search across indexed symbols with automatic vector/BM25 selection. Accepts canonical scope or legacy repo/group during migration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query (symbol name, keyword, or partial match)' },
        offset: { type: 'number', description: 'Number of results to skip for pagination (default: 0)' },
        limit: { type: 'number', description: 'Max results per page (default: 10, max: 500)' },
        mode: {
          type: 'string',
          enum: ['auto', 'bm25', 'vector'],
          description: 'Search mode: automatic default behavior, BM25-only, or vector-preferred with BM25 fallback',
        },
        scope: {
          type: 'object' as const,
          description: 'Canonical search scope',
          properties: {
            type: { type: 'string', enum: ['repo', 'group'] },
            repoId: { type: 'string', description: 'Canonical repository identity when type=repo' },
            name: { type: 'string', description: 'Group name when type=group' },
          },
        },
        repoId: { type: 'string', description: 'Canonical repository identity (preferred)' },
        repo: { type: 'string', description: 'Legacy repo scope during migration (deprecated)' },
        group: { type: 'string', description: 'Legacy group scope during migration (deprecated)' },
        ..._tokenProp,
      },
      required: ['query'],
    },
  },
  {
    name: 'inspect',
    description: '360° view of a symbol: definition location, callers, callees, heritage (extends/implements), members, cluster, and source preview (first 500 chars)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol_name: { type: 'string', description: 'Exact symbol name to inspect' },
        ..._tokenProp,
      },
      required: ['symbol_name'],
    },
  },
  {
    name: 'context',
    description: 'Token-budgeted deep context for one or more symbols: summary, logic, relations, and focused code snippets built from the shared context builder.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more symbol names to resolve and include as context seeds',
        },
        task: {
          type: 'string',
          description: 'Optional free-text description of what you are trying to do — used to auto-detect intent when `intent` is omitted/auto',
        },
        intent: {
          type: 'string',
          enum: ['code', 'callers', 'architecture', 'auto'],
          description: 'Bias token allocation toward code, callers, architecture, or keep auto-balanced behavior',
        },
        max_tokens: {
          type: 'number',
          description: 'Max total tokens for the built context document (default: 6000, server max: 6000)',
        },
        limit: {
          type: 'number',
          description: 'Max seed symbols to resolve from the provided symbol list (default: 10)',
        },
        ..._tokenProp,
      },
      required: ['symbols'],
    },
  },
  {
    name: 'blast_radius',
    description: 'Impact analysis: traverse the call/import graph to find all symbols that depend on or are affected by a given symbol. Returns risk level (LOW / MEDIUM / HIGH).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', description: 'Target symbol name' },
        direction: {
          type: 'string',
          enum: ['callers', 'callees', 'both'],
          description: 'Which direction to trace — callers (who depends on it), callees (what it depends on), or both (default: both)',
        },
        max_hops: { type: 'number', description: 'Maximum traversal depth (default: 2, max: 10)' },
        ..._tokenProp,
      },
      required: ['target'],
    },
  },
  {
    name: 'file_symbols',
    description: 'List all symbols defined in a specific file — useful to understand what a file exports or contains without reading raw source.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'File path (partial match is supported, e.g. "auth/login.ts")' },
        offset: { type: 'number', description: 'Number of results to skip for pagination (default: 0)' },
        limit: { type: 'number', description: 'Max results per page (default: 10, max: 500)' },
        ..._tokenProp,
      },
      required: ['file_path'],
    },
  },
  {
    name: 'find_path',
    description: 'Find the shortest call/import path between two symbols. Useful for tracing how one module reaches another.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Source symbol name' },
        to: { type: 'string', description: 'Target symbol name' },
        max_hops: { type: 'number', description: 'Maximum path length to search (default: 8)' },
        ..._tokenProp,
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'list_exports',
    description: 'List all exported symbols in the repository. Helps AI understand the public API surface of the codebase.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        kind: {
          type: 'string',
          description: 'Filter by node kind: function | class | interface | method | type_alias | constant | enum (optional)',
        },
        offset: { type: 'number', description: 'Number of results to skip for pagination (default: 0)' },
        limit: { type: 'number', description: 'Max results per page (default: 10, max: 500)' },
        ..._tokenProp,
      },
    },
  },

  // ── Routes, clusters, flows ──────────────────────────────────────────
  {
    name: 'routes',
    description: 'List all HTTP route handler mappings detected in the codebase (kind=route or route/handler/controller files)',
    inputSchema: { type: 'object' as const, properties: { ..._tokenProp } },
  },
  {
    name: 'clusters',
    description: 'List detected code clusters (directory-based communities) with member counts and top 10 symbols each. Useful for understanding code organisation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        offset: { type: 'number', description: 'Number of results to skip for pagination (default: 0)' },
        limit: { type: 'number', description: 'Max clusters per page (default: 10, max: 500)' },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'flows',
    description: 'List all detected execution flows — entry points traced through the call graph. Each flow has a name, entry point, and ordered steps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        offset: { type: 'number', description: 'Number of results to skip for pagination (default: 0)' },
        limit: { type: 'number', description: 'Max flows per page (default: 10, max: 500)' },
        ..._tokenProp,
      },
    },
  },

  // ── Git change impact ─────────────────────────────────────────────────
  {
    name: 'detect_changes',
    description: 'Git-diff impact analysis: detects which source files and line ranges changed (HEAD vs working tree or a custom diff), maps them to graph symbols, and computes the combined blast radius. Ideal for PR review or pre-commit analysis.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        base_ref: {
          type: 'string',
          description: 'Git ref to diff against (default: HEAD). Examples: "HEAD~1", "main", a commit SHA.',
        },
        diff_text: {
          type: 'string',
          description: 'Raw unified diff text. If provided, base_ref is ignored and this diff is parsed directly.',
        },
        ..._tokenProp,
      },
    },
  },

  // ── query (GQL) ────────────────────────────────────────────────────────
  {
    name: 'query',
    description: 'Execute a GQL (Graph Query Language) query. Supports FIND, TRAVERSE, PATH, and COUNT. More expressive than raw_query.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gql: {
          type: 'string',
          description: 'GQL query string. Examples: "FIND function WHERE name CONTAINS \\"auth\\"", "TRAVERSE CALLS FROM \\"handleLogin\\" DEPTH 3", "PATH FROM \\"createUser\\" TO \\"sendEmail\\"", "COUNT function GROUP BY cluster"',
        },
        limit: { type: 'number', description: 'Override LIMIT in the query (optional)' },
        repoId: { type: 'string', description: 'Canonical repository identity (preferred)' },
        repo: { type: 'string', description: 'Legacy repo selector during migration (deprecated)' },
        ..._tokenProp,
      },
      required: ['gql'],
    },
  },

  // ── Raw query ─────────────────────────────────────────────────────────
  {
    name: 'raw_query',
    description: 'Execute a simplified Cypher-like graph query. Supports: name=\'X\' (exact name match) or :kind (list nodes of a kind, max 50)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cypher: { type: 'string', description: "Query string — e.g. name='runPipeline' or :function" },
        ..._tokenProp,
      },
      required: ['cypher'],
    },
  },

  // ── Group / multi-repo tools ──────────────────────────────────────────
  {
    name: 'group_list',
    description: 'List all configured repository groups, or show the full membership of one group. Repository groups track multiple repos as a logical system.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Group name to inspect (optional — omit to list all groups)' },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'group_sync',
    description: 'Extract cross-repo contracts (exports, routes, schemas, events) from every member repo in a group and detect provider→consumer links via name matching and RRF scoring.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Group name to sync' },
        ..._tokenProp,
      },
      required: ['name'],
    },
  },
  {
    name: 'group_contracts',
    description: 'Inspect extracted contracts and confidence-ranked cross-repo links from the last group sync. Supports filtering by kind, repo, and minimum confidence.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Group name' },
        kind: {
          type: 'string',
          enum: ['export', 'route', 'schema', 'event'],
          description: 'Filter by contract kind (optional)',
        },
        repo: { type: 'string', description: 'Filter by registry name (optional)' },
        min_confidence: { type: 'number', description: 'Minimum link confidence 0–1 (default: 0)' },
        ..._tokenProp,
      },
      required: ['name'],
    },
  },
  {
    name: 'group_contract_drift',
    description: 'Compare synchronized group contracts across Git refs using per-repo immutable semantic snapshots. Returns compatibility findings plus certainty/coverage and known-consumer scope.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Group name' },
        base_ref: { type: 'string', description: 'Base Git ref (branch/tag/commit)' },
        head_ref: { type: 'string', description: 'Head Git ref (branch/tag/commit)' },
        base_snapshot_ids: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional per-repo base snapshot ids keyed by repoId' },
        head_snapshot_ids: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional per-repo head snapshot ids keyed by repoId' },
        kind: { type: 'string', enum: ['export', 'route', 'schema', 'event', 'graphql', 'grpc'], description: 'Restrict analysis to one contract kind (optional)' },
        repository_id: { type: 'string', description: 'Restrict analysis to contracts produced by one member repo, by stable repo ID (optional)' },
        limit: { type: 'number', description: 'Presentation limit for returned findings; analysis still computes total findings' },
        allow_cache: { type: 'boolean', description: 'Reuse snapshot cache when available (default: true)' },
        ..._tokenProp,
      },
      required: ['name'],
    },
  },
  {
    name: 'group_query',
    description: 'BM25 search across all repos in a group, merged via Reciprocal Rank Fusion (RRF). Returns a unified ranked list plus per-repo breakdown.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Group name' },
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results per repo (default: 10)' },
        ..._tokenProp,
      },
      required: ['name', 'query'],
    },
  },
  {
    name: 'group_status',
    description: 'Check index freshness and sync staleness for all repos in a group. Flags repos that have not been indexed or are stale (>24h).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Group name' },
        ..._tokenProp,
      },
      required: ['name'],
    },
  },

  // ── Reasoning / analysis tools ────────────────────────────────────────
  {
    name: 'explain_relationship',
    description: 'Explain how two symbols are connected: directed paths, shared imports, and heritage (extends/implements). Returns up to 10 paths with at most 5 hops each.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Source symbol name' },
        to: { type: 'string', description: 'Target symbol name' },
        ..._tokenProp,
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'pr_impact',
    description: 'Given changed files or a unified diff, compute full blast radius with risk scores (HIGH/MEDIUM/LOW), test coverage gaps, and top files to review. Set analysisMode to "semantic-snapshot" (with base_ref/head_ref) to additionally compare the independently-analyzed semantic graphs of two Git refs — the textual-hunk blast radius is retained as evidence, never replaced.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        changedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of changed file paths (relative or absolute)',
        },
        diff: {
          type: 'string',
          description: 'Raw unified diff text. Changed files are extracted automatically.',
        },
        maxHops: {
          type: 'number',
          description: 'Maximum BFS depth for blast radius (default: 2, max: 10)',
        },
        analysisMode: {
          type: 'string',
          enum: ['current-graph', 'semantic-snapshot'],
          description: 'Default "current-graph" (textual-hunk blast radius over the currently published index, unchanged behavior). "semantic-snapshot" additionally builds isolated snapshots of base_ref/head_ref and adds a full semantic graph diff.',
        },
        base_ref: { type: 'string', description: 'Base Git ref (branch/tag/commit); required when analysisMode is "semantic-snapshot"' },
        head_ref: { type: 'string', description: 'Head Git ref (branch/tag/commit); required when analysisMode is "semantic-snapshot"' },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'api_contract',
    description: 'Full contract for one or more HTTP routes: method, normalized path, request/response shape (fields, requiredness, coverage), and known consumers with match certainty. Additive to `routes` — richer evidence for routes whose framework adapter emits API-contract facts (Express, Fastify, NestJS, ASP.NET Core).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', description: 'HTTP method, e.g. GET, POST (omit to match any method)' },
        path: { type: 'string', description: 'Normalized route path, e.g. /users/{} (parameter segments normalized to {})' },
        route_fact_id: { type: 'string', description: 'Exact route fact id from a prior api_contract/api_impact result' },
        route_node_id: { type: 'string', description: "The route's graph node id (as returned by inspect/routes/query)" },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'api_impact',
    description: 'Blast radius for one or more HTTP routes: the route(s) matching the selector plus every statically resolved consumer (fetch/Axios/Angular HttpClient), each with match strategy and certainty. Use before changing a route\'s request/response shape.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', description: 'HTTP method, e.g. GET, POST (omit to match any method)' },
        path: { type: 'string', description: 'Normalized route path, e.g. /users/{} (parameter segments normalized to {})' },
        route_fact_id: { type: 'string', description: 'Exact route fact id from a prior api_contract/api_impact result' },
        route_node_id: { type: 'string', description: "The route's graph node id (as returned by inspect/routes/query)" },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'api_drift',
    description: 'Compares API contracts between two separately indexed repositories (base vs head) and reports compatibility findings (compatible/potentially-breaking/breaking/unknown) with consumer evidence and coverage. Both sides must already be indexed and registered (see the `repos` tool) — this does not perform git branch/ref diffing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        base_repo_id: { type: 'string', description: 'Repo id to use as the base (before) state' },
        head_repo_id: { type: 'string', description: 'Repo id to use as the head (after) state (defaults to the active/selected repo)' },
        ..._tokenProp,
      },
      required: ['base_repo_id'],
    },
  },
  {
    name: 'graph_diff',
    description: 'Compares the semantic graph between two Git refs (branches, tags, or commits) of the active repository: added/removed/changed/moved/renamed symbols, relationship and certainty changes, and API-contract deltas. Each side is analyzed independently in an isolated temporary checkout — never touching the working tree, HEAD, or this repository\'s currently published index — and cached by (ref, analyzer version). Unlike api_drift (which compares two already-indexed, already-registered repositories), this performs the Git ref resolution and analysis itself.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        base_ref: { type: 'string', description: 'Base Git ref (branch/tag/commit)' },
        head_ref: { type: 'string', description: 'Head Git ref (branch/tag/commit)' },
        include_contracts: { type: 'boolean', description: 'Include API-contract deltas (default: true)' },
        allow_cache: { type: 'boolean', description: 'Reuse a cached snapshot when available (default: true); set false to force a full rebuild of both sides' },
        nodes_offset: { type: 'number', description: 'Pagination offset into the node delta list (default: 0)' },
        nodes_limit: { type: 'number', description: 'Max node deltas to return (default: 200, max: 2000)' },
        relationships_offset: { type: 'number', description: 'Pagination offset into the relationship delta list (default: 0)' },
        relationships_limit: { type: 'number', description: 'Max relationship deltas to return (default: 200, max: 2000)' },
        ..._tokenProp,
      },
      required: ['base_ref', 'head_ref'],
    },
  },
  {
    name: 'similar_symbols',
    description: 'Find symbols with similar names or structure using Levenshtein distance and kind matching. Useful for finding related functions, classes, or interfaces.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Symbol name to find similar symbols for' },
        limit: { type: 'number', description: 'Maximum number of results (default: 10, max: 50)' },
        ..._tokenProp,
      },
      required: ['symbol'],
    },
  },
  {
    name: 'health_report',
    description: 'Code health signals for a scope: dead code, cycles, god nodes, orphan files, complexity hotspots',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', description: "Directory scope, e.g. 'src/api/' or '.' for whole repo" },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'suggest_tests',
    description: 'Suggest test cases for a symbol: call paths, suggested cases, existing tests, untested callers',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Symbol name to generate test suggestions for' },
        ..._tokenProp,
      },
      required: ['symbol'],
    },
  },
  {
    name: 'cluster_summary',
    description: 'Rich summary of a module/cluster: purpose, key symbols, dependencies, health',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cluster: { type: 'string', description: "Cluster path e.g. 'src/auth'" },
        ..._tokenProp,
      },
      required: ['cluster'],
    },
  },
  {
    name: 'deprecated_usage',
    description: 'Find usages of deprecated APIs in the codebase',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', description: 'Directory scope filter' },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'complexity_hotspots',
    description: 'Ranked list of functions/methods by cyclomatic complexity. Useful for identifying refactoring candidates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', description: 'Limit to a file path prefix (optional)' },
        limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'coverage_gaps',
    description: 'Find exported symbols with no test coverage, ranked by blast radius. Useful for prioritizing test writing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', description: 'Limit to a file path prefix (optional)' },
        limit: { type: 'number', description: 'Maximum number of untested results to return (default: 20)' },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'secrets',
    description: 'Scan the knowledge graph for hardcoded secrets: API keys, passwords, tokens, private keys, high-entropy strings',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', description: 'Limit scan to files under this path prefix' },
        includeTestFiles: { type: 'boolean', description: 'Include test/spec/fixture files (default: false)' },
        ..._tokenProp,
      },
    },
  },
  {
    name: 'vulnerability_scan',
    description: 'Scan the knowledge graph for OWASP vulnerabilities: SQL injection, XSS, SSRF, path traversal, command injection',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', description: 'Limit scan to files under this path prefix' },
        repo: { type: 'string', description: 'Scope scan to a specific indexed repo name (optional; defaults to current repo)' },
        types: {
          type: 'array',
          items: { type: 'string', enum: ['SQL_INJECTION', 'XSS', 'SSRF', 'PATH_TRAVERSAL', 'COMMAND_INJECTION'] },
          description: 'Vulnerability types to detect (default: all)',
        },
        severity: { type: 'string', description: 'Minimum severity to report: HIGH|MEDIUM|LOW (default: LOW)' },
        ..._tokenProp,
      },
    },
  },
].map(withRepoSelector);
