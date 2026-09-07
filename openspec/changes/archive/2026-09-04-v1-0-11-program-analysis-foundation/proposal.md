# Proposal: Add a Progressive Program-Analysis Foundation

## Summary

Design the advanced-analysis layer required to close the remaining GitNexus gap after semantic graph correctness is established: universal function IR, CFG, dominators/post-dominators, control dependence, reaching definitions, def-use, PDG, function summaries, and bounded source-to-sink taint analysis.

This proposal is part of the 1.0.11 architecture backlog but MUST NOT be enabled ahead of the identity/resolution/certainty release gates. Advanced analysis on a wrong call graph would amplify wrong answers.

## Production-baseline evidence

v1.0.10 performs graph-level security signal extraction and relationship/flow analysis but does not contain a statement-level universal IR/CFG/data-flow/PDG substrate comparable to the advanced analysis modules reviewed in GitNexus.

## User-visible problem

Without control/data dependence, Code Intel cannot reliably answer higher-order questions such as “can this request parameter reach this SQL/command sink?”, “which definition reaches this use?”, “which branch controls this side effect?”, or “which changed statement affects this returned value?”

## Goals

- Introduce universal per-function IR retaining source ranges and unknown boundaries.
- Build validated deterministic CFGs.
- Add dominators, post-dominators, control dependence.
- Add bounded reaching definitions and def-use.
- Build PDG from control/data dependence plus compatible call summaries.
- Add versioned source/sink/sanitizer taint rules and evidence paths.
- Keep detailed statement/block artifacts outside the main symbol graph by default.
- Generate/cache advanced artifacts lazily through existing workflows when useful; no mandatory `build-cfg` command.
- Report unsupported/truncated semantics truthfully per language/function.

## Scope

### In scope

- IR/CFG/dataflow/PDG/taint contracts and side cache/store.
- Language lowering adapters for executable supported languages.
- Resource limits and truncation semantics.
- Integration with existing security/context/inspect/impact consumers only through additive evidence.

### Non-goals

- Runtime execution tracing.
- Whole-program heap/alias precision.
- Eager detailed PDG for every function during every normal analyze.
- Replacing the TypeScript platform with Rust.
- Fake CFG for raw HTML.

## Compatibility

Existing analyze/query workflows remain unchanged. Advanced artifacts are internal/lazy unless later product requirements expose optional views through existing endpoints/tools.

## Migration

Program-analysis artifact version/fingerprint is independent from graph identity/resolver compatibility. Old graph generation can only use advanced artifacts when graph/identity/resolver fingerprints match required inputs.

## Dependencies

Hard dependency on identity v2, evidence-based resolution, relationship certainty, and Generation semantic verification. Prefer query/analyzer runtime separation before heavy modules are enabled.

## Release risk

Very high. Treat as staged strategic work after P0 parity gates.

## Performance impact

Potentially high. Bounded lazy computation, body-hash cache keys, and strict per-function/repository budgets are mandatory.

## License/IP

GitNexus advanced-analysis source is noncommercial licensed and MUST NOT be copied. Implement independently from published algorithms, language semantics, and original Code Intel tests/design.
