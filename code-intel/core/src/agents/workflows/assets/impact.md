## When to use

Before or after making a change, when you need to know what it actually affects — for a working-tree diff, a specific commit range, or a symbol you're about to edit.

## Tool sequence

1. **`detect_changes`** against the relevant `base_ref` (or pass `diff_text` directly) to map the diff to changed graph symbols — this is your scope, not a manual file list.
2. **`blast_radius`** for each directly changed symbol (`direction: both` unless the change is clearly one-directional) to get downstream/upstream impact with a risk level.
3. **`pr_impact`** across the full changed-file set for combined, deduplicated risk scoring and top-files-to-review. Use `analysisMode: "semantic-snapshot"` with `base_ref`/`head_ref` when you need an independent semantic graph diff (`graph_diff`) layered on top — never as a replacement for the textual-hunk blast radius, only as additional evidence.
4. **Flows/routes/contracts** — pull in `flows`, `routes`, or `api_impact` only for changed symbols that are actually on an execution flow or HTTP route.
5. **`suggest_tests`** for each directly changed symbol to produce evidence-backed test suggestions.

## Decision branches

- **Truncated/partial traversal**: if `blast_radius`/`pr_impact` indicate the traversal hit `max_hops` or was otherwise truncated, do not conclude low risk just because the returned result count is small — say the traversal was bounded/partial and that deeper impact is unproven, not absent.
- **Semantic-snapshot capability unavailable**: if `graph_diff`/`api_impact` aren't registered on this runtime, use `analysisMode: "current-graph"` (textual-hunk blast radius) only, and say explicitly that an independent semantic-graph diff was not performed.
- **Cross-repo contract change**: only report impact in a consumer repo when you have actual group/contract evidence (`group_contracts`, `api_impact`) pointing to it — never assume a consumer repo is affected just because the change touches something that sounds shared.

## Output shape

Separate, clearly labeled fields:
- **Directly changed symbols** (from `detect_changes`)
- **Exact downstream impact** (from `blast_radius`/`pr_impact`, within the traversed/non-truncated scope)
- **Candidate/heuristic impact** (anything inferred rather than proven — name why it's a candidate, not a fact)
- **Unresolved boundaries** (truncated traversals, dynamic dispatch, missing capability)
- **Affected flows/routes/contracts**
- **Suggested tests**
