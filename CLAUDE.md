<!-- code-intel:start -->
# Code Intelligence — code-intel-platform

> ⚠ This section is auto-managed by `code-intel analyze`. Do **not** edit between the markers — your changes will be overwritten.
> Add your own notes below the `<!-- code-intel:end -->` marker.

Indexed: **5,047 nodes** | **9,000 edges** | **305 files** | analyzed in 1.0s

> Index stale? Re-run: `code-intel analyze`

## Always Do

- **Before editing any symbol**, run `code-intel impact <symbol>` to review its blast radius.
- **Before committing**, verify scope with `code-intel inspect <symbol>`.
- Use `code-intel search "<concept>"` to find related symbols instead of grepping.
- Warn the user if impact shows ≥ 5 direct callers (**HIGH risk**).

## Never Do

- NEVER rename symbols with find-and-replace — use `code-intel inspect` to find all usages first.
- NEVER ignore impact warnings — always report blast radius to the user.
- NEVER open a file cold — always `code-intel search` first.
- NEVER grep for symbols — use `code-intel search` instead.
- NEVER skip blast-radius check — run `code-intel impact <symbol>` before every edit.
- NEVER trace callers manually — use `code-intel inspect <symbol>` instead.
- NEVER write ad-hoc graph queries — use `code-intel query "<gql>"` instead.
- NEVER compute PR blast radius manually — use `code-intel pr-impact` instead.

## CLI Quick Reference

```bash
code-intel analyze [path]          # Build / refresh the knowledge graph
code-intel serve [path]            # Start HTTP API + Web UI on :4747
code-intel search <query>          # Text search across all symbols
code-intel inspect <symbol>        # Callers, callees, imports, cluster
code-intel impact <symbol>         # Blast radius (who breaks if this changes)
code-intel query "<gql>"           # Run a GQL query (FIND / TRAVERSE / PATH / COUNT)
code-intel pr-impact               # PR blast radius with risk scores + SARIF output
code-intel scan [path]             # OWASP + secret vulnerability scan
code-intel secrets [path]          # Hardcoded secret detection
code-intel complexity [path]       # Cyclomatic / cognitive complexity hotspots
code-intel coverage [path]         # Test coverage gaps sorted by blast radius
code-intel deprecated [path]       # Deprecated API usage report
code-intel health [path]           # Code health score (dead code, cycles, god nodes)
code-intel status [path]           # Index freshness and stats
code-intel clean [path]            # Remove index data
```

## rtk Quick Reference

> Use `rtk` wrappers instead of raw commands to minimize token usage.

```bash
rtk smart <cmd>            # 2-line heuristic summary of any command output
rtk read <file>            # Token-optimized file read with intelligent filtering
rtk tree [path]            # Directory tree with token-optimized output
rtk ls [path]              # Token-optimized directory listing
rtk git <args>             # Git commands with compact output
rtk test <cmd>             # Run tests, show only failures
rtk err <cmd>              # Run command, show only errors/warnings
rtk json <file>            # Compact JSON viewer (use --keys-only for schema)
rtk deps [path]            # Summarize project dependencies
```

| Instead of | Use |
|------------|-----|
| `git status` | `rtk git status` |
| `git diff` | `rtk git diff` |
| `git log` | `rtk git log` |
| `cat <file>` | `rtk read <file>` |
| `ls` / `find` | `rtk ls [path]` |
| `tree` | `rtk tree [path]` |
| `npm test` | `rtk test npm test` |
| `cat file.json` | `rtk json <file>` |

## Skills

| Task | Skill file |
|------|------------|
| Understand architecture / "How does X work?" | Load `code-intel-exploring` skill |
| Blast radius / "What breaks if I change X?" | Load `code-intel-impact` skill |
| Debugging / "Why is X failing?" | Load `code-intel-debugging` skill |
| Work in `auth` (84 symbols) | `.claude/skills/code-intel/auth/SKILL.md` |
| Work in `fixtures` (75 symbols) | `.claude/skills/code-intel/fixtures/SKILL.md` |
| Work in `query` (65 symbols) | `.claude/skills/code-intel/query/SKILL.md` |
| Work in `multi-repo` (41 symbols) | `.claude/skills/code-intel/multi-repo/SKILL.md` |
| Work in `modules` (40 symbols) | `.claude/skills/code-intel/modules/SKILL.md` |
| Work in `phases` (38 symbols) | `.claude/skills/code-intel/phases/SKILL.md` |
| Work in `panels` (38 symbols) | `.claude/skills/code-intel/panels/SKILL.md` |
| Work in `backup` (37 symbols) | `.claude/skills/code-intel/backup/SKILL.md` |
| Work in `cli` (36 symbols) | `.claude/skills/code-intel/cli/SKILL.md` |
| Work in `workers` (34 symbols) | `.claude/skills/code-intel/workers/SKILL.md` |
| Work in `storage` (33 symbols) | `.claude/skills/code-intel/storage/SKILL.md` |
| Work in `api` (32 symbols) | `.claude/skills/code-intel/api/SKILL.md` |
| Work in `shared` (31 symbols) | `.claude/skills/code-intel/shared/SKILL.md` |
| Work in `pipeline` (30 symbols) | `.claude/skills/code-intel/pipeline/SKILL.md` |
| Work in `eval` (29 symbols) | `.claude/skills/code-intel/eval/SKILL.md` |
| Work in `search` (28 symbols) | `.claude/skills/code-intel/search/SKILL.md` |
| Work in `multi-lang` (21 symbols) | `.claude/skills/code-intel/multi-lang/SKILL.md` |
| Work in `parsing` (20 symbols) | `.claude/skills/code-intel/parsing/SKILL.md` |
| Work in `pipeline` (20 symbols) | `.claude/skills/code-intel/pipeline-2/SKILL.md` |
| Work in `graph` (19 symbols) | `.claude/skills/code-intel/graph/SKILL.md` |

<!-- code-intel:end -->
