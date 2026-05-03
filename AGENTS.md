

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

Indexed: **5,048 nodes** | **9,003 edges** | **305 files** | analyzed in 1.0s

> Index stale? Re-run: `code-intel analyze`

---

## 🔄 Dev Workflows

Use these step-by-step workflows for every development task. Follow them in order.

### Implementing a new feature

1. `code-intel search "<feature concept>"` — find related symbols and entry points
2. `code-intel inspect <key_symbol>` — understand callers, callees, heritage, cluster
3. `code-intel impact <symbol_to_change>` — check blast radius before touching anything
4. `code-intel query "TRAVERSE CALLS FROM '<entry_point>' DEPTH 3"` — trace call chain
5. *(MCP)* `cluster_summary` on the target cluster — understand purpose + dependencies
6. *(MCP)* `explain_relationship from=<A> to=<B>` — understand how two modules connect
7. After implementation: `code-intel coverage` — identify untested exported symbols
8. *(MCP)* `suggest_tests symbol=<new_symbol>` — get boundary test suggestions

### Fixing a bug

1. `code-intel inspect <buggy_symbol>` — see all callers and where it is called from
2. `code-intel query "TRAVERSE CALLS FROM '<buggy_symbol>' DEPTH 5"` — full call graph
3. `code-intel query "PATH FROM '<entry_point>' TO '<buggy_symbol>'"` — shortest path
4. *(MCP)* `explain_relationship from=<caller> to=<buggy_symbol>` — why these are connected
5. `code-intel impact <buggy_symbol>` — know what else breaks before making the fix
6. *(MCP)* `similar_symbols symbol=<buggy_symbol>` — find similar implementations to compare
7. After fix: `code-intel health` — confirm no new dead code or cycles introduced

### Refactoring / renaming

1. `code-intel inspect <symbol>` — get ALL usages before touching anything
2. `code-intel impact <symbol>` — blast radius; STOP and warn user if ≥ 5 callers
3. `code-intel query "FIND * WHERE name CONTAINS '<old_name>'"` — catch all variants
4. *(MCP)* `similar_symbols symbol=<symbol>` — find duplicates to consolidate
5. After refactor: `code-intel health` — check for new dead code or orphan files

### Code review / before PR

1. `code-intel pr-impact --base main --head HEAD --fail-on HIGH` — full blast radius with risk scores
2. `code-intel scan` — OWASP vulnerabilities (SQL injection, XSS, SSRF, path traversal, command injection)
3. `code-intel secrets` — hardcoded API keys, tokens, DB passwords
4. `code-intel coverage` — untested exported symbols sorted by risk
5. `code-intel deprecated` — usage of deprecated APIs
6. `code-intel health` — dead code, cycles, god nodes — confirm score did not drop
7. `code-intel complexity --top 10` — flag newly complex functions

### Exploring an unfamiliar codebase

1. *(MCP)* `overview` — total nodes/edges, kind breakdown, health score
2. `code-intel search "<domain concept>"` — find entry points by concept
3. *(MCP)* `clusters` — understand directory-based community structure
4. *(MCP)* `cluster_summary cluster=<name>` — key symbols, deps, dependents, purpose
5. *(MCP)* `flows` — list all detected execution flows and entry points
6. `code-intel query "COUNT function GROUP BY cluster"` — symbol distribution
7. `code-intel health` — quick code quality overview

---

## Always Do

- **Before editing any symbol**, run `code-intel impact <symbol>` to review its blast radius.
- **Before committing**, run `code-intel pr-impact`, `code-intel scan`, `code-intel secrets`.
- Use `code-intel search "<concept>"` to find related symbols instead of grepping.
- Warn the user if impact shows ≥ 5 direct callers (**HIGH risk**).
- Use MCP `suggest_tests` after implementing any new exported function.
- Use MCP `cluster_summary` before modifying a cluster you are unfamiliar with.

## Never Do

- NEVER rename symbols with find-and-replace — use `code-intel inspect` to find all usages first.
- NEVER ignore impact warnings — always report blast radius to the user.
- NEVER open a file cold — always `code-intel search` first.
- NEVER grep for symbols — use `code-intel search` instead.
- NEVER skip blast-radius check — run `code-intel impact <symbol>` before every edit.
- NEVER trace callers manually — use `code-intel inspect <symbol>` instead.
- NEVER write ad-hoc graph queries — use `code-intel query "<gql>"` instead.
- NEVER compute PR blast radius manually — use `code-intel pr-impact` instead.
- NEVER skip security checks before a PR — always run `code-intel scan` and `code-intel secrets`.
- NEVER ignore health regression — run `code-intel health` after every refactor.

---

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

## MCP Tools Quick Reference

> For AI agents using MCP (Claude Code, Cursor, Copilot, Codex, Gemini CLI, AMP, OpenCode).

| When you need to… | Use this MCP tool |
|-------------------|-------------------|
| Understand codebase shape + health | `overview` |
| Find symbols by concept | `search { query }` |
| See all callers/callees/imports of a symbol | `inspect { symbol_name }` |
| Know what breaks if you change X | `blast_radius { target }` |
| Find shortest path between two symbols | `find_path { from, to }` |
| Understand why two modules are connected | `explain_relationship { from, to }` |
| Assess PR/diff risk before merging | `pr_impact { changedFiles }` |
| Find similar / duplicate implementations | `similar_symbols { symbol }` |
| Get test suggestions for a symbol | `suggest_tests { symbol }` |
| Understand a cluster's purpose + deps | `cluster_summary { cluster }` |
| Get health signals for a directory | `health_report { scope }` |
| Find hardcoded secrets | `secrets { scope }` |
| Find OWASP vulnerabilities | `vulnerability_scan { scope }` |
| Find untested exported symbols | `coverage_gaps { scope }` |
| Find overly complex functions | `complexity_hotspots { scope }` |
| Find deprecated API usages | `deprecated_usage` |
| Run arbitrary graph query | `query { gql }` |
| List all public API exports | `list_exports` |
| List HTTP routes | `routes` |
| List execution flows | `flows` |
| List code clusters | `clusters` |

## GQL Query Examples

```
FIND function WHERE name CONTAINS "auth"
FIND * WHERE kind IN [function, method] AND exported = true LIMIT 50
TRAVERSE CALLS FROM "handleLogin" DEPTH 3
PATH FROM "createUser" TO "sendEmail"
COUNT function GROUP BY cluster
FIND function WHERE filePath CONTAINS "src/api"
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
