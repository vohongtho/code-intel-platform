# Runbook: Auth Provider Outage

**Scope:** Authentication system is unavailable — users cannot log in  
**Symptoms:** `POST /auth/login` returns errors, all API calls return 401, Web UI login page fails

---

## Diagnosis

```bash
# Check if server is running
curl http://localhost:4747/health/live

# Test auth endpoint directly
curl -X POST http://localhost:4747/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<password>"}'

# Check users.db is accessible
sqlite3 ~/.code-intel/users.db "SELECT id, username, role FROM users;"

# Check server logs for auth errors
tail -100 ~/.code-intel/logs/$(date +%Y-%m-%d)-code-intel.log | grep -i auth
```

---

## Common Issues & Fixes

### Issue 1 — users.db missing or corrupted

```bash
# Check file exists
ls -lh ~/.code-intel/users.db

# Check integrity
sqlite3 ~/.code-intel/users.db "PRAGMA integrity_check;"

# If corrupted — restore from backup
code-intel backup list
code-intel backup restore <backup-id>

# If no backup — recreate admin account
code-intel user create admin --role admin --password <secure-password>
```

### Issue 2 — Session store cleared (server restart)

Sessions are in-memory. After a server restart, all sessions are cleared and users must log in again. This is expected behavior.

```bash
# Users just need to log in again — no action needed on server side
```

### Issue 3 — All tokens revoked

```bash
# List active tokens
code-intel token list

# Re-create tokens as needed
code-intel token create --name "CI bot" --role analyst
code-intel token create --name "Read-only" --role viewer --expires 90d
```

### Issue 4 — Dev auto-login not working

```bash
# Check environment variables
echo $CODE_INTEL_DEV_AUTO_LOGIN

# Enable for local dev
export CODE_INTEL_DEV_AUTO_LOGIN=true
code-intel serve <repo>
```

### Issue 5 — CORS blocking login from browser

```bash
# Check allowed origins
echo $CODE_INTEL_CORS_ORIGINS

# Add your origin
export CODE_INTEL_CORS_ORIGINS="http://localhost:3000,http://localhost:4747"
code-intel serve <repo>
```

---

## Emergency Break-Glass Access

If all auth is broken but the server is running on localhost:

```bash
# Enable dev auto-login temporarily (localhost only)
CODE_INTEL_DEV_AUTO_LOGIN=true code-intel serve <repo>
```

**⚠ Disable immediately after resolving the issue.**

---

## Post-Recovery Checklist

- [ ] Login works for at least one admin user
- [ ] API token auth works (test with `Bearer` header)
- [ ] `GET /auth/status` returns authenticated user info
- [ ] Break-glass access disabled
- [ ] Root cause documented below

---

*Root cause of last outage: [DATE] — [DESCRIPTION]*
