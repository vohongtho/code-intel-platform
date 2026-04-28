# Runbook: Memory Exhaustion

**Scope:** Node.js process running out of heap memory during analysis or serving  
**Symptoms:** `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`, process crash, OOM kill

---

## Diagnosis

```bash
# Check current heap usage via /metrics
curl http://localhost:4747/metrics | grep process_heap

# Check process memory
ps aux | grep code-intel
# Look at RSS column (resident set size in KB)

# Check system memory
free -h
```

---

## Immediate Mitigations

### 1. Increase Node.js heap limit

```bash
NODE_OPTIONS="--max-old-space-size=4096" code-intel serve <repo>
# Or for 8GB:
NODE_OPTIONS="--max-old-space-size=8192" code-intel serve <repo>
```

### 2. Skip embeddings (largest memory consumer)

```bash
code-intel analyze <repo> --skip-embeddings
```

### 3. Analyze in segments (large monorepos)

```bash
# Add .codeintelignore to exclude heavy directories
echo "node_modules/" >> .codeintelignore
echo "dist/" >> .codeintelignore
echo "build/" >> .codeintelignore
echo ".cache/" >> .codeintelignore
code-intel analyze <repo> --force
```

---

## Root Cause Investigation

```bash
# Check graph size (nodes/edges correlation with memory)
code-intel status <repo>

# Check largest directories being indexed
cat <repo>/.codeintelignore

# Monitor memory during analysis
watch -n 2 "ps aux | grep code-intel"
```

---

## Prevention

- Set `NODE_OPTIONS="--max-old-space-size=4096"` in systemd service or Docker ENV
- Add `.codeintelignore` with vendor/generated directories excluded
- Alert if `process_heap_bytes / process_heap_bytes_limit > 0.8`

---

## Prometheus Alert Rule

```yaml
- alert: HighHeapUsage
  expr: process_heap_bytes / 1024 / 1024 > 1500
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "code-intel heap usage > 1.5 GB"
```
