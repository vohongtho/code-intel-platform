<!-- code-intel:workflow-shared-fragment -->
## Evidence rules (apply to every Code Intel workflow)

These rules are shared by every graph-backed workflow below. They exist because two agents connected to the same MCP tools can produce wildly different investigation quality — one searches text and edits immediately, another uses canonical identity, graph impact, and validation evidence. Follow these rules regardless of which workflow stage you are in.

### 1. Canonical identity before conclusions

When a `search` or text match returns more than one plausible symbol (same name in different files/classes, an overload, a shadowed export), do not silently pick the first result. Use `inspect` (or `file_symbols` for a specific file) to resolve the **canonical** symbol before you state anything about its callers, callees, or behavior. If the ambiguity can't be resolved from graph evidence alone, ask which one the user means rather than guessing.

### 2. Every claim needs source or relationship evidence

A statement about what code does, what depends on it, or what breaks if it changes must be backed by a specific tool result you actually retrieved in this session — a symbol from `inspect`/`search`, an edge from `blast_radius`/`find_path`/`explain_relationship`, a route from `routes`/`api_contract`, or a line range you read. Don't restate a plausible-sounding claim from training data as if it came from this repository's graph.

### 3. Certainty and coverage propagate — don't launder them away

Code Intel tools report coverage/certainty signals (e.g. blast-radius `direction`/`max_hops` truncation, `api_contract`/`api_impact` consumer "match certainty", `group_contract_drift`/`api_drift` coverage fields, `context` receipt/omission metadata). When a tool result is **partial, truncated, or has unresolved/dynamic call sites**, your conclusion must say so explicitly and stay at hypothesis level. Never upgrade "the graph didn't find more" into "there is nothing more."

**Hard rule:** `0 callers`, `0 impact`, `no consumer`, `safe to remove`, and `unused` are exact claims. You may only state them as exact when the tool that produced the zero explicitly reports complete/exact coverage for that traversal (not truncated, not max-hops-limited, not marked partial/unknown). Otherwise say "no *known* callers within the traversed scope" and name the scope/limit.

**Watch for self-inclusion:** `blast_radius`'s `affected` array (and `affectedCount`) always includes the target symbol itself at depth 0 — a target with genuinely zero callers/callees still reports `affectedCount: 1`, not `0`. Filter out the target's own entry before deciding whether "zero callers" applies; never read a nonzero `affectedCount` alone as evidence that something depends on the target.

### 4. Read graph evidence first, raw source second — and don't re-read what you already have

Use `context`/`inspect` results as your first pass. Only drop into targeted raw source reading for the specific lines that are unresolved or answer-bearing — not the whole file "just in case." If a `context` receipt indicates a symbol's code was already delivered in this session, don't re-request it; reuse what you have. This keeps investigations token-efficient and keeps you honest about what evidence you actually reviewed.

### 5. Tool selection order

- Use a typed tool (`search`, `inspect`, `blast_radius`, `pr_impact`, `api_contract`, etc.) over `query`/`raw_query` whenever a typed tool can express the question — typed tools carry structured coverage/certainty fields that `query`/`raw_query` do not.
- Reach for `query` (GQL) only for traversals/filters no typed tool expresses (e.g. a custom `TRAVERSE ... DEPTH n` shape).
- Reach for `raw_query` only when even GQL can't express it (exact name / kind-listing edge cases). Treat it as a last resort, not a shortcut.

### 6. Never bypass repository scope

Always resolve and respect the repo/group scope (`repoId`/`scope: {type, repoId|name}`) the user is working in. Do not silently widen a query to "any repo" to get more results, and do not skip a group's `group_status` staleness check when the task depends on freshness.

### 7. No automatic source mutation before evidence gathering

Workflows in this bundle are read/investigate-first. Do not create, edit, or delete files as an automatic first move — gather graph + targeted source evidence, form a conclusion or plan, and only then propose or make edits, with the user in control of when edits actually happen.
<!-- /code-intel:workflow-shared-fragment -->
