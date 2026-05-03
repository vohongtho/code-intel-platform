# code-intel.md

<!-- code-intel:start -->
# Code Intelligence — code-intel-platform

> ⚠ This section is auto-managed by `code-intel analyze`. Do **not** edit between the markers — your changes will be overwritten.
> Add your own notes below the `<!-- code-intel:end -->` marker.

Indexed: **5,787 nodes** | **10,522 edges** | **322 files** | analyzed in 1.1s

> Index stale? Re-run: `code-intel analyze`

## Mandatory Rules — ALL Agents (Amp, Claude Code, Codex, Copilot, Cursor, Aider, Gemini, Kiro, Trae, Hermes, Factory, OpenCode, Pi, Antigravity, OpenClaw, and others)

These rules apply to **every coding agent or AI assistant** working in this repository.

### Before Implementing Any Change
1. Run `code-intel search "<concept>"` — find existing symbols related to the task.
2. Run `code-intel inspect <symbol>` — understand callers, callees, and imports.
3. Run `code-intel impact <symbol>` — check blast radius before touching anything.
4. **If impact shows ≥ 5 direct callers → warn the user: HIGH risk.**

### While Implementing / Fixing a Bug
- NEVER open a file cold — always `code-intel search` first.
- NEVER grep for symbols — use `code-intel search` instead.
- NEVER rename symbols with find-and-replace — use `code-intel inspect` to find all usages first.
- Use `code-intel inspect <symbol>` to understand a function's callers/callees before modifying it.
- Use `code-intel query "TRAVERSE CALLS FROM '<symbol>' DEPTH 3"` to trace execution paths.

### Before Committing / Code Review
- Run `code-intel impact <symbol>` for every symbol you changed.
- Run `code-intel pr-impact --base main --head HEAD` to see full PR blast radius.
- Fail PR if HIGH risk symbols are changed without reviewer sign-off.

### Studying the Codebase
- Use `code-intel search "<concept>"` to explore unfamiliar areas.
- Use `code-intel inspect <symbol>` to see a symbol's full context.
- Use `code-intel serve` to open the interactive Web UI for graph exploration.
- Use subsystem skills (see table below) for deep-dive on a specific area.

## Never Do

- NEVER ignore impact warnings — always report blast radius to the user.
- NEVER skip `code-intel search` before grepping or opening files.
- NEVER make changes to a symbol with ≥ 5 callers without running `code-intel impact` first.
- NEVER use find-and-replace for symbol renames.

## Development Workflow

### 🔧 Implement a New Feature
```
1. code-intel search "<feature concept>"      # find related existing symbols
2. code-intel inspect <related-symbol>        # understand context & callers
3. Load subsystem skill (see Skills table)    # deep-dive the area
4. Implement changes
5. code-intel impact <changed-symbol>         # verify blast radius
6. code-intel pr-impact --base main           # full PR summary before commit
```

### 🐛 Fix a Bug
```
1. code-intel search "<buggy behavior>"                              # locate the symbol
2. code-intel query "TRAVERSE CALLS FROM '<symbol>' DEPTH 3"        # trace execution path
3. code-intel inspect <symbol>                                       # find all callers that may be affected
4. Fix the bug
5. code-intel impact <symbol>                                        # confirm no unexpected side effects
```

### 🔬 Study / Understand Code
```
1. code-intel search "<concept>"                                     # discover entry points
2. code-intel inspect <symbol>                                       # full context: callers, callees, imports
3. code-intel query "TRAVERSE CALLS FROM '<symbol>' DEPTH 3"        # execution call graph
4. code-intel query "PATH FROM '<symbol>' TO '<target>'"            # path between two symbols
5. Load subsystem skill                                              # structured deep-dive
```

### 👀 Code Review
```
1. code-intel pr-impact --base main --head HEAD   # blast radius of all PR changes
2. code-intel impact <each-changed-symbol>         # per-symbol risk check
3. Flag HIGH risk (≥ 5 callers) for reviewer sign-off
```

### 🔄 Maintain / Refactor
```
1. code-intel inspect <symbol>                # find ALL usages before touching
2. code-intel impact <symbol>                 # blast radius — plan your changes
3. Make changes incrementally
4. code-intel pr-impact --base main           # validate scope hasn't exploded
```

## CLI Quick Reference

```bash
code-intel analyze [path]                                      # Build / refresh the knowledge graph
code-intel serve [path]                                        # Start HTTP API + Web UI on :4747
code-intel search <query>                                      # Find symbols by concept/name
code-intel inspect <symbol>                                    # Callers, callees, imports, cluster
code-intel impact <symbol>                                     # Blast radius (who breaks if this changes)
code-intel query "TRAVERSE CALLS FROM '<symbol>' DEPTH 3"     # Trace execution call graph
code-intel query "PATH FROM '<sym>' TO '<target>'"             # Find path between two symbols
code-intel query "FIND function WHERE name CONTAINS '<x>'"    # GQL symbol search
code-intel pr-impact --base main --head HEAD                   # Full PR blast radius report
code-intel complexity [path] --top 10                         # Cyclomatic complexity hotspots
code-intel coverage [path]                                     # Untested exported symbols by blast radius
code-intel secrets [path]                                      # Scan for hardcoded secrets
code-intel scan [path] --severity high                         # OWASP vulnerability scan
code-intel deprecated [path]                                   # Find deprecated API usages
code-intel status [path]                                       # Index freshness and stats
code-intel clean [path]                                        # Remove index data
```

