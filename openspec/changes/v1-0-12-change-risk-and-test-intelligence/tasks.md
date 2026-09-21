# Tasks: Change Risk and Test Intelligence

## Delivery dependency
- [ ] Complete task groups 5 and the identity/migration portion of 6 before task groups 1-4 depend on stable flows.
- [ ] Keep PDG precision manual/experimental until task group 7 passes its comparative gate.

## 1. Diff-to-program-analysis mapping
- [ ] Add a focused adapter/index over existing IR `SourceRange` data to map changed line ranges to owning functions and IR statements; do not add a duplicate parser/location model.
- [ ] Add tests for multiline expressions, comments/whitespace-only hunks, nested functions, multiple statements on one line, and no-map boundaries.
- [ ] Reuse existing IR lowering; do not parse source a second way for this feature.

## 2. PDG change slicing
- [ ] Add `program-analysis/change-slice.ts` using existing PDG/data/control dependencies.
- [ ] Add forward slice and optional explanatory backward slice with existing per-function resource limits.
- [ ] Gate interprocedural projection through `semantic-graph-gate.ts` and bound certainty by every crossed call edge.
- [ ] Add unsupported/partial/truncated fixtures and cache-equivalence tests.

## 3. PR impact integration
- [ ] Extend `PRImpactResult` with optional requested/actual precision, slice summary, fallback counts, projected impact and risk factors.
- [ ] Add `precision: graph|pdg|auto` to CLI/MCP/HTTP while preserving existing defaults.
- [ ] Add `tests/integration/pdg-pr-impact.test.ts` proving graph fallback and no false exact claims.
- [ ] Add structural counters/timers for changed functions, PDG builds/cache hits, slice nodes and projection hops.

## 4. Test intelligence
- [ ] Create `query/test-selection.ts` and extend `suggest-tests.ts` with `direct|affected-flow|transitive|candidate|unknown` evidence.
- [ ] Define a coverage gate before emitting a definitive missing-test finding.
- [ ] Keep generic suggested-case text separate from discovered test evidence.
- [ ] Extend `tests/unit/query/suggest-tests.test.ts` with direct, transitive, candidate, unknown and no-one-hop-false-negative cases.

## 5. Stable flow identity
- [ ] Create `flow-detection/identity.ts` with versioned deterministic flow fingerprint/id.
- [ ] Modify flow phase to persist canonical entry point/steps/call-site metadata instead of per-run enumeration identity.
- [ ] Add repeated-full-analysis tests proving byte-identical stable flow identity.
- [ ] Add generation/snapshot producer fingerprint and correctness-first rebuild of old flow schema.

## 6. Flow diff/history
- [ ] Extend `snapshots/graph-diff.ts` to enable flow deltas only after stable identity validation.
- [ ] Implement conservative added/removed/path-changed/membership-changed classification.
- [ ] Add branch/ref fixtures with unchanged, changed, split/ambiguous and removed flows.
- [ ] Keep cluster diff unsupported unless separately stabilized.

## 7. Mutation evaluation
- [ ] Add `eval/run-pdg-mutation-bench.mjs` and source-valid mutation fixtures.
- [ ] Measure graph vs PDG precision/recall and deterministic reruns.
- [ ] Require <=2pp recall regression and >=10% relative precision improvement before `auto` selects PDG by default; otherwise keep it experimental/manual.
- [ ] Publish benchmark raw/summary result format without claiming unsupported languages.

## 8. Release gates
- [ ] Run relevant 15-language program-analysis capability matrix.
- [ ] Run perf/resource-limit/cache tests.
- [ ] Update README/MCP/OpenAPI/CHANGELOG only after final contracts match.
- [ ] Run full build/core/Web/e2e/package/release validation.
