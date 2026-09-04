## When to use

Deciding what to test for a change, or investigating whether an area of the codebase is adequately covered.

## Tool sequence

1. **Scope the symbols.** Use `detect_changes` when working from a diff, or take the symbol(s) the user names directly.
2. **`suggest_tests`** for each scoped symbol — call paths, suggested cases, existing tests, and untested callers.
3. **`coverage_gaps`** scoped to the relevant path prefix — exported symbols with no test coverage, ranked by blast radius, to catch gaps `suggest_tests` alone wouldn't surface.
4. **`blast_radius`** for each scoped symbol to rank transitively-affected areas that might also need test attention.
5. **`flows`**, when available, to note which named execution flow a suggested test actually exercises.

## Decision branches

- **Direct vs. transitive tests**: label a test **direct** when it's returned by `suggest_tests`/an existing test found for the scoped symbol itself, and **transitive** when it's suggested because of `blast_radius`/`coverage_gaps` impact on a caller — transitive suggestions need a stated rationale (which relationship makes it relevant), not just "related."
- **No known test found, but coverage is incomplete**: if `suggest_tests` returns no existing tests and `coverage_gaps` shows the symbol (or its callers) as uncovered, you MUST NOT conclude "no tests required." State that coverage is unknown/incomplete and propose at minimum one direct test for the changed behavior.
- **Coverage tool unavailable/partial**: if `coverage_gaps` can't cover the full scope (e.g. very large blast radius truncated), say the coverage picture is partial rather than presenting the gaps you did find as exhaustive.

## Output shape

A minimal test plan: for each proposed test, whether it's direct or transitive, the certainty of that classification, and the rationale (a specific call path, coverage gap, or flow it addresses). Explicitly state any part of the target's behavior you could not evaluate coverage for.
