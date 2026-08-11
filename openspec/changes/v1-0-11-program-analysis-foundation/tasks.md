# Tasks

- [ ] Create program-analysis contracts, capability states, resource limits, artifact-version/fingerprint types, and deterministic IDs.
- [ ] Create universal IR statement/expression/source-range contracts and validation.
- [ ] Implement language lowering adapters for executable supported languages in staged order determined by 15-language capability evidence; keep HTML raw analysis `not-applicable` and delegate embedded scripts.
- [ ] Implement validated deterministic basic-block CFG with entry/exit and language-appropriate exceptional/finally/defer lowering.
- [ ] Implement dominators/post-dominators and control-dependence algorithms with small-graph reference/differential tests.
- [ ] Implement bounded intraprocedural reaching definitions and def-use for locals/parameters first; model alias/heap uncertainty explicitly.
- [ ] Implement versioned function summaries keyed by canonical identity/body hash and required resolver compatibility.
- [ ] Implement PDG assembly from control and data dependencies without materializing all statement nodes into the main graph by default.
- [ ] Implement versioned taint rule contracts and source-to-sink propagation with sanitizer/boundary/truncation evidence.
- [ ] Create program-analysis side cache/store and read-back verification integrated with Generation capability metadata.
- [ ] Add progressive internal capability routing from existing security/context/inspect workflows; do not add mandatory public commands.
- [ ] Ensure heavy program-analysis modules are dynamically loaded and absent from query-only MCP/HTTP startup closure.
- [ ] Add resource-limit tests proving limit hits return truncated/unknown rather than complete.
- [ ] Add cache/full equivalence and incremental body-hash invalidation tests.
- [ ] Add per-language capability rows plus correctness/performance/memory gates for enabled lowering adapters.
- [ ] Run full semantic graph gates before enabling any interprocedural advanced result by default.
- [ ] Run package validation, startup-closure test, full tests, and OpenSpec validation.
