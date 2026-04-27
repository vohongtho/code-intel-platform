# Runbook: Disaster Recovery

**Scope:** Full loss of `.code-intel/` directory or host machine  
**RTO Target:** < 30 minutes  
**RPO Target:** Last backup (daily by default)

---

## Prerequisites

- Access to `~/.code-intel/backups/` (or S3/remote copy)
- `code-intel` CLI available on the recovery host
- Original source code available (re-analysis fallback)

---

## Step 1 — Assess the situation

```bash
# Check what's missing
ls ~/.code-intel/
ls <repo>/.code-intel/

# Check if backups exist
code-intel backup list
```

If backups exist → proceed to Step 2.  
If no backups → skip to Step 4 (re-analysis).

---

## Step 2 — Restore from backup

```bash
# List available backups
code-intel backup list

# Restore the most recent backup for your repo
code-intel backup restore <backup-id>

# Verify restoration
ls <repo>/.code-intel/
code-intel status <repo>
```

---

## Step 3 — Verify restored index

```bash
# Start the server and verify
code-intel serve <repo>

# Check health endpoints
curl http://localhost:4747/health/ready
curl http://localhost:4747/health/live

# Verify search works
curl -X POST http://localhost:4747/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"main"}' \
  -H 'Authorization: Bearer <your-token>'
```

---

## Step 4 — Re-analysis fallback (no backup available)

```bash
# Full re-analysis
code-intel analyze <repo-path> --force

# Rebuild vector index if needed
code-intel analyze <repo-path> --embeddings --force

# Immediately create a backup
code-intel backup create <repo-path>
```

---

## Step 5 — Restore user accounts (if users.db was lost)

```bash
# Re-create admin account
code-intel user create admin --role admin --password <secure-password>

# Re-issue any CI/integration tokens
code-intel token create --name "CI bot" --role analyst

# Apply migrations
code-intel migrate
```

---

## Post-Recovery Checklist

- [ ] Server starts and `/health/ready` returns 200
- [ ] At least one search query returns expected results
- [ ] Admin account working (login test)
- [ ] API tokens re-issued and documented
- [ ] Fresh backup created immediately after recovery
- [ ] Root cause identified and documented

---

## Prevention

- Enable automated backups (configure cron: `code-intel backup create` daily)
- Store backup copies offsite (copy `~/.code-intel/backups/` to S3)
- Test DR restore quarterly — document results in this runbook

---

*Last drilled: [DATE] by [WHO] — result: [PASS/FAIL]*
