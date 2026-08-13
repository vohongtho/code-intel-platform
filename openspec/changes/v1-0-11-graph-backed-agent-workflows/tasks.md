# Tasks: Graph-Backed Agent Workflows

## 1. Baseline inventory

- [ ] 1.1 Inspect `code-intel/core/src/cli/agent-targets.ts`, `code-intel/core/src/cli/context-writer.ts`, `code-intel/core/src/cli/hook-rewriter.ts`, `code-intel/core/src/cli/init-wizard.ts`, `code-intel/core/src/cli/app.ts`, existing setup implementation, repository-generated agent files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/code-intel.mdc`, `.kiro/steering/code-intel.md`, `.clinerules`, `.windsurfrules`, `.kilocode/rules/*`, `.agents/rules/*`), and `code-intel/core/src/mcp-server/server.ts`.
- [ ] 1.2 Inventory current bundled `.claude/skills/code-intel/*` assets and classify them as module/reference documentation versus end-user engineering workflows. Do not duplicate an existing workflow under a new name.
- [ ] 1.3 Record ownership/rewrite markers used by setup/context writers so workflow installation can distinguish Code Intel-managed content from user-authored content.
- [ ] 1.4 Generate a machine-readable inventory of production MCP tool names and input/output schema fields from the same source used by `mcp-server/server.ts`; workflow validation MUST not rely on a handwritten stale list.

## 2. Workflow manifest and versioning

- [ ] 2.1 Create `code-intel/core/src/agents/workflows/types.ts` defining `WorkflowId`, `WorkflowManifest`, `WorkflowCapabilityRequirement`, `WorkflowTarget`, `ManagedWorkflowAsset`, and version/fingerprint metadata.
- [ ] 2.2 Create `code-intel/core/src/agents/workflows/registry.ts` with stable IDs for `explore`, `debug`, `impact`, `plan`, `review`, `api-review`, `test-coverage`, and `security-investigation`.
- [ ] 2.3 Each workflow manifest MUST declare required MCP tools, optional tools, minimum capability/version, fallback behavior, target-agent support, asset path, and content fingerprint.
- [ ] 2.4 Create `code-intel/core/src/agents/workflows/capabilities.ts` that resolves runtime capabilities from actual MCP schema/tool registration. Unsupported optional capability MUST downgrade a workflow step explicitly, not invent a tool call.

## 3. Shared evidence rules

- [ ] 3.1 Create an original shared workflow evidence guide asset owned by this project. It MUST require canonical symbol selectors when available, source/relationship evidence for claims, certainty/coverage propagation, and explicit partial/truncated boundaries.
- [ ] 3.2 Define a common rule: `0 callers`, `0 impact`, `no consumer`, `safe`, or `unused` may only be stated as exact when the corresponding tool reports complete/exact coverage.
- [ ] 3.3 Define common source-reading rule: use Code Intel context/inspect evidence first, then targeted raw source verification only for unresolved/answer-bearing areas; avoid repeatedly reading whole files already delivered.
- [ ] 3.4 Workflow assets MUST never instruct agents to bypass repository scope validation, use raw graph query as first choice when a typed tool exists, or perform automatic source mutation before evidence gathering.

## 4. Exploration workflow

- [ ] 4.1 Add original workflow asset under the repository's managed workflow asset directory selected by existing setup architecture; do not copy GitNexus prose or file structure.
- [ ] 4.2 Implement sequence: resolve repo/group scope -> `search` -> canonical `inspect`/`file_symbols` -> `context` -> relationship/flow/route evidence -> targeted source verification.
- [ ] 4.3 Specify decision branches for ambiguous search result, ambiguous symbol selector, stale/unavailable index, partial relationship evidence and multi-repo scope.
- [ ] 4.4 Add evaluation fixture where two same-name symbols exist; workflow must request/disambiguate canonical identity rather than selecting first match.

## 5. Debugging workflow

- [ ] 5.1 Author debugging workflow using symptom/query localization, `search`, `inspect`, callers/callees via graph tools, `find_path`/`explain_relationship`, `detect_changes` when relevant, then explicit hypotheses ranked by evidence.
- [ ] 5.2 Require each hypothesis to cite supporting symbols/files/relationships and a falsification/validation step before recommending a code edit.
- [ ] 5.3 Add branches for runtime-only/external/dynamic boundaries where static graph cannot prove causality; workflow must say what evidence is missing.
- [ ] 5.4 Add evaluation fixture where nearest lexical match is not the actual caller path; score whether workflow follows graph evidence instead of filename/name similarity alone.

## 6. Impact/change workflow

- [ ] 6.1 Author change workflow using existing `detect_changes` -> changed canonical symbols -> `blast_radius` -> `pr_impact` -> flows/routes/contracts -> `suggest_tests`.
- [ ] 6.2 Require separate fields in workflow output for directly changed symbols, exact downstream impact, candidate/heuristic impact, unresolved boundaries, affected flows/contracts and suggested tests.
- [ ] 6.3 When semantic-snapshot/API-contract proposals are available, negotiate those capabilities and enrich existing workflow; otherwise use current tools with explicitly reduced guarantees.
- [ ] 6.4 Add evaluation fixture where impact traversal is truncated/partial; workflow MUST NOT conclude low risk solely because returned result count is small.

## 7. Implementation-planning workflow

- [ ] 7.1 Author planning workflow that identifies canonical target symbols, implementation owners, callers/consumers, contracts, flows, tests and risk boundaries before proposing file edits.
- [ ] 7.2 Each plan step MUST contain target canonical ID/file/range where available, reason/evidence, expected semantic effect, affected tests, and validation command/tool call.
- [ ] 7.3 Plan MUST distinguish required edits from candidate edits. Ambiguous relationship evidence cannot create a mandatory edit without verification.
- [ ] 7.4 Add evaluation fixture with a cross-repo contract change; plan should include consumer repo only when group/contract evidence supports it.

## 8. Code-review workflow

- [ ] 8.1 Author review workflow using changed symbols/diff first, then `pr_impact`, `health_report`, complexity/coverage/deprecated/security tools and relationship evidence only as relevant to changed code.
- [ ] 8.2 Define severity rubric tied to demonstrated behavior/impact; do not label style-only findings as high severity.
- [ ] 8.3 Require each finding to include source location, why it is a defect/risk, graph/change evidence where applicable, affected behavior and concrete validation.
- [ ] 8.4 Add correctness-focused fixture where partial analysis must result in `needs verification` rather than a false clean review.

## 9. API review workflow

- [ ] 9.1 Author API review workflow that uses `api_contract`, `api_impact`, `api_drift` when registered; otherwise falls back to `routes`, `pr_impact`, group contracts and source evidence with an explicit capability boundary.
- [ ] 9.2 Review HTTP method/path changes, request requiredness/type, response shape/status, known consumers and cross-repo drift.
- [ ] 9.3 Do not instruct agents to infer API compatibility from route names alone.
- [ ] 9.4 Add evaluation fixture for response-field removal with known frontend consumer and another fixture with dynamic unknown consumer.

## 10. Test/coverage workflow

- [ ] 10.1 Author workflow using `suggest_tests`, `coverage_gaps`, changed symbols, blast radius and flows to produce a minimal evidence-backed test plan.
- [ ] 10.2 Distinguish tests directly covering changed symbols from tests suggested by transitive impact; include certainty and rationale.
- [ ] 10.3 Add fixture where no known test is found but coverage is incomplete; workflow must not state `no tests required`.

## 11. Security investigation workflow

- [ ] 11.1 Author workflow using `secrets`, `vulnerability_scan`, graph paths/call relationships and source context. When future PDG/taint capability exists, capability-negotiate it rather than hard-require it for 1.0.11.
- [ ] 11.2 Require source/sink or vulnerable-call evidence for security claims where available and distinguish heuristic scanner signal from proven exploitable flow.
- [ ] 11.3 Add fixture for scanner finding with no proven call path and ensure workflow reports it as a candidate requiring verification.

## 12. Setup/installation integration

- [ ] 12.1 Extend `code-intel/core/src/cli/agent-targets.ts` with workflow support metadata only if target-specific behavior cannot be represented by existing target descriptors.
- [ ] 12.2 Extend existing setup path in `code-intel/core/src/cli/app.ts` and helper modules; do NOT add a separate `setup-workflows` command.
- [ ] 12.3 Create `code-intel/core/src/agents/workflows/installer.ts` (or integrate with the existing managed-file abstraction) to render/copy workflow assets to selected agent targets.
- [ ] 12.4 Use content fingerprints/managed markers to update unchanged Code Intel-managed assets automatically, preserve user-owned files, and detect modified managed files before overwrite.
- [ ] 12.5 Define behavior for modified managed asset: preserve + warn, write side-by-side candidate, or deterministic managed-section merge according to existing repository file ownership rules. Never silently destroy user edits.
- [ ] 12.6 Rerunning `code-intel setup` MUST be idempotent; identical workflow version/content must produce no file churn.
- [ ] 12.7 `--dry-run` setup MUST report workflow files that would be create/update/skip/conflict without writing them.

## 13. Target-specific rendering

- [ ] 13.1 Map workflows only to agent targets that have a supported reusable skill/rule/instruction mechanism. Unsupported targets remain valid for MCP setup but workflow installation reports `not-supported`, not failure.
- [ ] 13.2 Keep workflow semantic content shared; target renderers may change front matter/path/link syntax but MUST NOT fork reasoning rules independently per agent.
- [ ] 13.3 Add snapshot tests for every supported target path/front matter and ensure generated files reference correct current MCP tool names.

## 14. Runtime schema validation

- [ ] 14.1 Add `code-intel/core/src/agents/workflows/validator.ts` to parse every workflow manifest and verify required/optional MCP tools exist in runtime registration.
- [ ] 14.2 Validate referenced input field names/enums against exported/generated MCP schemas where possible. A renamed/removed tool field MUST fail release validation rather than leave broken workflow instructions.
- [ ] 14.3 Add CI/release script that validates all workflow assets after MCP server schemas are built.

## 15. Evaluation harness

- [ ] 15.1 Extend existing `eval/run-mcp-bench.mjs` or add a focused agent-workflow evaluation runner reusing benchmark infrastructure rather than creating an unrelated harness.
- [ ] 15.2 Measure: correct first tool family, canonical disambiguation, unsupported exact claims, redundant source bytes/tool calls, partial-result handling, relevant test selection, evidence-cited plan/review findings and validation-step completion.
- [ ] 15.3 Add fixed fixtures for exploration, debugging, impact, planning, review, API, test and security workflows. Expected results should test behavior/decisions, not model-specific prose.
- [ ] 15.4 Add regression threshold preventing a workflow release when it references unavailable tools or systematically converts partial results to exact claims.

## 16. License/IP gate

- [ ] 16.1 Record clean-room provenance for all workflow text. GitNexus source, tests, prompts, skills, schemas and prose MUST NOT be copied into this MIT project.
- [ ] 16.2 Run text-similarity/manual review against any internally retained competitor notes if available; remove suspiciously close phrasing and keep project-specific terminology/tool sequences.
- [ ] 16.3 CodeGraph MIT concepts may inform design, but substantial copied source/text requires MIT attribution review.

## 17. Documentation and release notes — mandatory Definition of Done

- [ ] 17.1 Update root `README.md` Agent/Setup/MCP sections with available graph-backed workflows, supported agent targets, how `code-intel setup` installs/updates them, capability negotiation, managed-file behavior and a short example workflow.
- [ ] 17.2 Update root `CHANGELOG.md` under `## [1.0.11]` with shipped workflows, supported targets, setup behavior, trust/partial-result rules and known target limitations.
- [ ] 17.3 Update existing generated repository instruction templates only where they need to point agents to installed workflows; avoid duplicating full workflow content into every root instruction file.
- [ ] 17.4 README/CHANGELOG and generated instructions MUST be validated against actual target registry/runtime MCP schemas before this proposal is marked complete.

## 18. Release gate

- [ ] 18.1 Run setup tests for first install, rerun no-op, managed update, user-modified conflict, dry-run, target deselection/removal and unsupported target.
- [ ] 18.2 Run workflow schema validation and all workflow evaluation fixtures.
- [ ] 18.3 Run normal CLI/MCP/setup integration tests, build/typecheck/lint and MCP benchmark to prove workflows do not alter core tool semantics.
- [ ] 18.4 Verify installation/removal never deletes user-authored files or broad repository directories.
