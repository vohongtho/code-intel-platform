# Proposal: Add a Universal Semantic Fact Model

## Summary

Introduce a language-neutral semantic fact layer between Tree-sitter syntax extraction and graph/resolution consumers. Every supported language maps its syntax into shared fact contracts, while language-specific semantics remain in adapters.

## Production-baseline evidence

v1.0.10 has two independent semantic interpretations. `parse-phase.ts` uses Tree-sitter queries to create `CodeNode`/`CodeEdge` objects. `resolve-phase.ts` later reparses source lines with separate regexes for imports, calls, and heritage. A construct can therefore be represented one way in the graph but interpreted differently by resolution.

## User-visible correctness problem

Cross-file call/impact results can be wrong even when symbol extraction is correct because parsing and resolution do not consume the same semantic facts. Fixing a language in Tree-sitter queries does not automatically fix the resolver's regex path.

## Goals

- Make semantic facts the single authoritative source for graph projection, resolution, incremental invalidation, and future program analysis.
- Preserve language-specific semantics through `LanguageFactAdapter` implementations instead of forcing one generic parser.
- Represent declarations, declaration fragments, imports, public exports/re-exports, calls, references, heritage, type references, routes/registrations, embedded-language regions, and diagnostics.
- Distinguish reference operations: read, write, call, instantiate, type-use.
- Separate identity, scope, documentation, and render anchors so grouped declarations and wrapper comments remain correct.
- Preserve generic/type-application structure for later type-aware resolution.
- Make silent cross-file-relevant extraction loss observable through bounded diagnostics.

## Scope

### In scope

- Shared fact contracts and adapter interface.
- Fact bundles and diagnostics.
- Compatibility graph projection preserving existing public graph consumers.
- 15 language adapters at the capability level proven by the semantic baseline.
- Separate import binding from public-name publication.
- Structured type references and semantic-kind traits.

### Non-goals

- Complete type checking.
- Final resolver implementation; this change provides resolver inputs.
- Statement-level CFG/PDG.
- Removing every legacy regex path before parity is proven.
- Public commands or required config.

## Compatibility

The analysis command and graph-facing public interfaces remain unchanged. During migration, fact projection must reproduce accepted graph behavior before a language adapter becomes authoritative.

## Migration

Fact schema version becomes a Generation compatibility input. Existing v1.0.10 indexes are automatically reanalyzed when later runtime requires facts that cannot be reconstructed safely.

## Dependencies

Depends on `v1-0-11-fifteen-language-semantic-baseline`.

## Release risk

High because this introduces a new internal semantic boundary. Risk is controlled by language-by-language compatibility projection and negative/paired fixtures.

## Performance impact

Medium. Facts add memory/work during analysis, but remove duplicate source interpretation and create reusable prepared inputs for resolution/incremental work. Detailed facts should not automatically become graph nodes.

## License/IP

Original architecture. GitNexus-inspired semantic ideas must be clean-room reimplemented. No GitNexus test/source copying.
