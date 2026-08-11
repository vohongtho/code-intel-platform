# Tasks

- [ ] Create `code-intel/core/src/semantic/anchors.ts` with `SourceRange` and `SemanticAnchors`; add unit tests for stable repository-relative range serialization.
- [ ] Create `code-intel/core/src/semantic/facts.ts` with declaration, fragment, import binding, published name, call site, reference, heritage, type reference, registration, route, embedded-region, and semantic-kind-trait contracts.
- [ ] Create `code-intel/core/src/semantic/diagnostics.ts` with bounded `FactDiagnostic` codes and aggregation rules; assert diagnostics do not grow unbounded on repeated identical failures.
- [ ] Create `code-intel/core/src/semantic/fact-bundle.ts` with deterministic ordering and versioned fact-schema metadata.
- [ ] Create `code-intel/core/src/semantic/adapters/adapter.ts` defining `LanguageFactAdapter.extract()`, `validate()`, and capability linkage.
- [ ] Create adapter modules for all 15 registry languages; each adapter must explicitly return supported/partial/not-applicable semantics rather than relying on missing code paths.
- [ ] Refactor `code-intel/core/src/pipeline/phases/parse-phase.ts` to delegate Tree-sitter match interpretation to adapters while retaining phase ownership, file caching, progress reporting, and safe fallback during migration.
- [ ] Add explicit identity/scope/documentation/render anchors to adapter output and fixtures for grouped/multi-declaration syntax.
- [ ] Add `TypeReferenceFact` structure preserving generics, pointers/references, callable/container/union/specialization forms before language resolution.
- [ ] Add `ReferenceFact.operation` extraction for read/write/call/instantiate/type-use where statically observable; add negative fixtures preventing guessed operations.
- [ ] Separate `ImportBindingFact` from `PublishedNameFact`; add Python package-surface, TypeScript barrel, Rust public-use, and local-scope non-reexport controls.
- [ ] Add `SemanticKindTraits` and tests for class/struct/record/shape-like type behavior without hard-coded consumer lists.
- [ ] Create `code-intel/core/src/semantic/graph-projector.ts` that reproduces existing structural graph contracts from facts.
- [ ] Add normalized old-parser-vs-fact-projector comparison tests for all 15 language fixtures before enabling an adapter as authoritative.
- [ ] Add fact diagnostics to verbose analysis observability without changing default compact output.
- [ ] Add fact-schema fingerprint/version input to Generation compatibility planning once facts become required persisted semantics.
- [ ] Run 15-language corpus, unit/integration/e2e tests, package validation, and OpenSpec validation.
