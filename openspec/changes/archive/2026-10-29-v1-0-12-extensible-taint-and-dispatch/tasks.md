# Tasks: Extensible Taint and Type-Aware Dispatch

## 1. Taint model schema and registry
- [x] Add `program-analysis/taint/model-schema.ts`, `model-registry.ts`, and model loader with versioned bounded declarative matchers.
- [x] Adapt existing `TaintRuleSet.textPattern` rules as explicit heuristic fallback rather than deleting compatibility.
- [x] Add deterministic merge, duplicate-ID failure and normalized `taintModelFingerprint`.
- [x] Add schema/size/count/unknown-matcher/security tests.

## 2. Framework taint contributions
- [x] Define a standard framework-adapter taint model contribution contract.
- [x] Add source-verified built-in source/sink/sanitizer models for an initial set without name-only sanitizer guessing.
- [x] Include adapter/model versions in fingerprints.
- [x] Add positive and false-positive-control fixtures.

## 3. Model configuration/cache
- [x] Select one canonical project configuration location after inspecting current config capabilities.
- [x] Add project model load diagnostics and stable ordering.
- [x] Add model fingerprint to program-analysis cache identity/compatibility checks.
- [x] Add test proving unchanged source + changed model cannot reuse stale taint findings.

## 4. Receiver type sets
- [x] Create `resolution/receiver-types.ts` and reuse/extend existing type-name, heritage and registration indexes; add a new prepared index only for a demonstrated missing lookup.
- [x] Add `ReceiverTypeSet` with static/runtime candidates, completeness and boundaries.
- [x] Add initial language adapters only for source-verified supported strategies.
- [x] Add candidate caps and negative fixtures proving invalid dispatch targets are excluded.

## 5. Dispatch resolution
- [x] Create `resolution/dispatch.ts` producing standard resolver outcomes/evidence.
- [x] Expand overrides/interface implementations and narrow only with exact assignment/registration evidence.
- [x] Never collapse multiple valid candidates to one exact target.
- [x] Persist resulting normal call edges through the existing graph/evidence path and add reopen tests.
- [x] Benchmark/index-counter guard against per-call-site full workspace scans.

## 6. Interprocedural taint
- [x] Begin only after applicable dispatch edges persist/reopen with tested certainty and completeness.
- [x] Add versioned parameter-to-return/sink summaries.
- [x] Implement bounded cross-call propagation using `gateInterproceduralAnalysis`.
- [x] Bound path certainty by call/dispatch certainty at every hop.
- [x] Add exact/candidate/untrusted/truncated/unknown-parameter tests.

## 7. Public taint trace
- [x] Create `query/taint-trace.ts`.
- [x] Add optional CLI `taint-trace`, MCP `taint_trace`, HTTP/OpenAPI surface.
- [x] Include model IDs, source/sink, sanitizers, path, certainty, coverage and truncation.
- [x] Ensure zero findings with partial support is not presented as "safe".

## 8. Capability/evaluation
- [x] Update resolution/program-analysis capability matrices for all 15 languages without fabricating support.
- [x] Add dispatch target-set precision/recall evaluation and taint true/false-positive fixtures.
- [x] Run resource-limit/cache/performance tests and full release gates.
- [x] Document clean-room implementation and dependency/license decisions.
