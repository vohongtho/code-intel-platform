# v1.0.12 Release Program — Verified Change Intelligence

## Change ID

`v1-0-12-release-program`

## Release

`1.0.12`

## Purpose

Define the source-verified v1.0.12 program and map every feature candidate from the repository comparison to either an existing v1.0.11 capability, a v1.0.12 enhancement, or a deferred/non-duplicated item.

## Baseline principle

The earlier competitive analysis identified 22 candidates, but the current baseline already implements meaningful parts of several of them. v1.0.12 SHALL extend the existing implementation instead of rebranding it as new work.

## Feature map

| ID | Earlier proposal | v1.0.11 baseline | v1.0.12 action | Detailed change |
|---|---|---|---|---|
| F01 | Adaptive context compression | Adaptive snippets, hard budgets, trust ranking, session delivery already exist | Add flow-aware full/signature/skeleton/reference rendering and stronger allocation evaluation | `v1-0-12-adaptive-agent-exploration` |
| F02 | Signed release provenance | Checksums, SBOM, provenance sidecars + GitHub attestations; Docker is cosign-signed | Add runtime-archive authenticity verification in the CLI/installer | `v1-0-12-runtime-trust-and-offline-install` |
| F03 | Unified Explore tool | Existing specialized search/context/inspect/impact tools and an agent `explore` workflow asset | Add one optional task-oriented `explore` orchestration tool/command | `v1-0-12-adaptive-agent-exploration` |
| F04 | Branch-aware semantic index selection | Semantic snapshots + graph diff for refs exist | Make immutable refs selectable by normal read/query tools without replacing current index defaults | `v1-0-12-ref-aware-portable-indexes` |
| F05 | Graph-backed rename | No first-class semantic rename planner found | Add dry-run semantic rename planning, bounded candidate handling and post-edit verification | `v1-0-12-safe-refactoring-and-architecture-guards` |
| F06 | Missing-test detection for changed flows | `suggest_tests`, `coverage_gaps`, PR impact exist | Connect change→flow→test evidence and classify uncovered changed behavior | `v1-0-12-change-risk-test-intelligence` |
| F07 | Plan→Work→Verify workflow | Eight graph-backed workflow assets exist, including plan/review/impact | Add resumable checkpoint state, expected graph deltas and post-edit validation | `v1-0-12-agentic-cross-repo-change-workflows` |
| F08 | PDG-backed PR impact | CFG/dataflow/PDG/taint engine exists but is not wired into PR impact | Add bounded statement-level slicing projected to symbols/flows/contracts/tests | `v1-0-12-change-risk-test-intelligence` |
| F09 | API response-shape consumer validation | HTTP consumer extraction already tracks response keys for fetch/Axios/Angular and compatibility uses consumer evidence | Add explicit shape-check surface and deeper alias/optional/destructuring coverage; do not recreate existing engine | `v1-0-12-api-protocol-contract-intelligence` |
| F10 | Portable/shareable immutable indexes | Snapshot cache exists but no portable import/export contract found | Add signed/checksummed portable index package with privacy modes and trust validation | `v1-0-12-ref-aware-portable-indexes` |
| F11 | Architecture-layer detection | Directory heuristic clusters exist; no enforceable layer model found | Add evidence-scored layers + optional dependency policy | `v1-0-12-safe-refactoring-and-architecture-guards` |
| F12 | Structural pre-commit checks | SARIF builder exists; no unified structural check command found | Add `check --changed` using graph/API/architecture policies | `v1-0-12-safe-refactoring-and-architecture-guards` |
| F13 | Program-analysis mutation benchmark | Program-analysis unit fixtures exist; no mutation oracle found | Add mutation/effect oracle for PDG impact precision/recall | `v1-0-12-change-risk-test-intelligence` |
| F14 | Configurable taint models | Built-in bounded taint exists; no project model extension point found | Add versioned project/framework taint source/sink/sanitizer models | `v1-0-12-extensible-taint-and-dispatch` |
| F15 | Historical business-flow evolution | Current flow IDs are not suitable for graph diff; graph-diff reports flow/cluster delta unsupported | Stabilize flow identity/fingerprint and persist diffable flow evolution | `v1-0-12-change-risk-test-intelligence` |
| F16 | GraphQL client→resolver mapping | GraphQL contract extraction hooks exist; group drift remains unknown | Add operation/resolver/type-field identity, consumer links and compatibility | `v1-0-12-api-protocol-contract-intelligence` |
| F17 | gRPC field-level compatibility | protobuf/gRPC extraction hooks exist; group drift remains unknown | Add protobuf service/method/message compatibility and consumer impact | `v1-0-12-api-protocol-contract-intelligence` |
| F18 | Semantic reranking | BM25/vector RRF exists; no learned/graph-aware second-stage reranker found | Add bounded graph-aware reranking first; keep learned reranker optional/deferred | `v1-0-12-adaptive-agent-exploration` |
| F19 | Offline installation | Local archive install is possible, but complete trust-bundle/offline lifecycle is not defined | Add offline release bundle manifest, verification and diagnostics | `v1-0-12-runtime-trust-and-offline-install` |
| F20 | Rich graph-diff visualization | CLI/MCP/HTTP graph diff exists | Add Web diff exploration over the same service; no second diff engine | `v1-0-12-ref-aware-portable-indexes` |
| F21 | Deeper type-aware dynamic dispatch | Evidence-aware language resolution exists but complex receiver/dispatch cases remain bounded/heuristic | Add receiver type-set and hierarchy-aware dispatch with explicit candidate certainty | `v1-0-12-extensible-taint-and-dispatch` |
| F22 | Cross-repo business-flow trace | Contract drift links repositories but does not persist stitched system execution flows | Stitch local flows through exact contract links with bounded candidates | `v1-0-12-agentic-cross-repo-change-workflows` |

## Priorities

### P0

- adaptive agent exploration;
- ref-aware query foundation;
- PDG-backed PR impact;
- missing-test detection;
- API/protocol compatibility completion;
- runtime archive authenticity.

### P1

- safe semantic rename;
- architecture/policy checks;
- portable indexes;
- mutation benchmark;
- configurable taint;
- dynamic dispatch;
- checkpointed agent workflows;
- cross-repo system flows.

### P2

- optional learned reranking after graph-aware reranking has evidence;
- richer historical visualization and offline catalog convenience.

## Dependency order

```text
adaptive context ───────────────┐
                               ├─> checkpointed agent workflows
ref-aware snapshots ───────────┤
                               │
stable flow identity ──────────┤
                               ├─> cross-repo system flows
API protocol links ────────────┤
                               │
PDG change slicing ──> test intelligence
                               │
runtime trust ─────────────────┘ (independent delivery track)
```

## Release boundary

v1.0.12 does not require every feature to be enabled for every language/framework. It requires truthful capability reporting, safe fallbacks, deterministic outputs, and no regression of the existing 15-language semantic baseline.

## License/IP

- GitNexus-inspired requirements are clean-room only.
- CodeGraph-inspired context-selection concepts are reimplemented against Code Intel's existing context/session/evidence abstractions; no source copying is planned.
