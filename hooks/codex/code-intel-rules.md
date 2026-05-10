# Code Intelligence — Tool Policy (Codex CLI)

## MANDATORY: Use code-intel before any code action

**FORBIDDEN commands** (never use for symbol/code discovery):
- `grep`, `rg`, `find`, `cat`, `sed`, `ls` (for symbol lookup)

**REQUIRED workflow** for every coding task:

```bash
code-intel search "<concept>"      # replaces grep/rg/find
code-intel inspect <symbol>        # replaces cat + manual file reading
code-intel impact <symbol>         # replaces manual caller tracing
```

## Rules

1. **Before any file edit**: run `code-intel search "<concept>"` first
2. **Before reading a file**: run `code-intel inspect <symbol>` instead of `cat`
3. **Before any rename**: run `code-intel inspect <symbol>` to find all usages
4. **Before committing**: run `code-intel impact <symbol>` for every changed symbol
5. **If impact shows ≥ 5 callers**: warn the user — HIGH blast radius

## Why

`code-intel search` uses the knowledge graph — it understands types, interfaces, and call chains. `grep` only sees text. Using `grep` wastes ~3,000 tokens per lookup and misses cross-file relationships.

## Quick Reference

```bash
code-intel search "<query>"                                   # Find symbols
code-intel inspect <symbol>                                   # Callers, callees, imports
code-intel impact <symbol>                                    # Blast radius
code-intel query "TRAVERSE CALLS FROM '<symbol>' DEPTH 3"    # Call graph
code-intel pr-impact --base main --head HEAD                  # PR blast radius
```
