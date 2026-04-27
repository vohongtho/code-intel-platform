# Runbook: Bad Release Rollback

**Scope:** A newly deployed version of code-intel is broken and needs to be rolled back  
**Target:** < 15 minutes to restore previous working version

---

## Step 1 — Identify the bad version

```bash
# Check currently installed version
code-intel --version
npm list -g @vohongtho.infotech/code-intel

# Check when it was deployed
npm view @vohongtho.infotech/code-intel time
```

---

## Step 2 — Roll back to previous version

```bash
# Install specific previous version
npm install -g @vohongtho.infotech/code-intel@<previous-version>

# Verify rollback
code-intel --version
```

---

## Step 3 — Verify functionality after rollback

```bash
# Check health
curl http://localhost:4747/health/live

# Restart server
code-intel serve <repo>

# Verify search works
curl -X POST http://localhost:4747/api/v1/search \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"query":"main"}'
```

---

## Step 4 — Schema migration rollback (if DB was migrated)

```bash
# Check current schema version
code-intel migrate --status

# Roll back last migration if needed
code-intel migrate --rollback

# Verify DB is consistent
sqlite3 ~/.code-intel/users.db "PRAGMA integrity_check;"
```

---

## Step 5 — Index compatibility check

If the new version wrote an incompatible graph.db format, restore from backup:

```bash
code-intel backup list
code-intel backup restore <last-good-backup-id>
```

---

## Post-Rollback Checklist

- [ ] Previous version running (`code-intel --version` correct)
- [ ] `/health/live` and `/health/ready` return 200
- [ ] Search returns expected results
- [ ] DB schema rolled back if needed
- [ ] Bug filed against the bad release
- [ ] Rollout blocked until fix is confirmed

---

## Version History

| Version | Status | Notes |
|---------|--------|-------|
| v0.1.5  | Stable | Production baseline |
| v0.2.0  | TBD    | Platform foundations |
