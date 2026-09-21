# Tasks: Safe Refactoring and Architecture Guards

## 1. Contracts and capability matrix
- [ ] Add `refactoring/contracts.ts` and per-language `apply|preview-only|unsupported` rename capability.
- [ ] Add canonical selector resolution and fail ambiguous simple-name targets.
- [ ] Add duplicate-name/overload selector tests.

## 2. Exact edit spans
- [ ] Implement tested language adapters for the initial rename-apply language set.
- [ ] Separate candidate text/config/generated occurrences from semantic edits.
- [ ] Add Unicode, CRLF, multibyte and exact-range regression tests.

## 3. Rename planning/application
- [ ] Implement `rename-plan.ts` with source/index fingerprints and expected semantic delta.
- [ ] Implement `apply.ts` with explicit apply, dirty-tree acknowledgement, root/symlink/generated protections and stale-plan refusal.
- [ ] Implement `verify.ts` using normal analysis, graph diff, API checks and test suggestions.
- [ ] Add end-to-end import/alias/override/candidate-string fixtures.

## 4. Architecture layers
- [ ] Implement evidence-scored `analysis/architecture-layers.ts`.
- [ ] Define explicit layer/dependency policy in `governance/policy-schema.ts`, reusing existing config if appropriate.
- [ ] Add tests proving inferred-only labels cannot create blocking violations.

## 5. Structural check
- [ ] Implement `governance/structural-check.ts`.
- [ ] Add rules for explicit layer violations, new cycles, breaking API drift and changed risk/test evidence.
- [ ] Add `code-intel check --changed|--base` with JSON/SARIF.
- [ ] Add read-only MCP/HTTP planning/check surfaces if needed; no source writes.
- [ ] Keep pre-commit hook install opt-in.

## 6. Gates
- [ ] Publish 15-language refactoring capability matrix.
- [ ] Benchmark rename plan on high-reference symbols.
- [ ] Run post-apply semantic verification e2e.
- [ ] Update docs and run full release validation.
