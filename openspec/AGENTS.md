# OpenSpec Implementation Instructions for v1.0.8

## Scope

These changes are implementation plans for branch `release/1.0.8`. Treat the source repository as brownfield code. Preserve current behavior unless a requirement explicitly changes it.

## Mandatory workflow

1. Read the selected `proposal.md`, all delta specs, `design.md`, and `tasks.md`.
2. Inspect every source file named by the next task before editing it.
3. Implement tasks in order and check them off only after their stated tests pass.
4. Update proposal/design/specs when implementation discovery changes an assumption.
5. Run focused tests after each task group and the full release gate at the end.
6. Keep commits scoped to one coherent task group.

## Correctness rules

- Do not shell-interpolate Git refs or file paths.
- Do not write to the currently published generation during analysis.
- Do not publish metadata for artifacts that did not validate.
- Do not claim an index is fresh by timestamp alone.
- Do not label hybrid ranking as vector ranking.
- Do not return a context document above the normalized token budget.
- Do not duplicate diff parsing, symbol mapping, blast-radius traversal, or test suggestion logic inside MCP/HTTP/CLI handlers.
- Do not add a fallback that hides an integrity failure; return a diagnostic code.

## Code organization rules

- Keep `cli/app.ts`, `http/app.ts`, and `mcp-server/server.ts` as transport/wiring layers.
- Put reusable behavior in focused modules under `pipeline/`, `storage/`, `search/`, `context/`, and `query/`.
- Export discriminated unions for recoverable states instead of using `null` to erase failure causes.
- Use stable sorting wherever output is consumed by an agent or snapshot test.
- Keep verbose search evidence opt-in.

## Test rules

- Use temporary repositories initialized inside tests.
- Set local Git identity in each fixture repository.
- Test spaces and shell metacharacters in paths and refs.
- Reopen graph, BM25, vector, and metadata artifacts after publication/failure.
- Compare normalized node and edge content, not only counts.
- Avoid fake vector database files when testing a successful vector path; inject a vector search dependency or create a valid minimal index.
