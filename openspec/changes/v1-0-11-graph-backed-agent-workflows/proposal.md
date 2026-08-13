# Proposal: Graph-Backed Agent Workflows

## Summary

Extend existing agent-target-aware setup with original, task-specific Code Intel workflow skills for exploration, debugging, impact analysis, implementation planning, review, API compatibility, testing, and security investigation.

## Baseline

The platform already detects/configures supported agent targets and exposes a broad MCP tool surface. The gap is workflow packaging: agents know that tools exist but are not consistently guided to select the right sequence, preserve trust boundaries, avoid repeated retrieval, and validate conclusions before code changes.

## User-visible problem

Two agents connected to the same MCP server may use radically different investigation quality. One may search text and edit immediately while another uses canonical inspection, graph impact, context, tests, and security evidence. Product capability is therefore underused and results are inconsistent.

## Goals

- Ship original Code Intel skills/playbooks for common engineering tasks.
- Install/update them through existing agent-target-aware setup rather than introducing a second setup system.
- Make workflows graph-first but evidence-aware: uncertain or partial results must trigger verification, not confident claims.
- Prefer existing MCP tools; do not create workflow-specific duplicate analysis tools.
- Include concise tool-selection rules, stop conditions, escalation to raw source reading, and validation steps.
- Version skills with the runtime/tool schema and preserve user-owned files/customizations.

## Initial workflows

- codebase exploration;
- debugging/root-cause investigation;
- change/blast-radius analysis;
- implementation planning;
- code review;
- API contract review;
- test selection/coverage investigation;
- security/vulnerability investigation.

## Non-goals

- Autonomous source mutation without user/agent control.
- Copying GitNexus prompts/skills or wording.
- Replacing MCP tool documentation.
- Requiring a specific commercial agent.

## Compatibility

Existing setup remains valid. Skill installation is additive and target-aware. Unsupported agents receive no fabricated integration. User-modified managed files follow the existing ownership/merge policy.

## Dependencies

Uses existing agent-target-aware setup. Benefits from canonical identity, relationship certainty, context evidence delivery, API contracts, and program-analysis features when available; each workflow must degrade gracefully when a capability is unavailable.

## License/IP

All skill prose, examples, fixtures, and workflow structure must be authored independently for Code Intel. Do not copy GitNexus noncommercial skill text or implementation expression.
