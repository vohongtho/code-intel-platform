# Provenance — graph-backed agent workflows

Recorded per `openspec/changes/v1-0-11-graph-backed-agent-workflows` tasks 16.1–16.3
(license/IP gate). This is a compliance record, not user-facing documentation.

## Clean-room statement

All prose in `assets/*.md`, and all code in this directory (`types.ts`, `registry.ts`,
`capabilities.ts`, `installer.ts`, `validator.ts`), was authored directly against this
project's own MCP tool schemas (`mcp-server/tool-definitions.ts`) and its own existing
setup/agent-target architecture (`cli/agent-targets.ts`, `cli/context-writer.ts`). No file
under `ref-use/knowladge-grap/gitnexus/` (a full checkout of the GitNexus project retained
elsewhere in this repository for reference) was read, opened, or consulted while authoring
any workflow asset or any file in this directory.

## Competitor-notes review (task 16.2)

`ref-use/knowladge-grap/gitnexus/skills/` contains GitNexus's own bundled skills
(`gitnexus-exploring.md`, `gitnexus-debugging.md`, `gitnexus-pr-review.md`,
`gitnexus-impact-analysis.md`, `gitnexus-refactoring.md`, `gitnexus-cli.md`,
`gitnexus-guide.md`) — internally-retained competitor material this repository happens to
have on disk. A manual text-similarity review was performed after this project's own
`explore.md`, `debug.md`, and `impact.md` were already written, comparing each against its
closest GitNexus counterpart (`gitnexus-exploring.md`, `gitnexus-debugging.md`,
`gitnexus-impact-analysis.md`). Findings:

- **Tool vocabulary is entirely disjoint.** GitNexus skills are written around
  `gitnexus_query`, `gitnexus_context`, `gitnexus_impact`, `gitnexus_cypher`,
  `gitnexus_detect_changes`, and `gitnexus://repo/{name}/...` MCP resource URIs — none of
  which exist in this project. This project's workflows are written around this project's
  own registered tool names (`search`, `inspect`, `context`, `blast_radius`, `pr_impact`,
  `find_path`, `explain_relationship`, etc. — see `registry.ts`), which cannot overlap in
  expression by construction.
- **Document structure is different.** GitNexus skills use a fixed
  When to Use → Workflow (numbered pseudo-code) → Checklist → a domain-specific table
  (Resources / Debugging Patterns / Risk Assessment) → Tools (with fabricated sample
  tool-call output) → a single worked "Example" transcript shape. This project's workflows
  use When to use → Tool sequence → Decision branches → Output shape, with no fabricated
  example transcripts and no resource-URI table (this project's MCP surface has no
  equivalent `gitnexus://` resource scheme).
- **The central design idea of this change is absent from GitNexus's skills.** GitNexus's
  `gitnexus-impact-analysis.md` reports flat, unconditional risk thresholds by raw symbol
  count (`<5 symbols → LOW`, `5-15 → MEDIUM`, `>15 → HIGH`) with no truncation/coverage
  caveat and no distinction between proven and candidate impact. This project's `impact.md`
  is built around the opposite requirement — the spec's "Workflows MUST preserve
  uncertainty" — explicitly forbidding exactly the flat-threshold reasoning GitNexus's skill
  uses, and requiring separate *exact* vs. *candidate/heuristic* impact fields plus an
  *unresolved boundaries* field GitNexus has no equivalent of. Similarly, GitNexus's
  debugging skill has no ranked-hypothesis-with-falsification-step requirement and no
  runtime/dynamic-boundary decision branch — both are original to this project's `debug.md`.
- No sentence-level or structural phrasing was found close enough to warrant rewriting.

This review was a targeted manual comparison against the workflows judged most likely to
overlap (exploration, debugging, impact analysis), not an exhaustive pass over all 7
GitNexus skill files — the pattern held consistently enough (disjoint tool vocabulary,
disjoint structure, and this project's uncertainty/evidence framework being GitNexus's most
notable omission) that the remaining GitNexus skills (`pr-review`, `refactoring`, `cli`,
`guide`) were judged low-risk by the same reasoning and were not individually diffed.

## CodeGraph (task 16.3)

No CodeGraph (MIT-licensed) source or text was consulted, referenced, or copied while
authoring any part of this change. If CodeGraph concepts inform a future revision of these
workflows, an MIT attribution review must happen at that time — none is owed for this
change.
