# Tasks: Extensible Taint and Type-Aware Dispatch

## 1. Taint model schema and registry
- [ ] Add `program-analysis/taint/model-schema.ts`, `model-registry.ts`, and model loader with versioned bounded declarative matchers.
- [ ] Adapt existing `TaintRuleSet.textPattern` rules as explicit heuristic fallback rather than deleting compatibility.
- [ ] Add deterministic merge, duplicate-ID failure and normalized `taintModelFingerprint`.
- [ ] Add schema/size/count/unknown-matcher/security tests.

## 2. Framework taint contributions
- [ ] Define a standard framework-adapter taint model contribution contract.
- [ ] Add source-verified built-in source/sink/sanitizer models for an initial set without name-only sanitizer guessing.
- [ ] Include adapter/model versions in fingerprints.
- [ ] Add positive and false-positive-control fixtures.

## 3. Model configuration/cache
- [ ] Select one canonical project configuration location after inspecting current config capabilities.
- [ ] Add project model load diagnostics and stable ordering.
- [ ] Add model fingerprint to program-analysis cache identity/compatibility checks.
- [ ] Add test proving unchanged source + changed model cannot reuse stale taint findings.

## 4. Receiver type sets
- [ ] Create `resolution/receiver-types.ts` and reuse/extend existing type-name, heritage and registration indexes; add a new prepared index only for a demonstrated missing lookup.
- [ ] Add `ReceiverTypeSet` with static/runtime candidates, completeness and boundaries.
- [ ] Add initial language adapters only for source-verified supported strategies.
- [ ] Add candidate caps and negative fixtures proving invalid dispatch targets are excluded.

## 5. Dispatch resolution
- [ ] Create `resolution/dispatch.ts` producing standard resolver outcomes/evidence.
- [ ] Expand overrides/interface implementations and narrow only with exact assignment/registration evidence.
- [ ] Never collapse multiple valid candidates to one exact target.
- [ ] Persist resulting normal call edges through the existing graph/evidence path and add reopen tests.
- [ ] Benchmark/index-counter guard against per-call-site full workspace scans.

## 6. Interprocedural taint
- [ ] Begin only after applicable dispatch edges persist/reopen with tested certainty and completeness.
- [ ] Add versioned parameter-to-return/sink summaries.
- [ ] Implement bounded cross-call propagation using `gateInterproceduralAnalysis`.
- [ ] Bound path certainty by call/dispatch certainty at every hop.
- [ ] Add exact/candidate/untrusted/truncated/unknown-parameter tests.

## 7. Public taint trace
- [ ] Create `query/taint-trace.ts`.
- [ ] Add optional CLI `taint-trace`, MCP `taint_trace`, HTTP/OpenAPI surface.
- [ ] Include model IDs, source/sink, sanitizers, path, certainty, coverage and truncation.
- [ ] Ensure zero findings with partial support is not presented as "safe".

## 8. Capability/evaluation
- [ ] Update resolution/program-analysis capability matrices for all 15 languages without fabricating support.
- [ ] Add dispatch target-set precision/recall evaluation and taint true/false-positive fixtures.
- [ ] Run resource-limit/cache/performance tests and full release gates.
- [ ] Document clean-room implementation and dependency/license decisions.
