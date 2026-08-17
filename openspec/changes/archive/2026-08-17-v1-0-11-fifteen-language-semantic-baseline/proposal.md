# Proposal: Establish a 15-Language Semantic and Scalability Baseline

## Summary

Create a single tested capability contract for every language advertised by Code Intel before replacing shared parser/resolver internals. The baseline is a release gate, not a new user feature or command.

## Production-baseline evidence

v1.0.10 advertises 15 languages through shared detection/parser infrastructure, but `pipeline/phases/parse-phase.ts` registers Tree-sitter queries for only 14 languages; HTML is not in `LANG_QUERIES`. Production extraction also falls back to regex whenever Tree-sitter does not emit nodes/edges. Existing language maps are duplicated across detection, grammar/query selection, and tests.

This means `grammar bundled` and `language semantically supported` are currently conflated.

## User-visible correctness problem

A user upgrading Code Intel should not discover that one supported language silently lost symbols, ownership, calls, inheritance, or search visibility because a shared engine change optimized another language. Aggregate test counts cannot detect this reliably.

## Goals

- Define one canonical language-capability registry for TypeScript, JavaScript, Python, Java, Go, C, C++, C#, Rust, PHP, Kotlin, Ruby, Swift, Dart, and HTML.
- Measure semantic behavior independently per language.
- Establish paired positive/negative controls for symbol, ownership, imports/exports, direct calls/references, heritage, type hints, and applicable language semantics.
- Add production-path persistence/reload, serial/parallel parity, and deterministic fingerprints.
- Add resolver scalability contracts driven from the same registry: workspace traversal counts, prepared-index build counts, scaling ratios, path-depth/collision workloads, and retained-heap budgets where applicable.
- Define truthful capability states: `supported`, `partial`, `not-applicable`, `unsupported`.
- Give HTML real structural/resource semantics without fabricating executable control flow.

## Scope

### In scope

- Canonical registry and capability types.
- Refactoring duplicated language enumeration to consume the registry.
- Semantic corpus and golden manifests.
- Production parser/query-path tests.
- HTML structural extraction contract.
- Per-language semantic and performance release report.
- Regression gates consumed by all later v1.0.11 semantic changes.

### Non-goals

- Equal semantic depth for every language.
- CFG/PDG/taint implementation.
- Public benchmark commands.
- Framework semantics beyond baseline language facts.
- Removing safe regex fallback before equivalent language extraction is proven.

## Compatibility

No user workflow changes. `code-intel analyze`, MCP, HTTP, Web, and current config continue unchanged. Registry/corpus/benchmarks are internal release assets.

## Migration

No index migration is required solely for the baseline. Later changes may use the registry version as a Generation V2 compatibility fingerprint input.

## Dependencies

None. This is the first implementation gate for the semantic-core program.

## Release risk

Medium. The main risk is discovering that an advertised language currently relies on fallback behavior. That is expected evidence, not a reason to weaken the gate. Such a row should be marked `partial` until behavior is intentionally improved.

## Performance impact

Low at runtime. CI cost increases because each shared semantic change runs the 15-row matrix and selected scalability fixtures.

## License/IP

Original Code Intel implementation. Competitor behavior may inform what to test, but corpus/test code must not be copied from GitNexus.
