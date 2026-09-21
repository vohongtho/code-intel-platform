# Design: Safe Refactoring and Architecture Guards

## Ownership
Refactoring consumes the existing canonical resolver/evidence graph. Architecture consumes existing graph/framework/community evidence. Structural checks orchestrate existing analyzers.

## New modules
- `code-intel/core/src/refactoring/contracts.ts`;
- `refactoring/rename-plan.ts`;
- `refactoring/edit-spans.ts`;
- `refactoring/apply.ts`;
- `refactoring/verify.ts`;
- `analysis/architecture-layers.ts`;
- `governance/policy-schema.ts`;
- `governance/structural-check.ts`.

## Exact editable spans
Current graph line ranges alone are not enough for safe token replacement. Rename apply requires a language adapter that returns exact text/byte range tied to canonical target identity.

```ts
interface RefactoringCapability {
  language: Language;
  rename: 'apply' | 'preview-only' | 'unsupported';
  reason?: string;
}
```

Preview may list semantic references even when editable spans are unavailable; apply refuses them.

## Rename plan
`buildRenamePlan` resolves a canonical selector and collects exact definitions/references/import aliases plus candidates/generated/boundaries. The plan contains a fingerprint over selected index identity and source files to edit.

Apply refuses stale plans if any file fingerprint changed.

## Apply transaction
- explicit `--apply`;
- dirty tree requires explicit `--allow-dirty`;
- validate repository-root containment and symlink policy;
- build complete replacements before writing;
- atomic per-file replacement with recoverable failure behavior;
- no Git stage/commit.

## Verification
`verifyRenameResult` reuses the normal analyzer, compares semantic before/after, validates exact reference targets, invokes API compatibility and structural check, and obtains suggested tests.

## Architecture model
`detectArchitectureLayers` returns advisory `LayerSuggestion[]` with evidence. `loadArchitecturePolicy` returns explicit `ArchitecturePolicy`.

Only explicit layer membership/rules can produce violations. The detector can propose config but never promote itself to policy.

## Structural check
`runStructuralCheck` accepts an index view, changed files/symbols, policy and rule set; returns stable `StructuralFinding[]` plus coverage. SARIF conversion reuses `cli/sarif-builder.ts`.

New cycle logic must distinguish newly introduced cycles from pre-existing debt when a base ref is available.

## Public surfaces
CLI:
- `refactor rename ...`;
- `check --changed|--base <ref>`.

MCP/HTTP may expose `rename_plan` and `structural_check` as read-only. Source writes remain CLI/local only.

## Tests
Fixtures for same-name symbols, overloads, alias imports, overrides, generated files, candidate strings, Unicode/CRLF, stale plan, dirty tree, path escape, allowed/forbidden layers, new/pre-existing cycles and incomplete coverage.

## Rollout
Enable apply only for language rows whose exact-span + semantic-reference tests pass. Other rows remain preview-only. Expanding a row requires explicit test evidence.

## Alternatives rejected
Textual rename; inferred-policy enforcement; direct browser/MCP writes; separate architecture graph engine.
