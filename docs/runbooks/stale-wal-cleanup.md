# Runbook: Stale WAL Cleanup

**Scope:** SQLite WAL (Write-Ahead Log) files growing large or causing lock errors  
**Symptoms:** Disk usage unexpectedly high, DB open errors, `-shm`/`-wal` files > 100 MB

---

## Diagnosis

```bash
# Check WAL file sizes
ls -lh ~/.code-intel/*.db-wal ~/.code-intel/*.db-shm 2>/dev/null
ls -lh <repo>/.code-intel/*.db-wal <repo>/.code-intel/*.db-shm 2>/dev/null

# Check if any process is holding the DB open
lsof | grep code-intel | grep .db
```

---

## Safe cleanup (server not running)

```bash
# Stop the code-intel server first, then:
# WAL checkpoint — flushes WAL into main DB
sqlite3 ~/.code-intel/users.db "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 <repo>/.code-intel/graph.db "PRAGMA wal_checkpoint(TRUNCATE);"

# Remove orphaned WAL/SHM files (only if no process holds the DB)
rm -f <repo>/.code-intel/graph.db-wal
rm -f <repo>/.code-intel/graph.db-shm
```

---

## Forced cleanup (server running)

If the server is running and WAL is growing:

1. The server uses `PRAGMA journal_mode = WAL` — this is expected behavior.
2. WAL auto-checkpoints at 1000 pages by default.
3. If WAL is not checkpointing, restart the server:

```bash
# Restart triggers WAL checkpoint on open
code-intel serve <repo>
```

---

## Prevention

- Default WAL auto-checkpoint is sufficient for normal use.
- For write-heavy workloads, set `PRAGMA wal_autocheckpoint = 500`.
- Monitor disk usage — alert if `.code-intel/` exceeds 2 GB.
