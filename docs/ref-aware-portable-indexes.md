# Ref-aware reads and portable indexes (v1.0.12)

v1.0.11 could already build an isolated semantic snapshot of any committed ref, but only `graph_diff` and `pr_impact` used it. v1.0.12 lets normal read tools query a snapshot directly through an optional `ref`, and adds a `.cidx` package so one machine (usually CI) can build a snapshot and others can import it instead of re-analyzing. Code lives in `code-intel/core/src/storage/index-view*.ts` and `code-intel/core/src/snapshots/{portable-format,export-import,privacy}.ts`.

## Querying a ref

Omit `ref` and every tool behaves exactly as before, against the active index. Pass `ref` and the request is served from that ref's snapshot under `.code-intel/snapshots/`. The snapshot is built on first use, which runs a throwaway `git worktree` checkout plus a full analysis, and is cached after that.

| Surface | How |
|---|---|
| MCP | `ref` on `overview`, `search`, `inspect`, `context`, `explore`, `blast_radius`, `file_symbols`, `find_path`, `list_exports`, `routes`, `clusters`, `flows`, `query`, `explain_relationship`, `similar_symbols`, `health_report`, `cluster_summary`, `deprecated_usage`, `complexity_hotspots`, `api_contract`, `api_impact`, `api_shape_check` |
| HTTP | `ref` in the body of `POST /api/v1/search`, `/explore`, `/blast-radius`; `?ref=` on `GET /api/v1/nodes/{id}`, `/flows`, `/clusters`, `/graph/{repoId}/nodes` |
| CLI | `--ref` on `search`, `inspect`, `impact`, `explore` |

Tools that already compare refs (`graph_diff`, `pr_impact`, `detect_changes`, `api_drift`) don't accept `ref`. Neither do tools that read source files from the working tree (`taint_trace`, `secrets`, `vulnerability_scan`, `suggest_tests`, `coverage_gaps`). Passing one is an error, not a silent no-op.

Every ref-served response carries an `indexView` object: snapshot ID, the commit the ref resolved to, whether it came from cache or was just built, the privacy profile, and capability flags.

What a ref query will not do:

- Change the checkout, `HEAD`, the Git index, or the active generation. The integration test hashes all of these before and after two concurrent ref queries.
- Mix artifacts. Graph, BM25, vectors and relationship evidence all come from the one snapshot. Evidence lookups are redirected for the duration of the request, so `blast_radius` trust data at a ref is that ref's evidence.
- Fall back to current state. An unknown ref returns `unknown-ref`. A failed build returns `snapshot-build-failed`. Neither returns current-index results.
- Use the active index's vectors. On-demand snapshots are built with `--skip-embeddings`, so a `vector` or `hybrid` search at a ref reports `requestedMode: "vector"`, `actualMode: "bm25"`, `fallbackReason: "VECTOR_INDEX_UNAVAILABLE"`. Only an imported package that ships its own vectors gives a ref vector search.
- Read working-tree source. `explore` normally re-reads symbol bodies from disk when they still match the index; at a ref that hydration is off and the result says so in `capabilities.degraded`.

HTTP only lets `analyst` and above trigger a snapshot build, because a build is a full analysis. Other roles get cached or imported snapshots, or a 404 with `boundary: "snapshot-not-built"`.

### Lifetime of a snapshot under a query

Each request takes a read pin, a file under `.code-intel/snapshots/.read-pins/<snapshotId>/`, before validating the entry and releases it when the response is done. Cache eviction and `index remove` skip pinned entries. Eviction renames an entry aside and then re-checks pins, restoring the entry if a reader pinned in between. A crashed process's pins are reclaimed by PID on the same host; pins from another host expire after 30 minutes.

`index import --pin` and `index pin` write a separate, persistent marker in `.code-intel/snapshots/.pinned/`. Policy eviction never removes a pinned entry; `index remove` still can. Neither kind of pin changes the snapshot ID or the cache schema version.

### Cost

From `tests/performance/ref-index-overhead.test.ts` on a WSL2 dev machine, ~1.6k-symbol fixture, with the current index a byte copy of the snapshot so both paths read identical data:

| | Median |
|---|---|
| `search`, current index | 0.5 ms |
| `search`, cached ref | 25–31 ms |
| View resolution alone, warm | 19–22 ms |
| First ref query (build) | ~0.5 s here; a full analysis, so it grows with the repo |

The query itself costs the same. The overhead is per-request view resolution: three Git subprocesses to resolve the ref and repository identity, plus pin file writes. A cached ref never re-materializes or re-analyzes. The ref is still re-resolved per request on purpose, because branches move.

## Portable index packages

