## When to use

You need to understand how a part of this codebase works — before answering a question about it, before planning a change, or as the first step of any other Code Intel workflow when you don't yet know the relevant symbols.

## Tool sequence

1. **Resolve scope.** Confirm you're working in the right repo, or the right group if this is a multi-repo question (`group_status` for a group scope — check freshness before trusting results).
2. **`search`** the concept/keyword/symbol name you're looking for, scoped to that repo/group. Read the top results before picking one.
3. **`inspect`** (or `file_symbols` if you already know the file) the canonical symbol(s) that best match — this gives definition location, callers, callees, heritage, and a source preview in one call.
4. **`context`** the selected symbol(s) with a `task` description of what you're trying to understand — this builds a token-budgeted bundle (summary, logic, relations, focused snippets) instead of you re-reading whole files.
5. **Relationship/flow/route evidence** — pull in `routes`, `flows`, or `explain_relationship` only if the question is about architecture, an HTTP surface, or how two symbols connect.
6. **Targeted source verification** — only after the above, and only for the specific lines still unresolved. Do not re-open a file whose relevant code was already delivered by `context`.

## Decision branches

- **Ambiguous search result** (multiple symbols with the same/similar name): use `inspect` on each candidate to compare definition location and callers before choosing. State which one you picked and why. If it's genuinely ambiguous from graph evidence, ask the user instead of guessing.
- **Ambiguous symbol selector** (e.g. an overloaded method, a re-exported name): prefer the definition-site symbol over a re-export; call out that you resolved a re-export if one was involved.
- **Stale or unavailable index**: if `search`/`inspect` return errors indicating a missing/stale index, say so and suggest `code-intel analyze` rather than falling back to a blind grep-and-guess.
- **Partial relationship evidence**: if `explain_relationship` returns no path within the traversed depth, say "no path found within N hops" — not "these are unrelated."
- **Multi-repo scope**: if the question spans a group, use `group_status` first; if some member repos are stale/unindexed, name them and scope your answer to what's actually indexed.

## Output shape

Summarize what you found with: the canonical symbol(s) and file locations, what they do (from `context`/`inspect`, not guessed), and any architecture evidence (routes/flows/relationships) you pulled in — each claim traceable to a specific tool call you made.
