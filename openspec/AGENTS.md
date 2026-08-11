# OpenSpec Implementation Instructions for v1.0.11

## Scope

These changes are implementation plans for branch `release/1.0.11`, based on the exact published v1.0.10 source at `52dfda4c1dd78b7667cc8a10606ade65a7807d90`. Treat the repository as brownfield code. Preserve v1.0.10 behavior unless a v1.0.11 requirement explicitly changes it.

## Mandatory workflow

1. Read the selected `proposal.md`, all delta specs, `design.md`, and `tasks.md`.
2. Inspect every source file named by the next task before editing it.
3. Verify that the capability is not already present under another name before creating a new abstraction.
4. Implement tasks in dependency order and check them off only after stated tests pass.
5. Update proposal/design/specs when implementation discovery changes a source assumption.
6. Run focused tests after each task group and the full release gate at the end.
7. Keep commits scoped to one coherent task group.

## Zero-workflow-change rule

Core-intelligence improvements SHALL be internal by default. Do not add a mandatory user command, required config flag, replacement MCP tool, or alternate HTTP workflow merely to enable a more accurate engine. Existing `init`, `analyze`, `setup`, `serve`, MCP, HTTP, and Web workflows must automatically benefit after upgrade.

## Correctness rules

- Do not shell-interpolate Git refs or file paths.
- Do not write to the currently published Generation V2 snapshot during analysis.
- Do not publish metadata for artifacts that did not validate after reopen/read-back.
- Do not claim an index is fresh by timestamp alone.
- Do not label candidate/heuristic resolution as exact.
- Do not treat `0 relationships` as proof of safety when coverage is incomplete.
- Do not collapse multiple symbol candidates into one because a simple name matches.
- Do not erase generic/type-application structure before language-specific semantics are evaluated.
- Do not silently skip a semantic extraction failure that can make cross-file analysis incomplete; emit bounded diagnostics.
- Do not return a context document above the normalized token budget.
- Do not duplicate semantic parsing/resolution logic inside MCP/HTTP/CLI handlers.
- Do not add a fallback that hides an integrity failure; return a structured diagnostic/boundary.

## 15-language rules

- Shared semantic-engine changes must run the canonical 15-language release matrix.
- A language row may report `partial` or `not-applicable`; it may not fabricate support merely to pass a feature-count gate.
- One failing language fails a shared semantic-engine release gate even if aggregate averages pass.
- Tests must cover production adapter paths, not only isolated helpers.
- Performance gates must include workspace traversal/index-build counters plus scaling measurements.

## Code organization rules

- Keep `cli/app.ts`, `http/app.ts`, and `mcp-server/server.ts` as transport/wiring layers.
- Keep Generation V2 as the atomic publication owner.
- Put semantic facts under a focused semantic layer, resolver behavior under a focused resolution layer, and evidence under a reusable trust/evidence layer.
- Language-specific semantics may extend a universal contract; do not fork the entire resolver per language.
- Framework semantics must produce standard facts/evidence rather than mutate graph consumers directly.
- Export discriminated unions for recoverable states instead of using `null` to erase failure causes.
- Use stable sorting wherever output is consumed by an agent, fingerprint, or snapshot test.
- Keep verbose evidence opt-in; compact trust metadata may be additive by default.

## License rules

- GitNexus source is noncommercial licensed. Do not copy GitNexus source, tests, prompts, skills, schemas, or implementation expression into this MIT commercial project. Reimplement requirements independently.
- CodeGraph is MIT. If substantial CodeGraph source is copied, preserve required MIT attribution; prefer original integration with Code Intel abstractions.

## Test rules

- Use temporary repositories initialized inside tests.
- Set local Git identity in each fixture repository.
- Test spaces and shell metacharacters in paths and refs.
- Reopen graph, BM25, vector, evidence, and metadata artifacts after publication/failure.
- Compare normalized node/edge/evidence content, not only counts.
- Add negative fixtures proving forbidden targets are not emitted.
- Add ambiguity/truncation fixtures wherever candidate sets are bounded.
- Avoid fake vector database files when testing a successful vector path; inject a search dependency or create a valid minimal index.
