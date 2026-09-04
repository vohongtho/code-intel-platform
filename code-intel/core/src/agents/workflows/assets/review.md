## When to use

Reviewing a diff, PR, or set of commits — for correctness, risk, and quality issues grounded in what actually changed, not a general codebase audit.

## Tool sequence

1. **`detect_changes`** (or use the diff already provided) to establish the exact changed symbols — this is the review's scope.
2. **`pr_impact`** across the changed files for blast radius and risk scoring; use it to prioritize which changed areas need the closest reading.
3. **`health_report`** scoped to the changed area(s) for dead code, cycles, god nodes, and orphan files introduced or touched by the change.
4. **Complexity/coverage/deprecated/security tools** — `complexity_hotspots`, `coverage_gaps`, `deprecated_usage`, `secrets`, `vulnerability_scan` — scoped to the changed files, only as relevant to what actually changed. Don't run a full-repo audit disguised as a PR review.
5. **Relationship evidence** only for changed symbols whose behavior depends on it (e.g. `explain_relationship`/`blast_radius` to confirm a caller assumption a reviewer would otherwise have to guess at).

## Decision branches

- **Severity rubric**: tie severity to demonstrated behavior/impact from the tools above — a proven correctness bug or a `pr_impact` HIGH-risk area is high severity; a style-only or naming observation is never high severity, regardless of how it reads.
- **Partial analysis**: if `pr_impact`/`health_report`/scan tools returned partial, truncated, or unavailable results for part of the diff, mark that part **needs verification** in the review output — do not let a partial scan produce a false "looks clean." Check `certainty` (not just `risk`) on each changed symbol: `pr_impact`'s `risk` field only downgrades to `UNKNOWN` when evidence-store coverage is genuinely incomplete, so a symbol can carry `certainty: "heuristic"` or `"lower-bound"` while `risk` still reads LOW/MEDIUM/HIGH — read both before calling something clean.
- **Finding without graph/change evidence**: still reportable (e.g. an obvious off-by-one visible from reading the diff), but must not claim graph-based impact evidence it doesn't have.

## Output shape

Each finding must include: source location, why it's a defect/risk (the reasoning, not just a label), graph/change evidence where applicable (cite the tool call), the affected behavior, and a concrete way to validate it (a test to run, a specific case to check). The overall review must state explicitly whether it is complete or has a "needs verification" section for anything the tools couldn't fully cover.
