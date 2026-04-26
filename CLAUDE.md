<!-- code-intel:start -->
# Code Intelligence — code-intel-platform

Indexed: **669 nodes** | **1,274 edges** | **151 files** | analyzed in 0.2s

> If the index is stale, re-run: `code-intel analyze`

## Always Do

- **Before editing any symbol**, run `code-intel impact <symbol>` and review blast radius.
- **Before committing**, verify scope with `code-intel inspect <symbol>`.
- Use `code-intel search "<concept>"` to find related symbols instead of grepping.
- Warn the user if impact shows ≥ 5 direct callers (HIGH risk).

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
| Work in `multi-repo` (30 symbols) | `.claude/skills/code-intel/multi-repo/SKILL.md` |
| Work in `panels` (30 symbols) | `.claude/skills/code-intel/panels/SKILL.md` |
| Work in `eval` (25 symbols) | `.claude/skills/code-intel/eval/SKILL.md` |
| Work in `storage` (20 symbols) | `.claude/skills/code-intel/storage/SKILL.md` |
| Work in `cli` (15 symbols) | `.claude/skills/code-intel/cli/SKILL.md` |
| Work in `pages` (13 symbols) | `.claude/skills/code-intel/pages/SKILL.md` |
| Work in `java-repo` (13 symbols) | `.claude/skills/code-intel/java-repo/SKILL.md` |
| Work in `multi-lang` (13 symbols) | `.claude/skills/code-intel/multi-lang/SKILL.md` |
| Work in `phases` (12 symbols) | `.claude/skills/code-intel/phases/SKILL.md` |
| Work in `search` (12 symbols) | `.claude/skills/code-intel/search/SKILL.md` |
| Work in `shared` (12 symbols) | `.claude/skills/code-intel/shared/SKILL.md` |
| Work in `src` (12 symbols) | `.claude/skills/code-intel/src/SKILL.md` |
| Work in `pipeline` (10 symbols) | `.claude/skills/code-intel/pipeline/SKILL.md` |
| Work in `go-repo` (10 symbols) | `.claude/skills/code-intel/go-repo/SKILL.md` |
| Work in `graph` (9 symbols) | `.claude/skills/code-intel/graph/SKILL.md` |
| Work in `state` (9 symbols) | `.claude/skills/code-intel/state/SKILL.md` |
| Work in `inheritance` (8 symbols) | `.claude/skills/code-intel/inheritance/SKILL.md` |
| Work in `mcp-server` (7 symbols) | `.claude/skills/code-intel/mcp-server/SKILL.md` |
| Work in `parsing` (7 symbols) | `.claude/skills/code-intel/parsing/SKILL.md` |
| Work in `shared` (7 symbols) | `.claude/skills/code-intel/shared-2/SKILL.md` |

<!-- code-intel:end -->
