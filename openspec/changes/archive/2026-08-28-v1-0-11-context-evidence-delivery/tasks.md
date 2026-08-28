# Tasks

- [x] Create/reuse a shared canonical symbol selector and replace context first-match name lookup with exact/ambiguous/missing selection semantics.
- [x] Refactor `code-intel/core/src/context/builder.ts::DedupeRegistry` to key symbols/call pairs/logic artifacts by canonical IDs instead of display names.
- [x] Add optional `task` to the existing MCP/HTTP context request contracts without changing required arguments; update schemas/OpenAPI/shared/web types as applicable.
- [x] Use task text for auto intent when supplied and preserve current compatible intent defaults when absent.
- [x] Add relationship-certainty-aware context candidate ranking and deterministic tie-breaking.
- [x] Add `ContextAllocationReceipt`, protected named-evidence reservation, delivery modes, and structured omission reasons.
- [x] Integrate receipts with existing `context/budget.ts` final hard-budget enforcement; do not weaken the hard ceiling.
- [x] Add compact additive `coverage`, `trust`, and `omitted` response metadata while retaining existing block fields.
- [x] Add MCP session/workspace-scoped `ServedArtifactRecord` state in transport/session ownership, not as global process state.
- [x] Add content-fingerprint range deduplication and edit-aware re-emission; prevent all-pointer responses and never suppress trust/boundary warnings.
- [x] Add tests for same-name canonical seeds, ambiguity, named symbol deep in large file, oversized function, budget pressure, edited source, session isolation, and repeated calls.
- [x] Add fixed-index quality benchmark for named evidence recall, unique evidence/token, duplicate bytes, and external file-read fallback.
- [x] Run existing full context budget matrix to prove `blockTokens.total <= maxTokens` remains true.
- [x] Run MCP/HTTP integration, full tests, package validation, and OpenSpec validation.
