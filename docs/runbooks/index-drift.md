# Runbook: Index Drift

**Scope:** Knowledge graph is stale — code has changed but the index hasn't been updated  
**Symptoms:** Search returns outdated symbols, blast-radius misses recent changes, `code-intel status` shows old `indexedAt`

---

## Diagnosis

```bash
# Check when the index was last built
code-intel status <repo>

# Compare to last git commit
git -C <repo> log -1 --format="%ci %s"

# Check staleness threshold (>1h is usually concerning)
# Stale = indexedAt is older than last commit
```

---

## Immediate Fix — Re-index

```bash
# Re-analyze without force (incremental — faster)
code-intel analyze <repo>

# If index is very stale or corrupted, force full re-index
code-intel analyze <repo> --force

# Rebuild with embeddings if semantic search is used
code-intel analyze <repo> --embeddings --force
```

---

## Scheduled Indexing (prevention)

Set up a cron job or git hook to auto-index on commit:

**Cron (every hour):**
```bash
0 * * * * cd /path/to/repo && code-intel analyze . --skip-embeddings --skip-agents-md
```

**Git post-commit hook** (`.git/hooks/post-commit`):
```bash
#!/bin/bash
code-intel analyze . --skip-embeddings --skip-agents-md --skip-git &
```

---

## Checking via HTTP API

```bash
curl http://localhost:4747/health/ready
# Returns: { "status": "ok", "nodes": N, "edges": N, "timestamp": "..." }

curl http://localhost:4747/api/v1/health \
  -H 'Authorization: Bearer <token>'
# Returns detailed status including workspaceRoot and timestamp
```

---

## Alert Rule (Prometheus)

```yaml
- alert: IndexDrift
  expr: time() - code_intel_last_indexed_timestamp > 3600
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "code-intel index has not been updated in over 1 hour"
```
