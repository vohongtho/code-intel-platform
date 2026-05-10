# Code Intelligence — Tool Policy

## MANDATORY: Use code-intel before any code action

**FORBIDDEN** (never use for symbol/code discovery): `grep`, `rg`, `find`, `cat`, `sed`, `ls`

**REQUIRED workflow**:
```bash
code-intel search "<concept>"    # replaces grep/rg/find
code-intel inspect <symbol>      # replaces cat + manual reading
code-intel impact <symbol>       # replaces manual caller tracing
```

Rules:
- NEVER open a file cold — always `code-intel search` first
- NEVER use grep for symbols — use `code-intel search` instead
- If impact shows ≥ 5 callers → warn user: HIGH blast radius
