# Project Context — Code Intelligence Platform

## Product

Code Intelligence Platform statically analyzes source repositories, builds a knowledge graph, and exposes that graph through a CLI, HTTP API, web UI, and Model Context Protocol server.

The graph contains source symbols and relationships such as calls, imports, inheritance, cluster membership, and execution-flow membership. Search is backed by lexical/BM25 and optional vector indexes. Context documents supply token-bounded source and relationship information to coding agents.

## v1.0.8 objective

The release SHALL establish a trustworthy analysis and retrieval foundation:

- Incremental analysis observes the complete working tree.
- Incremental and full analysis converge to the same persisted result.
- The live published index is never partially updated.
- Consumers can determine whether an index is fresh and internally consistent.
- Search execution metadata reflects the actual retrieval path.
- Search ranking can be explained on demand.
- Context responses never exceed their declared token budget.
- A coding agent can request a complete change-analysis package with one MCP call.

## Current architecture relevant to this release

### Analysis pipeline

`code-intel/core/src/cli/app.ts::analyzeWorkspace()` orchestrates:

```text
scan → structure → parse → resolve → cluster → flow → summarize
```

The v1.0.7 incremental path first runs those phases against changed files and then calls `IncrementalIndexer.patchGraph()`, which removes the same files, parses and resolves them again, mutates the live graph database, and incrementally updates BM25. The CLI then writes a complete graph and rebuilds BM25 again.

### Persistence

- Graph: LadybugDB under `.code-intel/graph.db`
- BM25: SQLite under `.code-intel/bm25.db`
- Vector: SQLite under `.code-intel/vector.db`
- Metadata: `.code-intel/meta.json`

Metadata is written last, but graph/BM25/vector do not currently share a single atomic publication boundary.

### Retrieval

`executeSearchRequest()` owns repo/group scoped search dispatch.

- `bm25` performs lexical retrieval.
- `auto` currently normalizes to hybrid.
- `vector` currently invokes hybrid retrieval and may be reported as vector.
- `hybridSearch()` performs BM25 and vector retrieval, then Reciprocal Rank Fusion.

### Context

`context/builder.ts::build()` creates `[SUMMARY]`, `[LOGIC]`, `[RELATION]`, and `[FOCUS CODE]`. Only focus code is actually bounded while earlier blocks are counted as though they were trimmed.

### Change analysis

MCP currently provides `detect_changes`, `pr_impact`, `suggest_tests`, and `context` as separate tools. Diff parsing and change mapping are embedded in the MCP server switch, while PR impact only accepts file-level changes.

## Compatibility policy

- Existing commands and endpoints remain operational.
- New fields are additive.
- `searchMode` remains through v1.0.8 and equals `actualMode`.
- Legacy flat index files are migration inputs, not trusted final state.
- `detect_changes` and `pr_impact` remain, but delegate to shared implementation.
- No automatic source-code changes are introduced.

## Repository commands

```bash
npm run build
npm run typecheck --workspace=code-intel/core
npm run test --workspace=code-intel/core
npm run test:e2e --workspace=code-intel/core
npm run test:all --workspace=code-intel/core
npm run validate:dist --workspace=code-intel/core
```

## Definition of done

A change is complete only when:

1. Its requirements pass `openspec validate`.
2. Unit, integration, and e2e tests pass.
3. Failure injection proves published artifacts remain unchanged after failed analysis.
4. Full-analysis and incremental-analysis normalized graph snapshots are equal.
5. Search contract tests cover every requested/actual/fallback path.
6. Context tests prove `blockTokens.total <= maxTokens` for the complete budget matrix.
7. Documentation and API schemas match runtime responses.
8. Package build and packed-install validation pass.