## Skills

## When to Load a Skill

Before working deeply in a subsystem, **load the matching skill file** listed above.
Each skill gives you symbol maps, key entry points, and safe-change guidance for that area.

- Working in **cli**? → Load `.claude/skills/code-intel/cli/SKILL.md`
- Working in **auth**? → Load `.claude/skills/code-intel/auth/SKILL.md`
- Working in **graph**? → Load `.claude/skills/code-intel/graph/SKILL.md`
- Working in **fixtures**? → Load `.claude/skills/code-intel/fixtures/SKILL.md`
- Working in **query**? → Load `.claude/skills/code-intel/query/SKILL.md`
- Working in **multi-repo**? → Load `.claude/skills/code-intel/multi-repo/SKILL.md`
- Working in **modules**? → Load `.claude/skills/code-intel/modules/SKILL.md`
- Working in **search**? → Load `.claude/skills/code-intel/search/SKILL.md`
- Working in **phases**? → Load `.claude/skills/code-intel/phases/SKILL.md`
- Working in **panels**? → Load `.claude/skills/code-intel/panels/SKILL.md`
- Working in **backup**? → Load `.claude/skills/code-intel/backup/SKILL.md`
- Working in **workers**? → Load `.claude/skills/code-intel/workers/SKILL.md`
- Working in **api**? → Load `.claude/skills/code-intel/api/SKILL.md`
- Working in **storage**? → Load `.claude/skills/code-intel/storage/SKILL.md`
- Working in **shared**? → Load `.claude/skills/code-intel/shared/SKILL.md`
- Working in **pipeline**? → Load `.claude/skills/code-intel/pipeline/SKILL.md`
- Working in **eval**? → Load `.claude/skills/code-intel/eval/SKILL.md`
- Working in **pipeline**? → Load `.claude/skills/code-intel/pipeline-2/SKILL.md`
- Working in **src**? → Load `.claude/skills/code-intel/src/SKILL.md`
- Working in **multi-lang**? → Load `.claude/skills/code-intel/multi-lang/SKILL.md`

| Task | Skill file |
|------|------------|
| Understand architecture / "How does X work?" | Load `code-intel-exploring` skill |
| Blast radius / "What breaks if I change X?" | Load `code-intel-impact` skill |
| Debugging / "Why is X failing?" | Load `code-intel-debugging` skill |
| Work in `cli` (87 symbols) | `.claude/skills/code-intel/cli/SKILL.md` |
| Work in `auth` (85 symbols) | `.claude/skills/code-intel/auth/SKILL.md` |
| Work in `graph` (80 symbols) | `.claude/skills/code-intel/graph/SKILL.md` |
| Work in `fixtures` (75 symbols) | `.claude/skills/code-intel/fixtures/SKILL.md` |
| Work in `query` (65 symbols) | `.claude/skills/code-intel/query/SKILL.md` |
| Work in `multi-repo` (41 symbols) | `.claude/skills/code-intel/multi-repo/SKILL.md` |
| Work in `modules` (40 symbols) | `.claude/skills/code-intel/modules/SKILL.md` |
| Work in `search` (40 symbols) | `.claude/skills/code-intel/search/SKILL.md` |
| Work in `phases` (38 symbols) | `.claude/skills/code-intel/phases/SKILL.md` |
| Work in `panels` (38 symbols) | `.claude/skills/code-intel/panels/SKILL.md` |
| Work in `backup` (37 symbols) | `.claude/skills/code-intel/backup/SKILL.md` |
| Work in `workers` (34 symbols) | `.claude/skills/code-intel/workers/SKILL.md` |
| Work in `api` (34 symbols) | `.claude/skills/code-intel/api/SKILL.md` |
| Work in `storage` (33 symbols) | `.claude/skills/code-intel/storage/SKILL.md` |
| Work in `shared` (31 symbols) | `.claude/skills/code-intel/shared/SKILL.md` |
| Work in `pipeline` (30 symbols) | `.claude/skills/code-intel/pipeline/SKILL.md` |
| Work in `eval` (29 symbols) | `.claude/skills/code-intel/eval/SKILL.md` |
| Work in `pipeline` (26 symbols) | `.claude/skills/code-intel/pipeline-2/SKILL.md` |
| Work in `src` (26 symbols) | `.claude/skills/code-intel/src/SKILL.md` |
| Work in `multi-lang` (21 symbols) | `.claude/skills/code-intel/multi-lang/SKILL.md` |

<!-- code-intel:end -->

---

<!-- Add your own custom notes below this line. They will never be overwritten by code-intel. -->
