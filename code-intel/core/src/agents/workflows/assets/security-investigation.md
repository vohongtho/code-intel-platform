## When to use

Investigating a potential secret, vulnerability, or exploitable data flow — for a security review request, a scanner alert, or a suspicious pattern you noticed while reading code.

## Tool sequence

1. **`secrets`** scoped to the relevant path, to catch hardcoded credentials/keys/tokens/high-entropy strings.
2. **`vulnerability_scan`** scoped to the relevant path, filtered by `types`/`severity` as relevant to the investigation (SQL injection, XSS, SSRF, path traversal, command injection).
3. For each finding worth escalating, **`find_path`** (and `explain_relationship` when available) from the suspected source (user input, request parameter) to the suspected sink (query execution, shell exec, file write) to establish whether a real call path connects them.
4. **`context`**, when available, on the source/sink symbols for token-budgeted evidence; otherwise read the flagged file directly for the specific lines in question.

## Decision branches

- **Scanner finding with no proven call path**: `secrets`/`vulnerability_scan` are heuristic — a finding on its own is a **candidate requiring verification**, not a proven vulnerability. Only escalate to "exploitable" once `find_path`/`explain_relationship` (or direct source reading) actually shows a source-to-sink path with no sanitization in between.
- **Proven source-to-sink path**: state the exact path (symbols/files) as evidence, and note any sanitization/validation you found along the way (or its absence).
- **Future PDG/taint-analysis capability**: if a future runtime exposes a dedicated data-flow/taint tool, negotiate its use as an *additional* optional capability rather than requiring it — this workflow must keep working with just `secrets` + `vulnerability_scan` + graph path evidence on a 1.0.11 runtime.
- **No path found within traversal depth**: report "no call path found within the traversed scope" — not "not exploitable" — since the static graph may not see dynamic dispatch or cross-service calls.

## Output shape

For each finding: whether it's a **scanner signal** (from `secrets`/`vulnerability_scan` alone) or a **proven flow** (source-to-sink path established), the supporting evidence (cite the tool call/path), severity as reported by the scanner (do not re-rank it upward without new evidence), and — for proven flows — a concrete remediation.
