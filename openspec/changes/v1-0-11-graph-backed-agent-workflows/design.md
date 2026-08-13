# Design: Graph-Backed Agent Workflows

## Packaging

Skills are versioned product assets, not hard-coded strings in MCP handlers. Suggested layout:

```text
agent-assets/workflows/
  explore/
  debug/
  impact/
  plan/
  review/
  api-review/
  tests/
  security/
```

Each workflow has metadata declaring minimum Code Intel version, required/optional MCP capabilities, supported agent targets, managed file destination, and content fingerprint.

## Workflow contract

Every workflow follows common stages where applicable:

```text
scope repository
 -> discover/select canonical symbols
 -> inspect graph/context evidence
 -> assess coverage/certainty
 -> read targeted source when needed
 -> form conclusion/plan
 -> validate with tests/impact/security tools
```

It must explicitly prohibit interpreting incomplete graph coverage as proof of safety.

## Tool-selection rules

Examples:

- Use `search` for discovery, then `inspect`/canonical selector before identity-sensitive conclusions.
- Use `blast_radius`/`pr_impact` rather than manually approximating impact from text search.
- Use `context` for token-budgeted evidence; do not repeatedly request already-served code when receipt metadata indicates it was delivered.
- Use specialized API/test/security tools when the task is specifically about those domains.
- Use raw graph query only when standard tools cannot express the question.

Names must be generated from actual runtime tool schemas during release validation so documentation drift is detected.

## Trust behavior

Workflow templates consume compact `coverage`, `certainty`, `truncated`, `stale`, and boundary fields. A required capability that reports partial/unknown changes the workflow language from conclusion to hypothesis/verification.

## Installation ownership

Reuse existing agent-target-aware setup registry and managed-file ownership. Never overwrite a user-owned skill file silently. Managed generated assets include version/fingerprint markers where target format permits.

## Capability negotiation

When a workflow references an optional feature unavailable in the connected runtime, it falls back to the nearest existing capability and states the reduced guarantee. Example: API review can use routes + blast radius before graph-aware API contracts are available, but must not claim response-shape compatibility.

## Validation

Fixture repositories define expected tool sequences/decision points rather than exact natural-language prose. Tests check that each installed workflow mentions only valid tools, includes trust-boundary rules, and survives setup reruns without destructive overwrite.

## Security

Workflow assets are static trusted package content. Repository source text must never be interpolated into installed instruction files during setup.
