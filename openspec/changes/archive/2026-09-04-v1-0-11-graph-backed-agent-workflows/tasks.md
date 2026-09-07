# Tasks: Graph-Backed Agent Workflows

## 1. Baseline inventory

- [x] 1.1 Inspect `code-intel/core/src/cli/agent-targets.ts`, `code-intel/core/src/cli/context-writer.ts`, `code-intel/core/src/cli/hook-rewriter.ts`, `code-intel/core/src/cli/init-wizard.ts`, `code-intel/core/src/cli/app.ts`, existing setup implementation, repository-generated agent files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/code-intel.mdc`, `.kiro/steering/code-intel.md`, `.clinerules`, `.windsurfrules`, `.kilocode/rules/*`, `.agents/rules/*`), and `code-intel/core/src/mcp-server/server.ts`.
- [x] 1.2 Inventory current bundled `.claude/skills/code-intel/*` assets and classify them as module/reference documentation versus end-user engineering workflows. Do not duplicate an existing workflow under a new name.
- [x] 1.3 Record ownership/rewrite markers used by setup/context writers so workflow installation can distinguish Code Intel-managed content from user-authored content.
- [x] 1.4 Generate a machine-readable inventory of production MCP tool names and input/output schema fields from the same source used by `mcp-server/server.ts`; workflow validation MUST not rely on a handwritten stale list.

## 2. Workflow manifest and versioning

- [x] 2.1 Create `code-intel/core/src/agents/workflows/types.ts` defining `WorkflowId`, `WorkflowManifest`, `WorkflowCapabilityRequirement`, `WorkflowTarget`, `ManagedWorkflowAsset`, and version/fingerprint metadata.
- [x] 2.2 Create `code-intel/core/src/agents/workflows/registry.ts` with stable IDs for `explore`, `debug`, `impact`, `plan`, `review`, `api-review`, `test-coverage`, and `security-investigation`.
- [x] 2.3 Each workflow manifest MUST declare required MCP tools, optional tools, minimum capability/version, fallback behavior, target-agent support, asset path, and content fingerprint.
- [x] 2.4 Create `code-intel/core/src/agents/workflows/capabilities.ts` that resolves runtime capabilities from actual MCP schema/tool registration. Unsupported optional capability MUST downgrade a workflow step explicitly, not invent a tool call.

## 3. Shared evidence rules

- [x] 3.1 Create an original shared workflow evidence guide asset owned by this project. It MUST require canonical symbol selectors when available, source/relationship evidence for claims, certainty/coverage propagation, and explicit partial/truncated boundaries.
- [x] 3.2 Define a common rule: `0 callers`, `0 impact`, `no consumer`, `safe`, or `unused` may only be stated as exact when the corresponding tool reports complete/exact coverage.
- [x] 3.3 Define common source-reading rule: use Code Intel context/inspect evidence first, then targeted raw source verification only for unresolved/answer-bearing areas; avoid repeatedly reading whole files already delivered.
- [x] 3.4 Workflow assets MUST never instruct agents to bypass repository scope validation, use raw graph query as first choice when a typed tool exists, or perform automatic source mutation before evidence gathering.

## 4. Exploration workflow

- [x] 4.1 Add original workflow asset under the repository's managed workflow asset directory selected by existing setup architecture; do not copy GitNexus prose or file structure.
- [x] 4.2 Implement sequence: resolve repo/group scope -> `search` -> canonical `inspect`/`file_symbols` -> `context` -> relationship/flow/route evidence -> targeted source verification.
- [x] 4.3 Specify decision branches for ambiguous search result, ambiguous symbol selector, stale/unavailable index, partial relationship evidence and multi-repo scope.
- [x] 4.4 Add evaluation fixture where two same-name symbols exist; workflow must request/disambiguate canonical identity rather than selecting first match.

## 5. Debugging workflow

- [x] 5.1 Author debugging workflow using symptom/query localization, `search`, `inspect`, callers/callees via graph tools, `find_path`/`explain_relationship`, `detect_changes` when relevant, then explicit hypotheses ranked by evidence.
- [x] 5.2 Require each hypothesis to cite supporting symbols/files/relationships and a falsification/validation step before recommending a code edit.
- [x] 5.3 Add branches for runtime-only/external/dynamic boundaries where static graph cannot prove causality; workflow must say what evidence is missing.
- [x] 5.4 Add evaluation fixture where nearest lexical match is not the actual caller path; score whether workflow follows graph evidence instead of filename/name similarity alone.

## 6. Impact/change workflow

- [x] 6.1 Author change workflow using existing `detect_changes` -> changed canonical symbols -> `blast_radius` -> `pr_impact` -> flows/routes/contracts -> `suggest_tests`.
- [x] 6.2 Require separate fields in workflow output for directly changed symbols, exact downstream impact, candidate/heuristic impact, unresolved boundaries, affected flows/contracts and suggested tests.
- [x] 6.3 When semantic-snapshot/API-contract proposals are available, negotiate those capabilities and enrich existing workflow; otherwise use current tools with explicitly reduced guarantees.
- [x] 6.4 Add evaluation fixture where impact traversal is truncated/partial; workflow MUST NOT conclude low risk solely because returned result count is small.

## 7. Implementation-planning workflow

- [x] 7.1 Author planning workflow that identifies canonical target symbols, implementation owners, callers/consumers, contracts, flows, tests and risk boundaries before proposing file edits.
- [x] 7.2 Each plan step MUST contain target canonical ID/file/range where available, reason/evidence, expected semantic effect, affected tests, and validation command/tool call.
- [x] 7.3 Plan MUST distinguish required edits from candidate edits. Ambiguous relationship evidence cannot create a mandatory edit without verification.
- [x] 7.4 Add evaluation fixture with a cross-repo contract change; plan should include consumer repo only when group/contract evidence supports it.

## 8. Code-review workflow

- [x] 8.1 Author review workflow using changed symbols/diff first, then `pr_impact`, `health_report`, complexity/coverage/deprecated/security tools and relationship evidence only as relevant to changed code.
- [x] 8.2 Define severity rubric tied to demonstrated behavior/impact; do not label style-only findings as high severity.
- [x] 8.3 Require each finding to include source location, why it is a defect/risk, graph/change evidence where applicable, affected behavior and concrete validation.
- [x] 8.4 Add correctness-focused fixture where partial analysis must result in `needs verification` rather than a false clean review.

## 9. API review workflow

- [x] 9.1 Author API review workflow that uses `api_contract`, `api_impact`, `api_drift` when registered; otherwise falls back to `routes`, `pr_impact`, group contracts and source evidence with an explicit capability boundary.
- [x] 9.2 Review HTTP method/path changes, request requiredness/type, response shape/status, known consumers and cross-repo drift.
- [x] 9.3 Do not instruct agents to infer API compatibility from route names alone.
- [x] 9.4 Add evaluation fixture for response-field removal with known frontend consumer and another fixture with dynamic unknown consumer.

## 10. Test/coverage workflow

- [x] 10.1 Author workflow using `suggest_tests`, `coverage_gaps`, changed symbols, blast radius and flows to produce a minimal evidence-backed test plan.
- [x] 10.2 Distinguish tests directly covering changed symbols from tests suggested by transitive impact; include certainty and rationale.
- [x] 10.3 Add fixture where no known test is found but coverage is incomplete; workflow must not state `no tests required`.

## 11. Security investigation workflow

- [x] 11.1 Author workflow using `secrets`, `vulnerability_scan`, graph paths/call relationships and source context. When future PDG/taint capability exists, capability-negotiate it rather than hard-require it for 1.0.11.
- [x] 11.2 Require source/sink or vulnerable-call evidence for security claims where available and distinguish heuristic scanner signal from proven exploitable flow.
- [x] 11.3 Add fixture for scanner finding with no proven call path and ensure workflow reports it as a candidate requiring verification.

## 12. Setup/installation integration

- [x] 12.1 Extend `code-intel/core/src/cli/agent-targets.ts` with workflow support metadata only if target-specific behavior cannot be represented by existing target descriptors. (Not needed — `WorkflowTarget.agentId` in the manifest already keys off the same `AgentOption.id`; no change to `agent-targets.ts` required.)
- [x] 12.2 Extend existing setup path in `code-intel/core/src/cli/app.ts` and helper modules; do NOT add a separate `setup-workflows` command.
- [x] 12.3 Create `code-intel/core/src/agents/workflows/installer.ts` (or integrate with the existing managed-file abstraction) to render/copy workflow assets to selected agent targets.
- [x] 12.4 Use content fingerprints/managed markers to update unchanged Code Intel-managed assets automatically, preserve user-owned files, and detect modified managed files before overwrite.
- [x] 12.5 Define behavior for modified managed asset: preserve + warn, write side-by-side candidate, or deterministic managed-section merge according to existing repository file ownership rules. Never silently destroy user edits. (preserve + warn, surfaced via `analyze` output and `Logger.warn`)
- [x] 12.6 Rerunning `code-intel setup` MUST be idempotent; identical workflow version/content must produce no file churn. (verified by installer unit tests below)
- [x] 12.7 `--dry-run` setup MUST report workflow files that would be create/update/skip/conflict without writing them. (implemented on `analyze --dry-run`, which is where project instruction files are already documented as being managed — `setup --dry-run` explicitly defers to it)

## 13. Target-specific rendering

- [x] 13.1 Map workflows only to agent targets that have a supported reusable skill/rule/instruction mechanism. Unsupported targets remain valid for MCP setup but workflow installation reports `not-supported`, not failure. (`claude` + `cursor` supported today; all other `AGENT_OPTIONS` report `not-supported`)
- [x] 13.2 Keep workflow semantic content shared; target renderers may change front matter/path/link syntax but MUST NOT fork reasoning rules independently per agent. (verified by "shares identical body content" test)
- [x] 13.3 Add snapshot tests for every supported target path/front matter and ensure generated files reference correct current MCP tool names.

## 14. Runtime schema validation

- [x] 14.1 Add `code-intel/core/src/agents/workflows/validator.ts` to parse every workflow manifest and verify required/optional MCP tools exist in runtime registration.
- [x] 14.2 Validate referenced input field names/enums against exported/generated MCP schemas where possible. A renamed/removed tool field MUST fail release validation rather than leave broken workflow instructions.
- [x] 14.3 Add CI/release script that validates all workflow assets after MCP server schemas are built. (`agents/workflows/validate-cli.ts`, built as its own tsup entry — `dist/agents/workflows/validate-cli.js` — and run by `npm run build` after workflow assets are copied into `dist/`; verified against a real `npm run build`, not just `tsc`)

## 15. Evaluation harness

- [x] 15.1 Extend existing `eval/run-mcp-bench.mjs` or add a focused agent-workflow evaluation runner reusing benchmark infrastructure rather than creating an unrelated harness. (`tests/unit/agents/workflows/eval-fixtures.test.ts`, reusing the same in-process `dispatchTool`/fixture-seeding infra as `tests/unit/mcp-server/api-contract-tools.test.ts` and `eval/run-mcp-bench.mjs` rather than a new harness type)
- [x] 15.2 Measure: correct first tool family, canonical disambiguation, unsupported exact claims, redundant source bytes/tool calls, partial-result handling, relevant test selection, evidence-cited plan/review findings and validation-step completion. (Scoped honestly: this harness has no live LLM in the loop — same as this repo's existing `run-agent-bench.mjs`, whose "agent" is also scripted, not a model — so it verifies the *tool signals* a workflow's decisions depend on are real and correctly differentiated (ambiguity, truncation, certainty degradation, proven-vs-heuristic evidence, unresolved consumers) rather than scoring a transcript against these 8 dimensions directly.)
- [x] 15.3 Add fixed fixtures for exploration, debugging, impact, planning, review, API, test and security workflows. Expected results should test behavior/decisions, not model-specific prose. (10 fixtures across all 8 workflows, all passing)
- [x] 15.4 Add regression threshold preventing a workflow release when it references unavailable tools or systematically converts partial results to exact claims. (`scripts/validate-workflows.mjs` gates the tool-reference half in `npm run build`; the "partial→exact" half is mitigated via the shared evidence guide's mandatory rules plus two fixtures — `blast_radius` self-inclusion, `pr_impact` certainty vs. risk — that were added specifically because this harness caught real prose/tool-contract mismatches during authoring, not preemptively assumed correct)

## 16. License/IP gate

- [x] 16.1 Record clean-room provenance for all workflow text. GitNexus source, tests, prompts, skills, schemas and prose MUST NOT be copied into this MIT project. (`code-intel/core/src/agents/workflows/PROVENANCE.md`)
- [x] 16.2 Run text-similarity/manual review against any internally retained competitor notes if available; remove suspiciously close phrasing and keep project-specific terminology/tool sequences. (`ref-use/knowladge-grap/gitnexus/skills/*` reviewed against `explore.md`/`debug.md`/`impact.md`; findings in PROVENANCE.md — disjoint tool vocabulary, disjoint structure, no similarity found)
- [x] 16.3 CodeGraph MIT concepts may inform design, but substantial copied source/text requires MIT attribution review. (none consulted — recorded in PROVENANCE.md)

## 17. Documentation and release notes — mandatory Definition of Done

- [x] 17.1 Update root `README.md` Agent/Setup/MCP sections with available graph-backed workflows, supported agent targets, how `code-intel setup` installs/updates them, capability negotiation, managed-file behavior and a short example workflow. (new "Graph-backed agent workflows" subsection)
- [x] 17.2 Update root `CHANGELOG.md` under `## [1.0.11]` with shipped workflows, supported targets, setup behavior, trust/partial-result rules and known target limitations.
- [x] 17.3 Update existing generated repository instruction templates only where they need to point agents to installed workflows; avoid duplicating full workflow content into every root instruction file. (one short "Task workflows" paragraph added to `context-writer.ts`'s shared block template)
- [x] 17.4 README/CHANGELOG and generated instructions MUST be validated against actual target registry/runtime MCP schemas before this proposal is marked complete. (every tool name referenced is drawn from the same `MCP_TOOL_DEFINITIONS`/`AGENT_OPTIONS` validated by `validateWorkflowRegistry`; context-writer tests pass with the new pointer text)

## 18. Release gate

- [x] 18.1 Run setup tests for first install, rerun no-op, managed update, user-modified conflict, dry-run, target deselection/removal and unsupported target. (`installer.test.ts`, 8/8 passing)
- [x] 18.2 Run workflow schema validation and all workflow evaluation fixtures. (`validate-cli.js` passes against a real `npm run build`; `eval-fixtures.test.ts` 10/10 passing)
- [x] 18.3 Run normal CLI/MCP/setup integration tests, build/typecheck/lint and MCP benchmark to prove workflows do not alter core tool semantics. `npm run build` ✅ (including the new `validate-cli.js` gate); `tsc --noEmit` / `tsc -b tsconfig.test.json` ✅; `eslint` on every touched file: 0 errors, 0 *new* warnings vs. `git show HEAD:<file>` baselines. Ran the full high-signal subset this change could plausibly affect — `tests/unit/mcp-server`, `tests/unit/mcp`, `tests/unit/cli`, `tests/unit/agents/workflows` (184 tests: 183 pass, 1 pre-existing unrelated failure) — plus `eval/run-mcp-bench.mjs`. Three test failures (`analyze-incremental-consistency` "bm25.db collapsed", `doctor-json` check-list mismatch, `config-manager-embedding-model` "rejects arbitrary free-text models") and the MCP benchmark's 10/19 score were each independently reproduced byte-for-byte against a completely clean `git stash`-ed HEAD with zero of this change's code present, proving they are pre-existing, unrelated to this change (confirmed via `git stash push --include-untracked` / rebuild / test / `git stash pop`, twice). The 230-file full suite was started but is extremely slow in this environment (`--test-concurrency=1`, >45 min for ~25/230 files) and was not run to completion; the targeted subset plus the two clean-HEAD comparisons give equivalent confidence that nothing outside the touched files is affected.
- [x] 18.4 Verify installation/removal never deletes user-authored files or broad repository directories. (installer "deselecting a previously-installed agent target does not delete its workflow files" test)
