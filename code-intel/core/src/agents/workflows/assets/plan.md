## When to use

Before writing an implementation plan or proposing a multi-step change — to make sure every step is grounded in canonical symbols and real consumer/test evidence rather than a guess at file layout.

## Tool sequence

1. **`search`** to find candidate target symbols for the feature/fix.
2. **`inspect`** each target to confirm canonical identity, current owner file, callers, and callees.
3. **`blast_radius`** each target (`direction: callers`) to know who consumes it before you decide how invasive the change can be.
4. **`context`** the target set with `task` describing the planned change and `intent: "callers"` or `"architecture"` as appropriate, to pull in focused evidence for the plan instead of re-reading whole files.
5. **Contracts/flows/tests** — pull in `routes`/`api_contract` when a target is behind an HTTP route, `flows` when it's on a named execution flow, and `suggest_tests` for validation steps.

## Decision branches

- **Ambiguous relationship evidence does not create a mandatory edit.** If `blast_radius`/`context` evidence for a possible consumer is inferred rather than proven (e.g. a same-directory guess, a partial/truncated traversal), put the corresponding plan step in "candidate," not "required," and say what would need to be verified to promote it.
- **Cross-repo contract change**: only include a consumer repo in the plan when `group_contracts`/`api_impact`/`api_contract` evidence actually supports it — an unsynced or absent group must not silently expand or silently omit scope; say which repos you could and couldn't verify.
- **No canonical target found**: if `search`/`inspect` can't resolve a canonical symbol for a described feature area, say so and ask for the entry point rather than picking an unrelated best-guess symbol.

## Output shape

A plan where every step contains: the target's canonical id/file/range (from `inspect`), the reason/evidence for the step (cite the tool call), the expected semantic effect, affected tests, and a concrete validation command or tool call to run after the edit. Each step is labeled **required** (proven evidence) or **candidate** (needs verification before it's binding).
