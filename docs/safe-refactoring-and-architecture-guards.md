# Safe refactoring and architecture guards (v1.0.12)

v1.0.12 adds two things on top of the existing graph: a rename that resolves one canonical symbol and edits only spans it can prove refer to that symbol, and a `check` command that turns explicit architecture rules, new import cycles, API drift and untested high-risk changes into one evidence-bearing verdict. Code lives in `code-intel/core/src/refactoring/`, `code-intel/core/src/governance/` and `code-intel/core/src/analysis/architecture-layers.ts`.

## Rename

```bash
code-intel refactor rename UserService AccountService                       # dry run (default)
code-intel refactor rename class:UserService@src/user.ts AccountService \
  --apply --expect-plan rename:v1:<hash>
```

The selector is a name or a canonical selector `kind:name@path[:line]`. If a name matches more than one symbol, the command exits 2 and lists the canonical selectors to choose from. It never picks one.

The dry run writes nothing. It prints every occurrence with a category:

| Category | Meaning | Edited by `--apply` |
|---|---|---|
| `exact-definition` | the declaration itself | yes |
| `exact-semantic` | a reference, named import, re-export or namespace member (`ns.X`) proven to bind to the target | yes |
| `candidate-text` | the name in a string, comment or unrelated property | never |
| `generated` | an exact span inside `dist/`, `node_modules/`, `*.generated.*`, `*.d.ts` and similar | never, and it blocks apply |
| `unsupported` | a use the adapter cannot rewrite exactly (shorthand property, `require`/dynamic import, unresolved path alias, preview-only language) | never, and it blocks apply |

Anything that would make an automatic edit unsafe is a boundary, and any boundary makes the plan non-applicable: overloads or declaration merging, a name collision with the new name, a parse error in a file to be edited, a generated file, an unsupported occurrence, an exact graph relationship from a file where no exact span was found, or an invalid/reserved new name.

### What `--apply` does

1. Re-analyzes the working tree in memory and builds a fresh plan. The persisted index is not used for apply, and nothing is written to it (relationship evidence from this analysis goes to an in-memory store).
2. With `--expect-plan`, refuses unless the fresh plan id equals the one you reviewed. The id is a hash of the target, new name, edits and edited-file contents. It does not include the index identity, so a dry run against the index and an apply against the working tree produce the same id when nothing changed.
3. Checks every file: inside the repo root after resolving symlinks, a regular file (symlinks are refused), not generated, content hash unchanged since planning.
4. Refuses if any file to be edited has uncommitted changes, unless `--allow-dirty` is passed. Outside a Git work tree it also refuses without `--allow-dirty`, because there is no recovery point.
5. Computes every new file content before the first write, writes same-directory temp files, then renames them into place. If a rename fails, files already replaced are restored. Nothing is staged or committed.
6. Verifies the result (below). A failed verification exits 1 and says the files changed but the result is not trusted.

Apply also validates the plan itself: each edit must replace exactly the target name with the new name, inside a fingerprinted file, and the language row must be `apply` in the published matrix, whatever the plan claims.

### Verification

After apply the workspace is analyzed again and compared with the pre-apply analysis. Success requires all of:

- `new-definition`: exactly one declaration with the new name, same kind and file.
- `old-definition-removed`: one fewer declaration with the old name.
- `references-resolve`: every edited file that had an exact graph relationship to the old symbol has the same kind of exact relationship to the new one.
- `source-references-resolve`: re-running the exact-span resolver for the new name finds the planned number of exact occurrences in each edited file and none in other files.
- `api-compatible`: no `breaking` API-contract finding between the two analyses.
- `structural-check`: no error-level policy or cycle finding in the edited files.

`source-references-resolve` exists because the graph check alone is too weak for TypeScript. The analyzer records imports file to file (`imports`, strategy `import-binding`) and emits no symbol edge for `new UserService()`, so a lost class reference changes no symbol relationship. On a rename of `riskFromCount` in this repo, `references-resolve` saw 0 exact graph relationships. The source check did the actual verification (3 occurrences in 2 files).

### Capability matrix

A language being parseable does not mean byte-exact rewriting works. A row becomes `apply` only when exact-span, transaction and post-apply verification tests exist for it. Preview-only languages still list graph references, but by enclosing symbol line, not by span, and apply refuses them.

<!-- capability-matrix:start -->
| Language | Rename | Scope / reason |
|---|---|---|
| typescript | apply | module-scope declarations (function, class, interface, type alias, enum, top-level const/let/var) and their ES-module imports, re-exports and namespace-member uses in .ts/.mts/.cts files; members, locals, .tsx (JSX), CommonJS/dynamic imports and declaration merging are preview-only |
| javascript | apply | module-scope declarations and their ES-module imports, re-exports and namespace-member uses in .js/.mjs/.jsx files; members, locals and CommonJS/dynamic imports are preview-only |
| python | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| java | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| go | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| c | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| cpp | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| csharp | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| rust | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| php | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| kotlin | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| ruby | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| swift | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| dart | preview-only | graph references can be listed by line, but no exact-span edit adapter is tested for this language |
| html | unsupported | markup has no renameable symbol declarations |
<!-- capability-matrix:end -->

`tests/unit/refactoring/capability-matrix-doc.test.ts` fails if this table and `REFACTORING_CAPABILITIES` drift apart.

### Known limits

