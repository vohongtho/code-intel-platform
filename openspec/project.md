# Project Context — Code Intelligence Platform

## Product

Code Intelligence Platform statically analyzes repositories, persists a code knowledge graph, and exposes that intelligence through CLI, HTTP, Web, and MCP. Search combines BM25 with optional vector retrieval. Change/impact/context tools consume the persisted graph and derived indexes.

## Production baseline

The v1.0.11 branch is created from the exact published v1.0.10 source tag:

```text
v1.0.10
52dfda4c1dd78b7667cc8a10606ade65a7807d90
```

v1.0.10 already includes Generation V2 atomic staging/publication, analysis serialization, pinned index snapshots, requested/actual search-mode reporting, vector-runtime compatibility checks, embedding model selection, final context token-budget enforcement, agent-aware setup, persistent Remember-me sessions, and pinned HTTP index-version metadata. v1.0.11 SHALL extend those implementations rather than re-create them.

## v1.0.11 objective

The release focuses on the semantic core. A user must receive better graph correctness by upgrading the package, without learning new required commands or changing the normal workflow.

The release program SHALL establish:

1. A tested semantic capability baseline for all 15 advertised languages.
2. One semantic fact source shared by parsing, graph projection, resolution, and incremental invalidation.
3. Canonical symbol/call-site identity that preserves overloads, nested declarations, and declaration fragments.
4. Evidence-based, language-aware cross-file and dynamic-dispatch resolution.
5. Relationship certainty/coverage so missing evidence is not misreported as safe absence.
6. Dependency-aware incremental re-resolution that converges to a fresh full build.
7. Generation V2 semantic read-back verification and derived analyzer compatibility fingerprints.
8. Better evidence selection in the existing context workflow.

Advanced CFG/def-use/PDG/taint work is designed only after the above graph-truth foundations are measurable.

## Current production architecture

### Analysis

`code-intel/core/src/pipeline/orchestrator.ts` runs the established phase pipeline. Parsing is owned by `pipeline/phases/parse-phase.ts`; relationship resolution is owned by `pipeline/phases/resolve-phase.ts`.

Production parsing currently runs Tree-sitter query extraction where a query is registered, then falls back to regex when Tree-sitter does not yield data. HTML has a bundled grammar but is not wired into the production query map.

Production relationship resolution currently builds one global `name -> nodeId` map plus one per-file name map. It extracts imports/calls/heritage from source-line regexes and selects same-file name matches before one global name match. `receiverText` is extracted for calls but is not authoritative target-selection evidence.

### Identity

`graph/id-generator.ts` currently creates node IDs as `kind:filePath:qualifiedName` and edge IDs as `kind:source->target`. Production Tree-sitter extraction currently passes a simple declaration name to the node-ID helper and deduplicates definitions by `kind:name` within a file.

### Persistence

Generation V2 owns staging and immutable publication. A reader pins graph/BM25/vector/metadata through one `IndexSnapshot`. This model remains authoritative for v1.0.11.

LadybugDB relationship storage currently persists `kind`, `weight`, and `label`; it does not persist resolution certainty, call-site identity, strategy, ambiguity, or evidence references.

### Incremental behavior

v1.0.10 deliberately chooses a full graph/BM25 rebuild for non-zero source changes because dependency-closure re-resolution is not yet available. This correctness gate SHALL remain the fallback until dependency-aware incremental output proves equivalent to fresh full analysis.

### Retrieval and context

Search requested/actual mode and vector readiness are already corrected in v1.0.10. Context final token-budget enforcement is already corrected. v1.0.11 context work focuses on canonical seed selection, trust-aware evidence allocation, omission/coverage reporting, and optional session-aware source deduplication.

## Supported languages

The advertised set is TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Kotlin, Ruby, Swift, Dart, and HTML. Support SHALL be expressed per semantic capability as `supported`, `partial`, `not-applicable`, or `unsupported`; grammar availability alone is not sufficient proof.

## Compatibility policy

- Existing required CLI commands remain operational.
- Existing MCP tool names and required arguments remain operational.
- Existing HTTP routes remain operational.
- Existing Web workflows remain operational.
- New trust/capability fields are additive.
- Semantic migrations are automatic through ordinary analysis planning and Generation V2 staging.
- No public `migrate-resolver`, `build-cfg`, or equivalent mandatory command is introduced.
- Legacy selectors continue to work when unambiguous; ambiguous legacy selectors must not silently select one candidate as exact.

## Repository commands

```bash
npm run build
npm run typecheck --workspace=code-intel/core
npm run test --workspace=code-intel/core
npm run test:e2e --workspace=code-intel/core
npm run test:all --workspace=code-intel/core
npm run validate:dist --workspace=code-intel/core
```

## v1.0.11 definition of done

A semantic-core change is complete only when:

1. `openspec validate` passes for the change.
2. Focused unit/integration/e2e tests pass.
3. All 15 language release rows are produced and no accepted capability regresses.
4. Ambiguous or unsupported semantics do not become confidently wrong edges.
5. Full and incremental normalized semantic snapshots converge for applicable changes.
6. Serial/parallel analysis produces deterministic normalized semantics.
7. Production-path persistence is reopened and verified after successful and failed publication.
8. Resolver scalability guards include structural traversal/index-build counters, not timing alone.
9. Existing public workflows require no new mandatory command/config/tool.
10. Packed npm layout and release validation continue to pass.
