<!-- code-intel:start -->
# Code Intelligence — code-intel-platform

> ⚠ This section is auto-managed by `code-intel analyze`. Do **not** edit between the markers — your changes will be overwritten.
> Add your own notes below the `<!-- code-intel:end -->` marker.

Indexed: **4,634 nodes** | **8,312 edges** | **281 files** | analyzed in 2.0s

> Index stale? Re-run: `code-intel analyze`

## Always Do

- **Before editing any symbol**, run `code-intel impact <symbol>` to review its blast radius.
- **Before committing**, verify scope with `code-intel inspect <symbol>`.
- Use `code-intel search "<concept>"` to find related symbols instead of grepping.
- Warn the user if impact shows ≥ 5 direct callers (**HIGH risk**).

## Never Do

- NEVER rename symbols with find-and-replace — use `code-intel inspect` to find all usages first.
- NEVER ignore impact warnings — always report blast radius to the user.

## CLI Quick Reference

```bash
code-intel analyze [path]          # Build / refresh the knowledge graph
code-intel serve [path]            # Start HTTP API + Web UI on :4747
code-intel search <query>          # Text search across all symbols
code-intel inspect <symbol>        # Callers, callees, imports, cluster
code-intel impact <symbol>         # Blast radius (who breaks if this changes)
code-intel status [path]           # Index freshness and stats
code-intel clean [path]            # Remove index data
```

## Skills

| Task | Skill file |
|------|------------|
| Understand architecture / "How does X work?" | Load `code-intel-exploring` skill |
| Blast radius / "What breaks if I change X?" | Load `code-intel-impact` skill |
| Debugging / "Why is X failing?" | Load `code-intel-debugging` skill |
| Work in `auth` (84 symbols) | `.claude/skills/code-intel/auth/SKILL.md` |
| Work in `fixtures` (75 symbols) | `.claude/skills/code-intel/fixtures/SKILL.md` |
| Work in `query` (65 symbols) | `.claude/skills/code-intel/query/SKILL.md` |
| Work in `modules` (40 symbols) | `.claude/skills/code-intel/modules/SKILL.md` |
| Work in `phases` (38 symbols) | `.claude/skills/code-intel/phases/SKILL.md` |
| Work in `backup` (37 symbols) | `.claude/skills/code-intel/backup/SKILL.md` |
| Work in `workers` (34 symbols) | `.claude/skills/code-intel/workers/SKILL.md` |
| Work in `storage` (33 symbols) | `.claude/skills/code-intel/storage/SKILL.md` |
| Work in `shared` (31 symbols) | `.claude/skills/code-intel/shared/SKILL.md` |
| Work in `api` (31 symbols) | `.claude/skills/code-intel/api/SKILL.md` |
| Work in `panels` (31 symbols) | `.claude/skills/code-intel/panels/SKILL.md` |
| Work in `multi-repo` (30 symbols) | `.claude/skills/code-intel/multi-repo/SKILL.md` |
| Work in `pipeline` (30 symbols) | `.claude/skills/code-intel/pipeline/SKILL.md` |
| Work in `eval` (29 symbols) | `.claude/skills/code-intel/eval/SKILL.md` |
| Work in `search` (28 symbols) | `.claude/skills/code-intel/search/SKILL.md` |
| Work in `cli` (23 symbols) | `.claude/skills/code-intel/cli/SKILL.md` |
| Work in `multi-lang` (21 symbols) | `.claude/skills/code-intel/multi-lang/SKILL.md` |
| Work in `parsing` (20 symbols) | `.claude/skills/code-intel/parsing/SKILL.md` |
| Work in `pipeline` (20 symbols) | `.claude/skills/code-intel/pipeline-2/SKILL.md` |
| Work in `graph` (19 symbols) | `.claude/skills/code-intel/graph/SKILL.md` |

<!-- code-intel:end -->
