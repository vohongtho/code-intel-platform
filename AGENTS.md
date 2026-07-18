# Source Code
/home/thomas/working/other/code-intel-platform


# RULE
1. DO NOT USE SUB AGENT
2. Before run git add and git commit should get confirm from me
3. The message generate for git commit DO NOT CONTENT: 
    "Amp-Thread-ID:"
    "Co-authored-by: ***"
3. Before run git add, if change need to update into readme.md, Should update

## Tool Usage Rules (MANDATORY)

### code-intel — Always Investigate First (before reading any file)
```bash
code-intel search "<concept>"   # FIRST: find symbols by concept
code-intel inspect <symbol>     # callers, callees, file location
code-intel impact <symbol>      # blast radius BEFORE editing
```
- NEVER open a file cold — always `code-intel search` first.
- NEVER grep for symbols — use `code-intel search` instead.
- NEVER edit a symbol without running `code-intel impact` first.

### rtk — Use for compact shell output
```bash
rtk read <file>            # token-efficient file read
rtk grep <pattern> <file>  # compact grep
rtk git log                # compact git log
rtk test <cmd>             # show only failures
rtk err <cmd>              # show only errors/warnings
rtk diff                   # condensed diff
rtk smart <cmd>            # 2-line heuristic summary
```

<!-- code-intel:start -->
# Code Intelligence — code-intel-platform

> Auto-managed by `code-intel analyze` (v1.0.4) — re-running it overwrites this block. Put durable notes below `<!-- code-intel:end -->`.

`code-intel` keeps a symbol / call-graph index of this repo. It **complements** reading files, it doesn't replace it — on a repo this size, read files directly for most work and reach for code-intel when you need the call graph.

## Reach for it when you need
- **Blast radius before changing a shared symbol** — `code-intel impact <symbol>` (reverse call graph). Flag ≥ 5 direct callers to the user as higher-risk.
- **PR review scope** — `code-intel pr-impact --base master --head HEAD`
- **Callers / callees of a symbol** — `code-intel inspect <symbol>`
- **Concept search across files** — `code-intel search "<concept>"`
- **Tracing an execution path** — `code-intel query "TRAVERSE CALLS FROM '<symbol>' DEPTH 3"`

## CLI reference

```bash
code-intel search <query>            # find symbols by concept/name
code-intel inspect <symbol>          # callers, callees, imports
code-intel impact <symbol>           # blast radius (who breaks if this changes)
code-intel pr-impact --base master   # full PR blast radius
code-intel query "TRAVERSE CALLS FROM '<symbol>' DEPTH 3"
code-intel query "PATH FROM '<sym>' TO '<target>'"
code-intel analyze                   # rebuild the index (run when stale)
code-intel serve                     # HTTP API + web UI on :4747
```

Also available: `complexity`, `coverage`, `secrets`, `scan`, `deprecated`, `status`, `clean`.
<!-- code-intel:end -->
