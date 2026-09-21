# v1.0.12: Safe Refactoring and Architecture Guards

## Change ID
`v1-0-12-safe-refactoring-and-architecture-guards`

## Feature IDs
F05, F11, F12

## Priority
P1

## Summary
Add identity-based rename planning/application with verification, evidence-scored architecture-layer discovery plus explicit enforceable dependency policy, and one structural check command suitable for local/CI/pre-commit use.

## Source-verified baseline
The v1.0.11 graph already stores canonical identity, legacy IDs, relationship certainty/strategy/evidence and cross-file links. API compatibility, test coverage/impact, health analysis and `cli/sarif-builder.ts` can be reused.

No first-class semantic rename planner, architecture-layer policy model or unified structural check command was found.

`clustering/community-detector.ts` currently groups symbols largely by directory. That is useful evidence but is not an architecture model and SHALL NOT become an enforcement rule by itself.

## Safe rename workflow
```bash
code-intel refactor rename UserService AccountService --dry-run
code-intel refactor rename <canonical-selector> AccountService --apply
```

Dry-run is the default. The plan reports:
- exact definition edit(s);
- exact semantic reference edits with source spans;
- import/export/alias edits;
- candidate string/config/generated occurrences that are NOT auto-edited;
- unsupported/preview-only language boundaries;
- affected APIs/flows/tests;
- expected post-edit graph changes.

Name-only selectors that resolve to more than one canonical symbol fail and return disambiguation.

## Edit certainty
Occurrences:
- `exact-definition`;
- `exact-semantic`;
- `candidate-text`;
- `generated`;
- `unsupported`.

Default apply edits only exact categories with a tested exact source span. Candidate strings are surfaced but not modified.

A refactoring capability matrix reports per language:
- `apply`;
- `preview-only`;
- `unsupported`.

A language being parseable is not proof that byte/range-safe rewrite is supported.

## Post-edit verification
After apply:
1. run the normal analysis planner;
2. verify old canonical selector disappears only where expected;
3. verify new definition/reference relationships;
4. compute semantic graph diff;
5. run API compatibility and architecture checks;
6. suggest affected tests.

Verification failure prevents a success verdict. No Git commit is made.

## Architecture layer discovery
Produce advisory layer suggestions from:
- path/directory patterns;
- import/call direction;
- framework roles such as controller/service/repository;
- existing communities/clusters.

Suggestions include confidence/evidence. They never fail CI.

## Explicit architecture policy
Enforcement requires explicit configuration, conceptually:
```yaml
architecture:
  layers:
    - id: api
      include: ["src/api/**"]
    - id: domain
      include: ["src/domain/**"]
    - id: infrastructure
      include: ["src/infrastructure/**"]
  rules:
    - from: domain
      forbid: [api]
```

Implementation should reuse the existing Code Intel config surface if it can express this cleanly rather than introducing unnecessary config files.

## Structural check
```bash
code-intel check --changed
code-intel check --base main --format sarif
```

Rules may compose:
- explicit architecture dependency violations;
- newly introduced import cycles;
- breaking API contract changes;
- changed high-risk behavior with no known relevant tests;
- refactoring verification failures;
- selected existing security/deprecation checks.

Every finding includes rule ID, severity, location/evidence, certainty/coverage and hint. Exit threshold is configurable.

## Hook/CI behavior
Hook installation is opt-in. Existing setup SHALL NOT silently add a blocking pre-commit hook.

## Security/safety
Edits cannot escape repo root; generated/vendor files are non-editable by default; stale plan fingerprints refuse apply; dirty tree requires explicit acknowledgement; MCP/HTTP expose planning/checking only and do not write source.

## Non-goals
LLM transformations; global text replacement; inferred architecture labels blocking builds; full LSP implementation; regex rewrite for unsupported languages; automatic Git commits.

## Acceptance
Duplicate names/overloads do not co-rename; aliases/imports are tested in supported languages; candidates stay untouched; verification runs after apply; SARIF stable; inferred-only architecture never blocks.