- Large TypeScript files the tree-sitter grammar cannot fully parse block apply. Planning `createKnowledgeGraph` in this repo found 523 exact edits in 93 files in 680 ms, but `cli/app.ts`, `http/app.ts` and one test file report parse errors (all three compile with `tsc`), and two `.mjs` scripts load the module dynamically. The plan is correct and non-applicable.
- Offsets are UTF-16 indices. CRLF files and multibyte text are covered by tests; identifiers in the new name must be ASCII.
- New names are checked against any identifier already present in an edited file, including unrelated locals. This refuses some safe renames.

### Performance

`tests/performance/rename-plan-scaling.test.ts` plans a symbol that N files import (half through an `export *` barrel) and reference five times each, alongside N unrelated files. One local run:

| Consumers | Files | Edits | Plan time |
|---|---|---|---|
| 100 | 202 | 601 | 38 ms |
| 400 | 802 | 2401 | 99 ms |
| 1600 | 3202 | 9601 | 346 ms |

Unrelated files are filtered by text before parsing, so only files containing the name, an `export *`, or a dynamic load of the defining module are parsed. A real apply plus verification of `riskFromCount` on a copy of `code-intel/core/src` (405 files) took about 5 s, almost all of it the two analyses.

## Architecture layers

Discovery is advisory. `detectArchitectureLayers` suggests layers from directory names (`api`, `domain`, `infra`, ...), import direction between directories and shared cluster membership, each with a confidence and the evidence behind it. Suggestions appear in `check` output under `advisory.layers` and never produce a finding, at any `--fail-on` level.

Enforcement needs an explicit file at `.code-intel/architecture-policy.json`:

```json
{
  "schemaVersion": 1,
  "layers": [
    { "id": "api", "include": ["src/api/**"] },
    { "id": "domain", "include": ["src/domain/**"] },
    { "id": "infrastructure", "include": ["src/infrastructure/**"], "exclude": ["src/infrastructure/testing/**"] }
  ],
  "rules": [
    { "from": "domain", "forbid": ["api", "infrastructure"] },
    { "from": "infrastructure", "forbid": ["api"], "severity": "warning" }
  ]
}
```

It is JSON so no new parser dependency is needed, and it sits beside the project taint models with the same loading rules: fixed path, must resolve inside the repo, 256 KiB cap, unknown fields rejected. A file belongs to the first layer whose globs match. An invalid file is reported as an `architecture/policy-invalid` error; it is never treated as "no policy".

## `code-intel check`

```bash
code-intel check --changed                               # uncommitted changes vs HEAD, current index
code-intel check --changed --fresh                       # same, analyzing the working tree in memory
code-intel check --base main                             # main..HEAD, both sides from isolated snapshots
code-intel check --changed --base main --fail-on warning
code-intel check --base main --format sarif > code-intel.sarif
```

| Rule | Fires when | Severity |
|---|---|---|
| `architecture/policy-invalid` | the policy file exists but does not validate | error |
| `architecture/layer-violation` | a changed file imports a file in a layer its rule forbids | the rule's severity (default error); capped at warning for non-exact imports; note if the import already existed on the base side |
| `graph/new-import-cycle` | a file-level import cycle passes through a changed file | warning if the base side had no cycle over those files; note if pre-existing, or if there is no base |
| `api/breaking-change` | base→head API-contract drift is `breaking` or `potentially-breaking` | error / warning |
| `risk/untested-change` | a changed symbol is HIGH risk (more than 50 dependents within two hops) and neither PR impact nor test selection finds a test | warning, certainty `heuristic` |
| `refactor/verification-failed` | a rename verification check failed | error |

Every finding has a stable `id` (hash of rule, location and subject), `ruleId`, `severity`, `location`, `evidence`, `certainty` (`exact`/`candidate`/`heuristic`/`unknown`), `introduced` (`true`, `false`, or `null` when there was no base) and a `hint`. Only exact evidence can produce an error. Output is sorted by severity, rule, file, line and id, so identical input gives byte-identical JSON and SARIF. SARIF results carry the id as `partialFingerprints["codeIntelFindingId/v1"]`, and the run's `properties.coverage` carries the coverage block.

Coverage is marked partial, with reasons, when there is no base (cycles cannot be called new, API drift is skipped), when API consumer coverage is incomplete, when findings were truncated (`--max-findings`, default 500), or when `--changed` files are newer than the current index. A clean result with partial coverage is not proof of safety, and the text output says so.

Exit codes: 0 pass, 1 findings at or above `--fail-on` (default `error`; `never` disables), 2 the check could not run (unknown ref, no scope, invalid option).

### Pre-commit

`code-intel check --install-hook` writes `.git/hooks/pre-commit` running `code-intel check --changed --fail-on error`. It refuses if a hook already exists. Setup and init never install it.

## MCP and HTTP

Both surfaces are read-only. Writing source stays a local CLI action.

| | MCP tool | HTTP |
|---|---|---|
| Rename plan | `rename_plan` (`selector`, `newName`, `max_occurrences`) | `POST /api/v1/refactor/rename-plan` |
| Structural check | `structural_check` (`changedFiles`, or `base_ref` + optional `head_ref`; `rules`, `max_findings`) | `POST /api/v1/structural-check` |

Responses are bounded (200 occurrences / 200 findings by default, 2000 maximum) and always report totals and `truncated`. A plan response includes the exact CLI command to apply it with `--expect-plan`. HTTP routes require the `rename_plan`/`structural_check` tool scope and check the token's repository scope before loading anything. Building an uncached ref snapshot for `structural-check` needs the analyst role, the same rule as ref-aware reads.
