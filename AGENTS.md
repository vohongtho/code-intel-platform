

# RULE
1. DO NOT USE SUB AGENT
2. Before run git add and git commit should get confirm from me
3. The message generate for git commit DO NOT CONTENT: 
    "Amp-Thread-ID:"
    "Co-authored-by: ***"
3. Before run git add, if change need to update into readme.md, Should update
<!-- code-intel:start -->
# Code Intelligence — code-intel-platform

> ⚠ This section is auto-managed by `code-intel analyze`. Do **not** edit between the markers — your changes will be overwritten.
> Add your own notes below the `<!-- code-intel:end -->` marker.

Indexed: **1,033 nodes** | **2,325 edges** | **205 files** | analyzed in 0.5s

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
| Work in `auth` (63 symbols) | `.claude/skills/code-intel/auth/SKILL.md` |
| Work in `multi-repo` (30 symbols) | `.claude/skills/code-intel/multi-repo/SKILL.md` |
| Work in `panels` (30 symbols) | `.claude/skills/code-intel/panels/SKILL.md` |
| Work in `cli` (25 symbols) | `.claude/skills/code-intel/cli/SKILL.md` |
| Work in `shared` (25 symbols) | `.claude/skills/code-intel/shared/SKILL.md` |
| Work in `eval` (25 symbols) | `.claude/skills/code-intel/eval/SKILL.md` |
| Work in `storage` (20 symbols) | `.claude/skills/code-intel/storage/SKILL.md` |
| Work in `backup` (17 symbols) | `.claude/skills/code-intel/backup/SKILL.md` |
| Work in `pages` (17 symbols) | `.claude/skills/code-intel/pages/SKILL.md` |
| Work in `phases` (16 symbols) | `.claude/skills/code-intel/phases/SKILL.md` |
| Work in `http` (14 symbols) | `.claude/skills/code-intel/http/SKILL.md` |
| Work in `shared` (14 symbols) | `.claude/skills/code-intel/shared-2/SKILL.md` |
| Work in `mcp-server` (13 symbols) | `.claude/skills/code-intel/mcp-server/SKILL.md` |
| Work in `java-repo` (13 symbols) | `.claude/skills/code-intel/java-repo/SKILL.md` |
| Work in `multi-lang` (13 symbols) | `.claude/skills/code-intel/multi-lang/SKILL.md` |
| Work in `pipeline` (12 symbols) | `.claude/skills/code-intel/pipeline/SKILL.md` |
| Work in `search` (12 symbols) | `.claude/skills/code-intel/search/SKILL.md` |
| Work in `http` (12 symbols) | `.claude/skills/code-intel/http-2/SKILL.md` |
| Work in `graph` (12 symbols) | `.claude/skills/code-intel/graph/SKILL.md` |
| Work in `src` (12 symbols) | `.claude/skills/code-intel/src/SKILL.md` |

<!-- code-intel:end -->
