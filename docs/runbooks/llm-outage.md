# Runbook: LLM / Embedding Outage

**Scope:** Vector embeddings fail to build; semantic search falls back to BM25  
**Symptoms:** `/api/v1/vector-status` returns `{ "ready": false }`, vector search returns `source: "text-fallback"`

---

## Diagnosis

```bash
# Check vector status
curl http://localhost:4747/api/v1/vector-status \
  -H 'Authorization: Bearer <token>'
# Expected during outage: { "ready": false, "building": false }

# Check server logs
tail -100 ~/.code-intel/logs/$(date +%Y-%m-%d)-code-intel.log | grep vector
```

---

## Impact Assessment

**Service degraded but NOT down:**
- BM25 text search continues to work normally
- All other API routes are unaffected
- MCP tools fall back to text search automatically
- Web UI search shows degraded quality but still returns results

---

## Recovery Steps

### 1. Check HuggingFace model availability

```bash
# Test model download manually
node -e "
const { pipeline } = require('@huggingface/transformers');
pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2').then(() => console.log('OK'));
"
```

### 2. Rebuild vector index

```bash
# Stop server, re-build embeddings, restart
code-intel analyze <repo> --embeddings --force
code-intel serve <repo>
```

### 3. Use offline model cache

If internet is unavailable, set the HuggingFace cache path:

```bash
export TRANSFORMERS_CACHE=/path/to/local/model/cache
code-intel analyze <repo> --embeddings
```

---

## Fallback: Text Search Only Mode

If embeddings are persistently unavailable, the system automatically falls back to BM25. No action required — users get degraded semantic quality but full functionality.

---

## Prevention

- Pre-download model to local cache in CI/deployment
- Monitor `/api/v1/vector-status` in health checks
- Set alert if vector build fails after 3 retries
