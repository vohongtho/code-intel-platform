## When to use

Reviewing a change to an HTTP route's method, path, request shape, or response shape — especially when other services or frontends may consume it.

## Tool sequence

1. **`routes`** to establish the baseline route inventory (always available — this is your floor, not your ceiling).
2. **`api_contract`** for the specific route(s) touched, when registered — method, normalized path, request/response fields with requiredness, and known consumers with match certainty.
3. **`api_impact`** for the same route(s), when registered — every statically resolved consumer (fetch/Axios/Angular HttpClient), each with match strategy and certainty. Use this before concluding a shape change is safe.
4. **`api_drift`**, when comparing two already-indexed repos (base vs head), for a compatibility classification (compatible/potentially-breaking/breaking/unknown) with consumer evidence. **`group_contract_drift`** is the equivalent check across a synced group's registered repos/refs.
5. **`pr_impact`** on the handler symbol as a baseline that's always available, regardless of whether the above graph-aware contract tools are registered.

## Decision branches

- **`api_contract`/`api_impact`/`api_drift` unavailable** (older/partial runtime): fall back to `routes` + `pr_impact` + reading the handler source directly. You MAY still describe the change, but you MUST state explicitly that response-shape compatibility was not proven — do not claim compatibility or breakage without the contract tools' evidence.
- **Do not infer compatibility from route names/paths alone.** A path or method that "looks the same" is not proof the request/response shape is unchanged — always base a compatibility claim on `api_contract`/`api_impact`/`api_drift` field-level evidence, or state that it's unverified.
- **Known frontend consumer vs. dynamic/unknown consumer**: when `api_impact`/`api_contract` names a specific consumer call site, treat the finding as verified for that consumer. When no consumer is statically resolved (a dynamic URL, a consumer outside indexed repos), say the blast radius on the consumer side is unknown — not "no consumers."
- **Cross-repo drift without a synced group**: if `group_contracts`/`group_contract_drift` isn't available because the group hasn't been synced, say cross-repo consumer evidence is unavailable rather than silently skipping the check.

## Output shape

Report, per changed route: method/path change, request field changes (added/removed/requiredness/type) with source, response field changes with source, known consumers and their match certainty, and a cross-repo drift classification — each field marked either **proven** (from a contract/drift tool) or **unverified** (fallback path, capability unavailable).