```bash
code-intel index export --ref main --output service-main.cidx      # prints the package sha256
code-intel index import service-main.cidx --pin --expect-sha256 <digest>
code-intel index refs                                               # cached snapshots + local refs that map to each
code-intel index pin|unpin|remove <ref | snapshot ID | ID prefix>
```

A package is a gzip'd ustar archive: `manifest.json` first, then allowlisted artifacts (`graph.db`, `meta.json`, and optionally `bm25.db`, `vector.db`, `evidence.db`, `content-fingerprints.json`, `protocol-contracts.json`) under bare names. The manifest records format version, snapshot schema version, the semantic snapshot descriptor, repository identity, producer analyzer fingerprints, the privacy profile, capability flags, and each artifact's size and SHA-256. Export is deterministic: the same snapshot produces the same package bytes, and `createdAt` is written as the epoch.

Export refuses a repository whose `origin` URL embeds credentials (`https://user:token@…`), since that URL is the package's repository identity.

### Import treats the package as untrusted

In order, before anything is published:

1. Bounds: package file size, entry count, manifest size, per-artifact size, and total decompressed bytes (which also stops gzip bombs). `--max-bytes` sets the payload cap; the default is 2 GiB.
2. Entries: only regular files with allowlisted bare names. Directories, symlinks, hard links, pax/GNU extensions, ustar prefixes, `..` and absolute names are rejected. Files are created with exclusive-create in a fresh staging directory.
3. Manifest: schema-checked. The descriptor's snapshot ID is recomputed from its fields, and declared capabilities must match the artifacts present.
4. Hashes: every artifact's size and SHA-256 are checked against the manifest before any database is opened.
5. Identity: the package's repository identity must equal this repository's `origin` URL (or canonical path when there is no `origin`). There is no remapping.
6. Compatibility: producer and descriptor analyzer fingerprints must equal this installation's. Otherwise import is rejected with a remediation to use the producing version or re-export.
7. Git: if the commit exists locally, its tree must match the descriptor. If it doesn't exist locally, import continues with a warning.
8. Privacy: a package declaring `metadata-only` is checked for source text in the graph and snippets in BM25.
9. Read-back: graph, BM25, vectors and evidence are reopened read-only and checked like a fresh build.
10. Publish: one rename into the cache. If an equivalent snapshot is already cached, it is kept and the import reports `already-present`.

Any failure deletes the staging directory and publishes nothing. Import never touches the active generation; an imported snapshot is only a read source for `ref` queries and `graph_diff`.

Manifest hashes prove the artifacts match the manifest, not who wrote the package. Anyone able to write a package can write a consistent manifest. If the package crosses a trust boundary, take its digest from somewhere you trust (the CI job log, a release note) and pass `--expect-sha256`. Without that, import still opens the graph with a native database library after the hash check, so only import packages from sources you would run analysis output from.

## Privacy profiles

`full` keeps what the snapshot has, including the stored prefix of each symbol body (up to 1000 characters) and BM25 snippets.

`metadata-only` is produced by `snapshots/privacy.ts` (transform version 1) without byte-editing any database. It loads the graph, drops node `content` and any metadata key that can carry source text (`content`, `snippet`, `source`, `expression`, `body`, `code`, `doc`, `summary`, `query`, `sql` and a few others) at any depth, writes a new `graph.db`, reopens it, and fails the export if node/edge counts differ or any of those fields survive. BM25 is rebuilt from the stripped graph, so lexical search over names, kinds and paths keeps working (`bm25Content: "names-only"`). Evidence is copied with the free-text `details` and rejected-candidate reasons cleared. Vectors and the protocol-contract sidecar are left out.

What `metadata-only` still reveals: every symbol name, kind, file path and line range, and the call/import structure. Local variables are indexed as `variable` nodes, so their names are included too. `content-fingerprints.json` keeps per-declaration hashes, which support rename detection in diffs but could confirm a guess of a short body.

Reads against a metadata-only snapshot report `indexView.capabilities.sourceContent: false` with a `missing-content` boundary. `inspect` returns no `content`; `explore` lists `missing-content` under `capabilities.degraded` and never fills the gap from the working tree.

## Web graph diff

`POST /api/v1/graph/diff` now includes `baseSnapshot.indexView` and `headSnapshot.indexView` for each usable side. The `/diff` page shows them in a "Compared indexes" panel (ref, commit, snapshot, cached/built, privacy profile, boundaries) only when the server sends them. Flow deltas render the server's `entryPointId` when present. All classification, continuity and coverage remain server-side.

## Not supported

Dirty working trees as a ref, writes or refactors against a ref, repository remapping on import, signed packages, and hosted index storage.
