## When to use

You're chasing a bug, a test failure, or unexpected behavior and need to find the root cause before proposing a fix.

## Tool sequence

1. **Localize the symptom.** `search` the error message, symbol name, or behavior described in the bug report to find candidate symbols/files.
2. **`inspect`** each serious candidate for its canonical identity, callers, and callees.
3. **Trace the graph** in the direction the symptom points: `blast_radius` (direction `callers` to find what could be triggering it, `callees` to find what it depends on) and `find_path`/`explain_relationship` to prove or disprove a suspected connection between two specific symbols.
4. **`detect_changes`** when the bug is plausibly a regression — correlate the symptom with what actually changed recently (a specific `base_ref`) rather than assuming.
5. **Form ranked hypotheses.** Each hypothesis must cite the specific symbols/files/relationships that support it.
6. **Falsify before you fix.** For your leading hypothesis, state what evidence would prove it wrong, and check for that evidence (a caller you expected doesn't exist, a path you expected isn't there) before recommending a code edit.

## Decision branches

- **Nearest lexical match isn't the real caller path**: if `search` returns a symbol whose name looks related but `blast_radius`/`find_path` show it isn't actually reachable from the entry point in question, say so explicitly and keep looking — don't default to the textually-closest match just because it's convenient.
- **Runtime-only / external / dynamic boundary**: when the suspected cause crosses a boundary the static graph can't see through (reflection, dynamic `require`/`import`, an external service call, a config-driven dispatch), say plainly that the graph cannot prove causality here, name the missing evidence, and suggest how to get it (logs, a runtime trace, a targeted read of the dynamic-dispatch site).
- **Multiple plausible hypotheses**: rank by evidence strength (a proven call path beats a same-directory coincidence), not by which one is easiest to fix.
- **No path found**: if `find_path`/`blast_radius` return no connection within the traversed depth, report that as "no path found within the traversed scope," and consider increasing `max_hops` before concluding the symbols are unrelated.

## Output shape

A ranked list of hypotheses, each with: the supporting symbols/files/relationships (cite the tool call), a falsification check you performed or propose, and — only for the hypothesis with the strongest evidence — a specific, minimal recommended change.
