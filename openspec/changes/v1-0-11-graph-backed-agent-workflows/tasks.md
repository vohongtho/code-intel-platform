# Tasks: Graph-Backed Agent Workflows

- [ ] 1. Inventory existing agent target registry, setup-generated files, ownership/rewrite rules, MCP tool schemas, and current bundled agent instructions.
- [ ] 2. Define workflow asset metadata, versioning, capability requirements, content fingerprints, and supported-target mapping.
- [ ] 3. Add shared evidence/trust rules used by every workflow without duplicating tool implementation logic.
- [ ] 4. Author original exploration workflow using search -> canonical inspect -> context/graph evidence -> targeted source verification.
- [ ] 5. Author debugging workflow using symptom localization, callers/callees/paths, change context, hypothesis evidence, and validation.
- [ ] 6. Author impact/change workflow using `detect_changes`, `blast_radius`, `pr_impact`, flows, suggested tests, and explicit partial-result handling.
- [ ] 7. Author implementation-planning workflow that cites canonical targets, affected dependencies, tests, and uncertainty before proposing edits.
- [ ] 8. Author code-review workflow using changed symbols, impact, quality/security/test evidence, and deterministic severity guidance.
- [ ] 9. Author API-review workflow using API contract tools when available and routes/general impact fallback with reduced guarantees otherwise.
- [ ] 10. Author test/coverage and security investigation workflows using existing specialized tools and later PDG/taint capability negotiation.
- [ ] 11. Integrate workflow installation/update into existing agent-target-aware setup; do not introduce a parallel setup command.
- [ ] 12. Preserve user-owned/customized target files and add clear managed-asset update behavior.
- [ ] 13. Add release validation that every referenced MCP tool/field exists in generated runtime schemas.
- [ ] 14. Add setup rerun/update/remove tests for each supported agent target and unsupported-target no-op behavior.
- [ ] 15. Add workflow evaluation fixtures measuring tool selection, redundant source retrieval, unsupported exact claims, and validation-step completion.
- [ ] 16. Add license review gate confirming no GitNexus skill text/source was copied.
