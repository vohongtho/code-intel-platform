# Runbook: Stuck Job

**Scope:** An analysis job has been running for > 30 minutes without completing  
**Symptoms:** `code-intel status` shows analysis in progress for an unusually long time, CPU pegged, no progress

---

## Diagnosis

```bash
# Check running processes
ps aux | grep code-intel

# Check logs for last activity
tail -50 ~/.code-intel/logs/$(date +%Y-%m-%d)-code-intel.log

# Check jobs DB (if using durable job model)
sqlite3 ~/.code-intel/jobs.db \
  "SELECT id, kind, status, attempts, startedAt, repoPath FROM jobs WHERE status='running';"
```

---

## Immediate Recovery

### Option 1 — Kill and retry

```bash
# Find the PID
pgrep -a node | grep code-intel

# Kill the stuck process
kill <PID>

# Re-run analysis
code-intel analyze <repo> --force
```

### Option 2 — Cancel via jobs DB

```bash
# Get the job ID from the DB
sqlite3 ~/.code-intel/jobs.db \
  "UPDATE jobs SET status='cancelled', finishedAt=datetime('now') WHERE status='running';"

# Then restart
code-intel analyze <repo>
```

---

## Root Causes & Fixes

| Root Cause | Fix |
|---|---|
| Very large repo (> 50k files) | Add `.codeintelignore`, exclude vendor dirs |
| Embedding model download stalled | Skip embeddings: `--skip-embeddings` |
| Tree-sitter parser hung on malformed file | Check logs for last parsed file; add to `.codeintelignore` |
| SQLite WAL lock | See stale-wal-cleanup runbook |
| OOM (out of memory) | See memory-exhaustion runbook |

---

## Recovery Checklist

- [ ] Stuck process killed
- [ ] Stale job records cleared from `jobs.db`
- [ ] Analysis re-run successfully
- [ ] Root cause identified
- [ ] `.codeintelignore` updated if needed
- [ ] Alert threshold adjusted if false positive

---

## Prometheus Alert Rule

```yaml
- alert: StuckJob
  expr: time() - code_intel_job_started_at > 1800
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "code-intel job has been running for > 30 minutes"
```
