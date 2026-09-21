# OpenSpec Implementation Instructions for v1.0.12

## Scope

These changes are implementation plans for branch `release/1.0.12`, created from `main` at `20e46e8a251eaf52772388a5ef67b4fa290f934f`. The baseline already contains the released v1.0.11 semantic-core, API-contract, branch-snapshot, cross-repository drift, workflow, program-analysis, and self-contained-runtime work. Treat the repository as brownfield code and extend those capabilities instead of re-creating them.

## Mandatory workflow

1. Read `openspec/changes/v1-0-12-release-program/proposal.md` first, then the selected change's `proposal.md`, delta specs, `design.md`, and `tasks.md`.
2. Inspect every source file named by the next task before editing it.
3. Verify that a requested capability is not already present under another name before creating a new abstraction.
4. Reuse the v1.0.11 semantic graph, Generation V2, semantic snapshots, contract engine, program-analysis IR, workflow registry, context builder, and runtime lifecycle wherever applicable.
5. Implement tasks in dependency order and check them off only after the stated tests pass.
6. Update proposal/design/specs when implementation discovery invalidates a source assumption.
7. Run focused tests after each task group and the full release gate at the end.
8. Keep implementation commits scoped to one coherent task group.

## No-duplicate rule

v1.0.12 SHALL NOT create a second implementation of capabilities already present in v1.0.11. In particular:

- branch-aware semantic comparison MUST extend `src/snapshots/*`, not create another checkout/snapshot engine;
- API shape and consumer intelligence MUST extend `src/semantic/api-contracts/*`;
- PDG/taint work MUST extend `src/program-analysis/*`;
- repository-group intelligence MUST extend `src/multi-repo/*`;
- agent workflows MUST extend `src/agents/workflows/*`;
- context optimization MUST extend `src/context/*`;
- runtime trust/install work MUST extend `src/cli/runtime-*` and `scripts/distribution/*`;
- graph diff visualization MUST consume the existing semantic graph-diff service.

## Compatibility rules

- Existing CLI commands, HTTP routes, MCP tool names, Web workflows, and agent workflow IDs remain operational unless a delta spec explicitly marks a breaking change.
- Existing tools may gain optional arguments and additive response fields.
- Existing current-repository behavior remains the default when a new `ref`, precision, policy, or workflow-session option is omitted.
- No advanced analysis result may turn incomplete/unsupported/truncated evidence into a claim of safety.
- Unsupported language capability must fail closed or report `partial`/`unsupported`; it must not fabricate an exact edit, dispatch target, taint path, or API match.
- New persisted artifacts require schema/fingerprint ownership and Generation/snapshot compatibility rules.
- Agent-oriented output must be deterministic and stably sorted.

## Program-analysis rules

- Keep symbol/API/flow graph concerns separate from statement-level IR/CFG/PDG storage.
- Join the two layers through stable symbol/call-site identity.
- PDG precision is opt-in or automatically selected only when capability and budget gates pass.
- Resource-limit hits must return explicit truncation/boundary metadata.
- Cross-procedural certainty may never be stronger than the call relationship used to cross the boundary.
- Configurable taint models must be fingerprinted and invalidate incompatible cached results.

## Git and ref safety

- Never shell-interpolate Git refs, file paths, or user-supplied revision expressions.
- Use `execFile`/`execFileSync` argument arrays.
- Never modify the user's working tree, index, HEAD, or active Generation V2 index while materializing another ref.
- Portable index import must validate repository identity, schema, analyzer fingerprints, checksums, and source-content privacy metadata before activation.

## License rules

- GitNexus is PolyForm Noncommercial. Do not copy its source, tests, schemas, prompts, skills, or implementation expression into this MIT project. Requirements inspired by GitNexus must be clean-room reimplemented from general concepts and public algorithm literature.
- CodeGraph is MIT. Prefer original Code Intel integration. If substantial CodeGraph source is reused, preserve the MIT copyright/license notice and audit embedded third-party assets separately.
- New runtime dependencies require a package/license/security review in the relevant design and task list.

## Test rules

- Tests must use temporary repositories and set local Git identity explicitly.
- Add negative fixtures proving false targets/links/edits are not emitted.
- Add ambiguity and truncation fixtures wherever candidate sets or analysis budgets are bounded.
- Reopen persisted artifacts in persistence/trust tests; do not assert only in-memory state.
- Shared semantic-engine changes run the canonical 15-language capability matrix.
- Performance gates must include structural counters and scaling fixtures, not timing alone.
- Change-intelligence precision features require baseline-vs-new comparative evaluation.
