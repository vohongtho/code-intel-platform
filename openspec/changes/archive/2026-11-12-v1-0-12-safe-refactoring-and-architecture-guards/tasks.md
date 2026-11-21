# Tasks: Safe Refactoring and Architecture Guards

## 1. Contracts and capability matrix
- [x] Add `refactoring/contracts.ts` and per-language `apply|preview-only|unsupported` rename capability.
- [x] Add canonical selector resolution and fail ambiguous simple-name targets.
- [x] Add duplicate-name/overload selector tests.

## 2. Exact edit spans
- [x] Implement tested language adapters for the initial rename-apply language set.
- [x] Separate candidate text/config/generated occurrences from semantic edits.
- [x] Add Unicode, CRLF, multibyte and exact-range regression tests.

## 3. Rename planning/application
- [x] Implement `rename-plan.ts` with source/index fingerprints and expected semantic delta.
- [x] Ship/verify planning independently before enabling any language's apply capability.
- [x] Implement `apply.ts` with explicit apply, dirty-tree acknowledgement, root/symlink/generated protections and stale-plan refusal.
- [x] Implement `verify.ts` using normal analysis, graph diff, API checks and test suggestions.
- [x] Add end-to-end import/alias/override/candidate-string fixtures.

## 4. Architecture layers
- [x] Implement evidence-scored `analysis/architecture-layers.ts`.
- [x] Define explicit layer/dependency policy in `governance/policy-schema.ts`, reusing existing config if appropriate.
- [x] Add tests proving inferred-only labels cannot create blocking violations.

## 5. Structural check
- [x] Keep structural checks independently usable when rename application is unsupported.
- [x] Implement `governance/structural-check.ts`.
- [x] Add rules for explicit layer violations, new cycles, breaking API drift and changed risk/test evidence.
- [x] Add `code-intel check --changed|--base` with JSON/SARIF.
- [x] Add read-only MCP/HTTP planning/check surfaces if needed; no source writes.
- [x] Keep pre-commit hook install opt-in.

## 6. Gates
- [x] Publish 15-language refactoring capability matrix.
- [x] Benchmark rename plan on high-reference symbols.
- [x] Run post-apply semantic verification e2e.
- [x] Update docs and run full release validation.
