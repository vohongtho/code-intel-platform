# v1.0.12: Adaptive Agent Exploration

## Change ID
`v1-0-12-adaptive-agent-exploration`

## Feature IDs
F01, F03, F18

## Priority
P0

## Summary
Add an optional task-oriented `explore` surface that composes the existing search, graph, API, impact, test, and context services; add deterministic graph-aware second-stage reranking; and add a richer source render policy with `full | snippet | signature | skeleton | reference` modes.

This is an enhancement of v1.0.11, not a replacement for its context/search engine.

## Source-verified baseline
`code-intel/core/src/context/builder.ts` already provides hard token budgets, query-intent presets, adaptive snippets, signature-only low-relevance rendering, canonical-identity dedup, certainty-ranked evidence, omission receipts, and session-aware delivery through `context/session.ts`.

`code-intel/core/src/search/hybrid-search.ts` already combines BM25 and vector candidates with RRF. MCP already exposes `search`, `inspect`, `context`, `find_path`, `blast_radius`, `flows`, API-contract tools, and PR/test tools.

The remaining gap is orchestration and value-aware compression: agents still choose/sequencing several tools themselves, and the current renderer cannot deliberately keep an orchestration body rich while collapsing repetitive sibling implementations to syntax-safe skeletons/signatures.

## User workflow
```bash
code-intel explore "how does login reach session persistence?"
code-intel explore "what must change to add MFA?" --intent change --max-tokens 6000
```

Equivalent MCP request:
```json
{
  "task": "what must change to add MFA?",
  "intent": "change",
  "max_tokens": 6000,
  "compression": "auto",
  "explain_ranking": false
}
```

Supported intents: `understand`, `debug`, `change`, `review`, `security`, `api`. Intent changes allocation/orchestration only; it never changes semantic truth.

## Required behavior
1. Retrieve candidates through the existing scoped search path.
2. Apply a deterministic graph-aware reranker using existing evidence: lexical/vector rank, exact identity/name, graph/path/flow proximity, API relevance, certainty/ambiguity, and path category.
3. Expand seeds with existing path/flow/API/impact/test/security services according to intent.
4. Assign one source mode per selected artifact:
   - `full` for central implementation;
   - `snippet` for focused implementation;
   - `signature` for supporting declarations;
   - `skeleton` for syntax-aware compressed structure;
   - `reference` when identical source was already delivered in the session.
5. Feed the plan into the existing context builder and preserve its hard final budget, trust, coverage, and omission receipts.
6. Return ranking/render reasons only when requested; default output stays compact.

## Skeleton safety
Skeletonization SHALL use tested syntax-aware language adapters or parser/lowering facts. A generic destructive regex skeletonizer is forbidden. Unsupported languages fall back to snippet/signature and expose a boundary.

## Reranking scope
v1.0.12 SHALL start with local deterministic graph-aware reranking. A learned cross-encoder is deferred unless evaluation proves a material quality gain within local privacy/latency/package-size limits.

## Compatibility
Existing tools and current `context` behavior remain valid. No persisted graph migration is required. `explore` is additive.

## Performance and quality gates
- >=25% median delivered-token reduction versus the existing multi-tool agent benchmark workflow;
- <=2 percentage-point correctness regression on the same paired cases;
- hard max-token budget always respected;
- stale session content is resent rather than pointer-referenced;
- rerank/render overhead is separately observable;
- unsupported skeletonization never fabricates structure.

## Security/privacy
No source/task text is sent to a remote reranker by default. Ranking telemetry contains counters/timings, not raw source.

## License/IP
The context-efficiency idea is inspired by CodeGraph (MIT), but implementation SHALL be original against Code Intel's existing context/session/evidence abstractions. GitNexus source is not used.
