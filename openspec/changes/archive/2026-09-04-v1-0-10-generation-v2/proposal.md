# v1.0.10: Generation V2 — efficient, consistent, and concurrency-safe atomic index publication

## Status

Proposed

## Target release

`1.0.10`

## Change ID

`v1-0-10-generation-v2`

## Priority

`P0 — storage correctness, analysis reliability, and index performance`

## Summary

Code Intel currently publishes repository indexes as immutable generations so that `graph.db`, `bm25.db`, `vector.db`, and `meta.json` become visible together only after analysis succeeds. This prevents consumers from observing a partially written index and preserves a previous generation for rollback.

The generation model is correct and must remain. The current implementation, however, creates and seeds a staging generation before it knows whether publication is required. Every normal `code-intel analyze` invocation can therefore copy the complete active index, publish a logically equivalent generation on zero-change runs, and cause unnecessary disk I/O and consumer reloads. Artifact readers also resolve `current.json` independently, so one logical request can read files from different generations if publication occurs between path resolutions. Concurrent analyses are not serialized, and cleanup may remove staging directories owned by another active process.

Version 1.0.10 introduces **Generation V2** with five core rules:

1. **Plan before staging.** Detect changes and resolve all graph, BM25, vector, metadata, and publication work before creating a generation.
2. **A no-op remains the same generation.** A true zero-change analysis must not create staging, copy artifacts, rewrite `current.json`, or change the generation ID.
3. **Seed selectively.** Only clone artifacts that must be preserved for incremental mutation; never copy an artifact that will be rebuilt completely.
4. **Pin reads to one snapshot.** Every multi-artifact operation resolves the active generation once and uses that immutable snapshot for its complete lifetime.
5. **Serialize analysis per repository.** Only one process may prepare or publish an index generation for a repository at a time.

This change preserves the atomic publication and rollback guarantees introduced by the current generation model while reducing unnecessary storage work and closing consistency and concurrency gaps.

---

## Why this change is required

A Code Intel index is one logical state represented by multiple related artifacts:

```text
.code-intel/
├── current.json
└── generations/
    └── <generation-id>/
        ├── graph.db
        ├── bm25.db
        ├── vector.db
        └── meta.json
```

The artifacts must agree on:

- the indexed source snapshot;
- graph nodes and relationships;
- BM25 documents;
- vector documents and embedding fingerprint;
- parser provenance;
- schema and index versions;
- repository statistics;
- generation identity.

Publishing these files independently could expose states such as:

```text
graph.db    = new source state
bm25.db     = new source state
vector.db   = old source state
meta.json   = old source state
```

Generation-based publication correctly prevents that failure mode by writing into an isolated staging directory, validating the complete artifact set, renaming staging into a final generation, and atomically replacing `current.json`.

The problem is therefore not the existence of `generations`. The problem is that the current preparation, read, concurrency, and cleanup behavior does not fully exploit the immutable-generation design.

---

## Current behavior

The normal CLI entry point wraps `code-intel analyze` in an atomic parent process. The parent currently performs the following sequence:

```text
create staging generation
        ↓
copy graph.db, bm25.db, vector.db, and meta.json
        ↓
run the existing analyze command against staging
        ↓
validate staging artifacts
        ↓
rename staging to a final generation
        ↓
atomically update current.json
        ↓
retain the newest generations and remove older ones
```

This wrapper runs before the child analysis has completed source change detection and before vector update scope is resolved.

Version 1.0.9 improved vector behavior by separating source change detection from graph execution mode:

- graph and BM25 may still use a correctness-first full rebuild;
- a healthy vector index can update only changed and deleted paths;
- a zero-change run performs no vector writes;
- missing, stale, incompatible, forced, or unknown vector state uses a full rebuild.

That fixes unnecessary full re-embedding, but it does not eliminate unconditional generation seeding. A large `vector.db` can still be physically copied before the child decides that no vector writes are needed or that only a small incremental update is required.

---

## Problems

### P1. Zero-change analysis is not a true no-op

A repository with no source, parser, schema, embedding, or configuration changes may still create staging and publish a new generation.

Consequences:

- the generation ID changes without a logical index change;
- `current.json` is rewritten;
- consumers may reload an equivalent index;
- full database files may be copied;
- retention cleanup is triggered;
- SSD writes and temporary disk usage increase;
- no-op runtime becomes proportional to index size instead of source-change detection cost.

Expected behavior is to preserve the active generation byte-for-byte when no publication is required.

### P2. All artifacts are copied before their work mode is known

The current seeding step copies `graph.db`, `bm25.db`, `vector.db`, and `meta.json` without considering the final work plan.

This is unnecessary in several common cases:

- A correctness-first full graph rebuild does not need the previous `graph.db`.
- A full BM25 rebuild does not need the previous `bm25.db`.
- A forced, missing, stale, or fingerprint-incompatible vector rebuild does not need the previous `vector.db`.
- New metadata can be written from the already loaded previous metadata and current analysis result; copying `meta.json` is not inherently required.

Only an artifact that will be preserved or incrementally mutated should be cloned into staging.

### P3. Multi-artifact readers can mix generations

Current path helpers may resolve `current.json` separately for metadata, graph, BM25, and vector files.

A race can occur:

```text
request resolves graph.db from generation A
publisher switches current.json to generation B
request resolves bm25.db from generation B
request resolves vector.db from generation B
```

The `current.json` write is atomic, but the request is not pinned to one manifest. The request can therefore observe a mixed index even though every generation is internally valid.

### P4. Concurrent analysis is not safely serialized

Two `code-intel analyze` processes can operate on the same repository at the same time.

Possible outcomes include:

- duplicate full graph and embedding work;
- both processes seeding from the same old generation;
- last-writer-wins publication;
- an older analysis publishing after a newer analysis;
- cleanup from one process deleting another process's staging directory;
- unclear failure and recovery behavior.

Atomic publication protects the currently active generation, but it does not coordinate multiple writers.

### P5. Staging cleanup is ownership-unaware

Cleanup identifies staging directories by name prefix and can remove all `.staging-*` directories. It does not reliably know whether a staging directory belongs to a live process.

Cleanup must distinguish:

- the current process's staging directory;
- staging referenced by the active repository lock;
- recent inactive staging that may belong to a process on another host;
- abandoned staging older than the stale threshold;
- successfully published generation directories.

### P6. Temporary disk amplification is unnecessarily high

During analysis, disk may contain:

```text
active generation
previous retained generation
complete staging copy
legacy flat artifacts
```

When staging copies every database, peak disk use can approach several times the active index size. This is especially costly for repositories with large semantic vector indexes.

### P7. Generation changes are not semantically meaningful

A generation ID should identify a newly published logical index state. Publishing a new generation when nothing changed weakens that meaning and makes diagnostics, reload behavior, and operational history noisier.

---

## Goals

Version 1.0.10 must provide the following guarantees.

### G1. Preserve atomic publication

A failed analysis, artifact build, validation, rename, or manifest update must not alter the active generation. Consumers continue to use the previously published generation until the complete replacement validates and is published successfully.

### G2. Make zero-change analysis a real no-op

When no source, deletion, schema, parser, embedding, or required metadata change exists:

- no staging directory is created;
- no artifact is cloned;
- no artifact is rewritten;
- `current.json` remains byte-identical;
- the active generation ID remains unchanged;
- consumers are not instructed to reload.

### G3. Resolve the complete plan before staging

The system determines graph, BM25, vector, metadata, and publication work before creating a generation. Unknown or inconsistent state fails safely to a complete rebuild plan.

### G4. Seed only required artifacts

Artifacts scheduled for a full rebuild are created directly in staging and are not copied from the active generation. Artifacts scheduled for incremental mutation may be cloned from the pinned active snapshot.

### G5. Guarantee one generation per read operation

Any operation using more than one index artifact must resolve the active manifest once and derive all artifact paths from that one generation ID.

### G6. Serialize repository analysis

Only one analysis process may mutate staging or publish for a repository. A competing analysis must fail clearly before creating staging, unless a future explicit wait policy is introduced.

### G7. Protect live staging work

Cleanup must not remove staging associated with an active lock or recent owner activity. Abandoned staging may be removed conservatively.

### G8. Preserve rollback and compatibility

The active generation and at least one previous successful generation remain available by default. Generation V1 manifests and legacy flat indexes remain readable or migratable.

### G9. Provide useful observability

Verbose and profile output must explain the resolved plan, seeded artifacts, clone method, publication decision, and generation transition.

---

## Non-goals

Version 1.0.10 does not:

- remove generation-based publication;
- restore partial graph rebuilding;
- redesign cross-file relationship resolution;
- change graph, BM25, vector, or metadata data models unless required for generation identity;
- replace LadybugDB or the current BM25/vector storage engines;
- change search ranking, graph semantics, impact traversal, context generation, or vulnerability findings;
- implement distributed locking for shared network filesystems;
- automatically delete legacy flat index files;
- change embedding providers or models;
- add graph-aware source editing or rename behavior.

Graph correctness and generation efficiency remain independent concerns. If graph relationships require a full rebuild, the planner may still choose a full graph and BM25 rebuild while using incremental vector updates.

---

## Proposed behavior

## 1. Plan-first analysis lifecycle

The parent analyze flow must become:

```text
acquire repository analysis lock
        ↓
resolve and pin active index snapshot
        ↓
run source/configuration/schema change detection
        ↓
resolve complete analysis plan
        ↓
┌──────────────────────────────────┐
│ plan = no-op                     │
│ release lock and return success  │
└──────────────────────────────────┘
        ↓ publication required
create staging generation
        ↓
clone only plan.seedArtifacts
        ↓
run planned graph/BM25/vector work
        ↓
write metadata
        ↓
validate complete required artifact set
        ↓
rename staging to final generation
        ↓
atomically replace current.json
        ↓
release analysis lock
        ↓
clean retained generations and stale staging safely
```

No staging directory may be created before the plan determines that publication is required.

## 2. Analysis plan contract

A pure planner must produce one deterministic plan from the current repository/index state.

Suggested contract:

```ts
export type GraphWorkMode = 'preserve' | 'full' | 'incremental';
export type Bm25WorkMode = 'preserve' | 'full' | 'incremental';
export type VectorWorkMode = 'disabled' | 'preserve' | 'full' | 'incremental';

export type AnalysisPlan =
  | {
      mode: 'noop';
      reason: 'no-changes';
      graph: 'preserve';
      bm25: 'preserve';
      vector: 'disabled' | 'preserve';
      changedPaths: [];
      deletedPaths: [];
      seedArtifacts: [];
      requiredArtifacts: [];
      publicationRequired: false;
    }
  | {
      mode: 'publish';
      reason:
        | 'initial-analysis'
        | 'source-changed'
        | 'source-deleted'
        | 'forced'
        | 'change-set-unknown'
        | 'schema-migration'
        | 'parser-migration'
        | 'vector-missing'
        | 'vector-stale'
        | 'embedding-fingerprint-changed'
        | 'metadata-migration';
      graph: GraphWorkMode;
      bm25: Bm25WorkMode;
      vector: VectorWorkMode;
      changedPaths: string[];
      deletedPaths: string[];
      seedArtifacts: IndexArtifactName[];
      requiredArtifacts: IndexArtifactName[];
      publicationRequired: true;
    };
```

The planner must be side-effect free and exhaustively unit tested. It must never silently choose incremental work when required state is missing or untrusted.

### Planning inputs

The planner must consider at least:

- whether a valid active generation exists;
- explicit `--force`;
- whether source change scope is known;
- changed source paths;
- deleted source paths;
- whether graph correctness requires a full rebuild;
- whether embeddings are enabled;
- whether `vector.db` exists and is non-empty;
- whether vector metadata is ready, stale, failed, or unavailable;
- embedding provider, model, and dimension fingerprint compatibility;
- parser migration state;
- index schema migration state;
- whether metadata-only publication is required;
- whether required artifacts are trusted.

### Safe fallback

If the planner cannot prove that preserve or incremental work is safe, it must select a full rebuild for the affected artifact. Correctness takes priority over optimization.

## 3. Required planning matrix

| Situation | Graph | BM25 | Vector | Seed artifacts | Publish |
| --- | --- | --- | --- | --- | --- |
| Initial analysis, embeddings disabled | Full | Full | Disabled | None | Yes |
| Initial analysis, embeddings enabled | Full | Full | Full | None | Yes |
| No source/config/schema changes, healthy index | Preserve | Preserve | Preserve/Disabled | None | No |
| Known changed paths, embeddings disabled | Full correctness rebuild | Full | Disabled | None | Yes |
| Known changed paths, healthy vectors | Full correctness rebuild | Full | Incremental | `vector.db` only | Yes |
| Known deleted paths, healthy vectors | Full correctness rebuild | Full | Incremental delete/update | `vector.db` only | Yes |
| `--force`, embeddings disabled | Full | Full | Disabled | None | Yes |
| `--force`, embeddings enabled | Full | Full | Full | None | Yes |
| Vector DB missing | As graph requires | As BM25 requires | Full | None | Yes |
| Vector metadata stale/failed/incompatible | As graph requires | As BM25 requires | Full | None | Yes |
| Embedding fingerprint changed | As graph requires | As BM25 requires | Full | None | Yes |
| Change scope unknown | Full | Full | Full when enabled | None | Yes |
| Parser/schema migration requires rebuild | Full | Full | Full or preserve only when proven compatible | According to final plan | Yes |
| Metadata-only migration | Preserve | Preserve | Preserve/Disabled | All preserved required DB artifacts | Yes |

For the common 1.0.9 behavior of one changed file with healthy vectors, Generation V2 must perform:

```text
graph.db  → build from scratch in staging
bm25.db   → build from scratch in staging
vector.db → clone from pinned snapshot, then delete/upsert changed paths
meta.json → write new metadata directly
```

It must not copy `graph.db`, `bm25.db`, or `meta.json` in that case.

## 4. True no-op path

A no-op plan terminates before staging creation.

Required behavior:

```text
code-intel analyze
  ◈ No source or index changes detected
  ✓ Active generation preserved: <generation-id>
```

The following must remain unchanged:

- `current.json` contents and modification time;
- active generation ID;
- `graph.db` modification time;
- `bm25.db` modification time;
- `vector.db` modification time when present;
- `meta.json` modification time;
- generation directory count.

No `.staging-*` directory may appear, even temporarily, after the lock and planning phases conclude with `mode: noop`.

A no-op does not include cases where metadata must be changed for correctness. Such cases use an explicit metadata-migration publication plan.

## 5. Pinned index snapshot

Introduce a shared immutable snapshot abstraction:

```ts
export interface IndexSnapshot {
  generationId: string;
  generationDir: string;
  manifestPath: string;
  manifest: IndexGenerationManifest;
  graphDbPath: string;
  bm25DbPath: string;
  vectorDbPath: string;
  metadataPath: string;
}
```

A resolver must:

1. read and parse `current.json` once;
2. validate the generation ID and referenced directory;
3. derive every artifact path from that same generation directory;
4. prevent path traversal or symbolic-link escape;
5. return an immutable snapshot object.

Every operation that uses multiple artifacts must use one snapshot for its complete lifetime, including:

- index trust verification;
- CLI `search`, `inspect`, `impact`, `context`, and related graph commands;
- HTTP repository queries and search;
- MCP tools and resources;
- repository group queries;
- server repository loading and reload;
- health and status endpoints that compare metadata and artifacts.

The current per-artifact compatibility helpers may remain for isolated single-artifact callers, but shared request paths must not independently resolve the active manifest more than once.

## 6. Server and MCP snapshot reload

Runtime repository state must be replaced as one unit:

```ts
export interface LoadedRepositoryIndex {
  snapshot: IndexSnapshot;
  metadata: IndexMetadata;
  graph: KnowledgeGraph;
  bm25: Bm25Index;
  vector?: VectorIndex;
}
```

Required reload behavior:

```text
detect current generation ID changed from A to B
        ↓
resolve and validate snapshot B
        ↓
open graph, BM25, vector, and metadata from B
        ↓
construct LoadedRepositoryIndex B completely
        ↓
atomically replace runtime reference A with B
        ↓
close A only after in-flight users release it
```

Graph, BM25, vector, and metadata references must not be swapped independently.

A request that begins on generation A completes entirely on A. A later request may use B. No request may combine A and B artifacts.

## 7. Selective artifact seeding

Replace unconditional seeding with a plan-aware operation:

```ts
seedIndexGeneration({
  snapshot,
  generation,
  artifacts: plan.seedArtifacts,
});
```

Rules:

- `graph.db` is seeded only when graph work is `preserve` or proven safe incremental mutation.
- `bm25.db` is seeded only when BM25 work is `preserve` or incremental mutation.
- `vector.db` is seeded only when vector work is `incremental` or a metadata-only publication must preserve the existing vector artifact.
- `meta.json` should normally be generated from in-memory metadata and must not be copied merely as a default.
- SQLite/WAL sidecars are copied only when the owning database is seeded and only after the source is safely quiesced or checkpointed.
- Missing required seed artifacts must fail planning or validation before publication.

## 8. Copy-on-write clone optimization

When seeding is required, the implementation should prefer filesystem copy-on-write cloning:

1. try `COPYFILE_FICLONE_FORCE`;
2. try `COPYFILE_FICLONE`;
3. fall back to a normal copy.

Reflink support is a performance optimization, not a correctness requirement. All supported filesystems must continue to work through normal copying.

Verbose/profile output must report the clone method for each seeded artifact:

```text
vector.db: reflink
```

or:

```text
vector.db: copied (84.2 MB)
```

## 9. Repository analysis lock

Add a repository-scoped lock acquired before staging creation or mutable analysis work.

Suggested path:

```text
.code-intel/analyze.lock
```

Suggested content:

```json
{
  "version": 1,
  "pid": 12345,
  "hostname": "developer-machine",
  "startedAt": "2026-08-03T04:30:00.000Z",
  "baseGenerationId": "generation-a",
  "stagingGenerationId": null
}
```

Requirements:

- acquire the lock through an atomic exclusive create;
- do not create staging before lock acquisition succeeds;
- update lock metadata after a staging generation is allocated;
- release the lock in a `finally` path after success or failure;
- a second analysis receives a clear error and performs no index writes;
- lock contents must not include secrets;
- malformed lock data must be handled conservatively.

Expected competing-process error:

```text
Analysis is already running for this repository.
PID: 12345
Host: developer-machine
Started: 2026-08-03T04:30:00.000Z
```

### Stale lock recovery

A lock may be automatically considered stale only when liveness can be verified safely, for example when the recorded process no longer exists on the same host.

When host or process liveness cannot be verified, age alone must not immediately delete a recent lock. Conservative TTL and explicit recovery are required.

Provide maintenance behavior equivalent to:

```bash
code-intel index unlock
code-intel index unlock --force
```

Exact command naming may be finalized in design, but forced unlock must display the lock owner and require explicit user intent.

## 10. Staging ownership and activity

Each staging generation must contain ownership metadata, for example:

```text
.code-intel/generations/.staging-<generation-id>/staging.json
```

```json
{
  "version": 1,
  "generationId": "generation-b",
  "baseGenerationId": "generation-a",
  "pid": 12345,
  "hostname": "developer-machine",
  "createdAt": "2026-08-03T04:30:00.000Z",
  "lastActivityAt": "2026-08-03T04:31:12.000Z"
}
```

`lastActivityAt` should be refreshed at meaningful phase boundaries for long-running analysis.

A process may always abort and delete its own staging directory. General cleanup must not assume every `.staging-*` directory is abandoned.

## 11. Safe staging cleanup

Cleanup must classify staging directories as:

- owned by the active lock;
- recently active;
- stale and owner confirmed dead;
- stale with owner unknown;
- invalid or malformed.

Rules:

1. Preserve staging referenced by the active repository lock.
2. Preserve recent staging within the configured stale interval.
3. Remove staging owned by a confirmed dead local process after the safety checks pass.
4. Remove old unknown-owner staging only under a conservative TTL or explicit cleanup command.
5. Never remove a published generation through staging cleanup rules.
6. Never remove the generation referenced by `current.json`.
7. Report removed and preserved staging in verbose or dry-run output.

Recommended defaults:

```yaml
index:
  keepGenerations: 2
  staleStagingHours: 24
```

## 12. Publication and validation contract

Generation V2 preserves the existing atomic publication boundary.

Before publication, validate:

- `graph.db` exists, is a regular non-empty file, and passes required DB checks;
- `bm25.db` exists, is a regular non-empty file, and passes required DB checks;
- `vector.db` exists and is valid when embeddings metadata reports ready;
- `meta.json` parses and passes schema validation;
- metadata generation ID equals the staging generation ID;
- all required artifact paths are inside the staging directory;
- no required artifact resolves through a symlink outside the generation directory;
- embedding metadata cannot claim ready when the vector artifact is missing;
- schema, parser, and index fingerprints are compatible with the publication plan.

Publication sequence:

```text
validate staging
        ↓
rename staging directory to final generation directory
        ↓
write current.json to a temporary file
        ↓
atomically rename temporary manifest to current.json
```

If any step before the final manifest swap fails, the active generation remains unchanged. If the manifest swap fails, the new final directory may be cleaned later but must not be treated as active.

## 13. Manifest evolution

Generation V1 manifests must remain readable. Generation V2 may extend the manifest with optional fields such as:

```ts
export interface IndexGenerationManifestV2 {
  version: 2;
  generationId: string;
  baseGenerationId?: string;
  publishedAt: string;
  schemaVersion?: number;
  parser?: 'tree-sitter' | 'regex';
  artifacts: Partial<Record<IndexArtifactName, {
    size: number;
    required: boolean;
    fingerprint?: string;
  }>>;
}
```

A healthy V1 generation must not be rewritten solely to upgrade manifest formatting during a zero-change analysis. The next real publication may write the V2 manifest.

## 14. Retention and legacy migration

Default retention continues to keep:

- the active published generation;
- one previous successfully published generation.

Retention cleanup runs only after successful publication and lock release. The active generation must never be deleted.

Legacy flat artifacts remain supported as migration input:

```text
.code-intel/graph.db
.code-intel/bm25.db
.code-intel/vector.db
.code-intel/meta.json
```

Migration must continue to publish them through a validated generation without deleting the legacy files automatically.

Provide explicit cleanup behavior equivalent to:

```bash
code-intel index cleanup --dry-run
code-intel index cleanup
code-intel index cleanup --remove-legacy
```

Legacy removal requires a trusted active generation and explicit user action.

## 15. Observability

Verbose analysis output must show the resolved work plan before staging starts:

```text
Analysis plan:
  reason: source-changed
  graph: full
  bm25: full
  vector: incremental
  changed paths: 1
  deleted paths: 0
  seed artifacts: vector.db
  publication required: yes
```

No-op output:

```text
Analysis plan:
  reason: no-changes
  graph: preserve
  bm25: preserve
  vector: preserve
  seed artifacts: none
  publication required: no
```

Profile output should include:

- base generation ID;
- published generation ID, if any;
- analysis plan reason;
- seed artifact list;
- clone method per artifact;
- physical bytes copied;
- logical bytes reflinked;
- staging creation and publication durations;
- whether cleanup removed stale state.

Generation reload logs must identify both the old and new generation IDs.

---

## User-visible behavior

### Zero-change analysis

Before:

```text
analysis may seed and publish an equivalent generation
```

After:

```text
✓ No source or index changes detected
✓ Active generation preserved: <generation-id>
```

### One changed file with healthy embeddings

```text
Graph: full correctness rebuild
BM25: full rebuild
Vector: delete/upsert changed path only
Seeded artifact: vector.db only
Published: one new generation
```

### Forced embeddings analysis

```text
Graph: full rebuild
BM25: full rebuild
Vector: full rebuild
Seeded artifacts: none
```

### Failed vector update

```text
analysis exits unsuccessfully
staging is aborted or retained only for safe cleanup
a current.json remains unchanged
previous generation continues serving requests
```

### Concurrent analysis

```text
Error: Analysis is already running for this repository.
```

The competing process must not create staging or write index artifacts.

---

## Compatibility requirements

### CLI

Existing commands and flags remain supported:

```bash
code-intel analyze
code-intel analyze --incremental
code-intel analyze --force
code-intel analyze --embeddings
code-intel analyze --skip-embeddings
```

New maintenance commands may be added without changing existing command semantics.

### HTTP and MCP

Existing request and response contracts remain compatible. Optional generation diagnostics may be added, but no existing field may change meaning solely because of Generation V2.

### Storage

- Existing Generation V1 directories and manifests remain readable.
- Legacy flat indexes remain migratable.
- Graph, BM25, and vector database formats remain compatible unless a separately documented migration is required.
- Rollback to 1.0.9 must remain possible for an index that has not undergone an incompatible schema migration.

### Search and graph behavior

This proposal must not change ranking, symbol identity, graph edge semantics, impact results, context generation, route detection, flow detection, clustering, or security finding semantics.

---

## Security requirements

- All generation, staging, and artifact paths must resolve under `<repo>/.code-intel/generations/`.
- Manifest and staging JSON must reject path traversal and unexpected path fields.
- Publication and cleanup must not follow symlinks outside the index root.
- Lock and staging metadata must not contain credentials, tokens, source content, or environment secrets.
- Temporary and lock files should use restrictive permissions where supported.
- A malformed manifest must fail closed and must not redirect reads or cleanup to arbitrary paths.
- Forced unlock and legacy removal require explicit user intent and clear diagnostics.

---

## Performance expectations

### Zero-change

Target:

```text
new generations: 0
artifact clones: 0
artifact writes: 0
manifest writes: 0
physical bytes copied: 0
```

Runtime should be dominated by change detection rather than current index size.

### One changed path with healthy vector state

Target:

```text
graph.db copied: no
bm25.db copied: no
vector.db cloned: yes, preferably reflink
meta.json copied: no
embedding computation: changed path only
```

### Forced full analysis

Target:

```text
old database artifacts copied: none
all required artifacts built directly in staging
```

### Temporary disk

Normal peak temporary storage should no longer always include a complete physical copy of the active generation. Reflink-capable filesystems should allocate new blocks only for modified vector pages and newly built graph/BM25 artifacts.

---

## Failure behavior

### Planning failure

If the current state cannot be classified safely, analysis must fail or select a full safe rebuild. It must not create an incremental plan from incomplete information.

### Lock acquisition failure

The process exits before staging creation and reports the active lock owner.

### Seed failure

The active generation remains unchanged. Partial staging belongs to the current process and is aborted safely.

### Graph or BM25 failure

No publication occurs. The active generation remains available.

### Vector failure

No publication occurs, including when graph and BM25 succeeded in staging. The active generation remains available and internally consistent.

### Metadata or validation failure

No manifest switch occurs. The active generation remains available.

### Process crash

The lock and staging metadata allow a later process or maintenance command to determine whether recovery is safe. A crash must not change `current.json` unless publication had already completed successfully.

### Cleanup failure

Cleanup is best-effort after publication. Failure to remove old or stale directories must not invalidate the newly published generation.

---

## Acceptance criteria

### Planning

- A pure plan resolver exists and has exhaustive unit coverage for all supported states.
- The plan is resolved before staging creation.
- Unknown or untrusted state selects a safe full rebuild or explicit failure.
- The resolved plan identifies graph, BM25, vector, seed, required artifact, and publication work.

### Zero-change

- A healthy zero-change analysis creates no staging directory.
- The active generation ID remains unchanged.
- `current.json` remains byte-identical and keeps the same modification time.
- Graph, BM25, vector, and metadata modification times remain unchanged.
- No generation reload is triggered.
- Instrumentation reports zero bytes copied.

### Selective seeding

- Graph is not copied when graph work is full.
- BM25 is not copied when BM25 work is full.
- Vector is cloned only when vector work is incremental or preserve is required for metadata-only publication.
- Vector is not copied when vector work is full.
- Metadata is written from current in-memory state rather than copied by default.
- Reflink failure falls back to normal copying without changing correctness.

### Atomicity

- Graph build failure leaves the active manifest unchanged.
- BM25 build failure leaves the active manifest unchanged.
- Vector build/update failure leaves the active manifest unchanged.
- Metadata validation failure leaves the active manifest unchanged.
- Manifest publication failure leaves the previous generation usable.
- A complete successful publication exposes all new artifacts together.

### Snapshot consistency

- A multi-artifact read resolves one generation exactly once.
- A request active during publication reads only its pinned generation.
- A later request may use the newly published generation.
- Index trust verification cannot combine metadata and DB paths from different generations.
- Server/MCP reload replaces the complete repository index state as one unit.

### Concurrency

- A valid active analysis lock prevents a second analysis.
- The second process creates no staging and performs no artifact writes.
- The lock is released after successful and failed analyses.
- Local dead-process stale locks can be recovered safely.
- Unknown-host locks are handled conservatively.
- One process cannot delete another active process's staging directory.

### Cleanup and retention

- The active generation is never deleted.
- Retention preserves the configured number of successful generations.
- Active and recent staging directories are preserved.
- Confirmed stale staging is removable.
- Cleanup supports dry-run diagnostics.
- Legacy flat artifacts are removed only through explicit trusted cleanup.

### Compatibility

- Generation V1 manifests remain readable.
- Legacy flat indexes remain migratable.
- Existing analyze flags continue to work.
- Existing HTTP and MCP contracts remain compatible.
- A 1.0.10 generation without incompatible schema changes remains usable after package rollback to 1.0.9 or has a documented manifest fallback.

### CI and release readiness

All required workflows must pass on the same release candidate commit:

- Quality;
- Test;
- Code Intel PR Impact;
- Export Source Snapshot;
- Release Readiness;
- package and lockfile version validation;
- distributable build and packed CLI validation;
- npm high/critical audit gate;
- zero-change no-publication regression;
- selective-seeding regression;
- concurrent-analysis regression;
- pinned-snapshot publication race regression;
- failed-publication rollback regression;
- stale-lock and staging-cleanup regression.

---

## Required test scenarios

### T1. Healthy zero-change repository

Given a trusted active generation and no source or configuration changes, running analyze must preserve the exact current manifest, create no staging, and copy zero bytes.

### T2. One changed source file with embeddings disabled

Graph and BM25 rebuild completely in staging. No old DB artifact is seeded. One new generation publishes after validation.

### T3. One changed source file with healthy embeddings

Graph and BM25 rebuild completely. Only `vector.db` is cloned. Vector entries for the changed path are deleted/upserted. One complete generation publishes.

### T4. Deleted source file with healthy embeddings

Graph and BM25 omit the deleted file. Vector entries for the deleted path are removed. The previous generation remains retained.

### T5. Forced full analysis

No old graph, BM25, or vector DB is copied. All enabled artifacts are rebuilt directly in staging.

### T6. Missing or stale vector state

The planner selects a full vector rebuild and does not seed the old vector artifact.

### T7. Analysis failure before publication

Given active generation A and staging B, a graph, BM25, vector, or metadata failure leaves `current.json` pointing to A and A remains queryable.

### T8. Concurrent analysis processes

Process A acquires the lock. Process B is rejected before staging creation. Process A completes without interference.

### T9. Publication during a read

A request pins generation A. Generation B publishes. The existing request uses only A; a later request uses B.

### T10. Safe staging cleanup

Given active staging, recent inactive staging, and abandoned stale staging, cleanup preserves the first two and removes only the abandoned staging according to policy.

### T11. Reflink fallback

Injected reflink failure causes normal copy fallback, and the resulting seeded vector artifact is valid.

### T12. Manifest V1 compatibility

A repository with an existing V1 manifest loads through the pinned snapshot resolver without an unnecessary publication.

### T13. Legacy flat migration

A complete flat index migrates into a validated generation. Legacy source files remain until explicit cleanup.

### T14. Lock recovery

A lock from a confirmed dead local PID can be recovered; a recent unverifiable remote-host lock is not silently removed.

---

## Expected implementation areas

The detailed design may refine module names, but the change is expected to affect:

```text
code-intel/core/src/cli/atomic-analyze.ts
code-intel/core/src/cli/app.ts
code-intel/core/src/cli/standalone-commands.ts
code-intel/core/src/storage/index-generation.ts
code-intel/core/src/storage/index-trust.ts
code-intel/core/src/storage/metadata.ts
code-intel/core/src/storage/index.ts
code-intel/core/src/search/bm25-index.ts
code-intel/core/src/search/vector-index.ts
code-intel/core/src/multi-repo/group-query.ts
code-intel/core/src/http/
code-intel/core/src/mcp-server/
```

Likely new shared modules:

```text
code-intel/core/src/pipeline/analysis-plan.ts
code-intel/core/src/storage/index-snapshot.ts
code-intel/core/src/storage/analyze-lock.ts
code-intel/core/src/storage/staging-cleanup.ts
```

Likely new test areas:

```text
code-intel/core/tests/unit/pipeline/analysis-plan.test.ts
code-intel/core/tests/unit/storage/index-snapshot.test.ts
code-intel/core/tests/unit/storage/analyze-lock.test.ts
code-intel/core/tests/unit/storage/staging-cleanup.test.ts
code-intel/core/tests/unit/storage/selective-generation-seeding.test.ts
code-intel/core/tests/integration/cli/analyze-zero-change-generation.test.ts
code-intel/core/tests/integration/cli/analyze-concurrency.test.ts
code-intel/core/tests/integration/storage/pinned-generation-read.test.ts
code-intel/core/tests/integration/storage/generation-publication-rollback.test.ts
```

These paths are directional; design and repository inspection may consolidate them to avoid unnecessary module churn.

---

## Risks and mitigations

### Risk: incorrect selective-seeding plan

An artifact required for incremental mutation could be omitted.

Mitigation:

- pure exhaustive planner tests;
- explicit required artifact list;
- pre-execution and pre-publication validation;
- full rebuild fallback when uncertainty exists.

### Risk: no-op detection misses required metadata work

The system could preserve an index that requires a migration.

Mitigation:

- parser, schema, embedding fingerprint, and metadata migration inputs are explicit planner inputs;
- no-op is allowed only when all relevant state is known healthy.

### Risk: reflink differences across filesystems

Some platforms do not support reflinks or implement them differently.

Mitigation:

- reflink is optional;
- normal copy is mandatory fallback;
- tests inject unsupported and failure behavior.

### Risk: lock recovery disrupts a live process

A long-running or remote process could appear stale.

Mitigation:

- process and host identity;
- activity timestamps;
- conservative TTL;
- explicit forced recovery when liveness is unknown.

### Risk: runtime closes an old generation too early

In-flight requests may still use the old snapshot during reload.

Mitigation:

- request-scoped snapshot ownership or reference counting;
- close old state only after active users release it;
- delay retention cleanup for locally leased generations if required.

### Risk: manifest evolution harms rollback

A V2-only manifest could be unreadable by 1.0.9.

Mitigation:

- keep existing required fields;
- make V2 additions optional where possible;
- do not change DB formats;
- document or implement compatible fallback parsing.

---

## Rollout strategy

1. Introduce the pure plan resolver with tests while preserving existing execution behavior.
2. Add pinned snapshot resolution and migrate trust/read paths.
3. Add repository analysis lock and ownership-aware staging metadata.
4. Move change detection and planning before staging creation.
5. Implement no-op early return.
6. Replace unconditional seeding with selective seeding.
7. Add reflink optimization with normal-copy fallback.
8. Update server/MCP repository reload to swap one complete loaded snapshot.
9. Replace blanket staging cleanup with stale/ownership-aware cleanup.
10. Add retention, legacy cleanup diagnostics, documentation, and release-readiness gates.

Each step must preserve atomic publication. The feature must not be released with plan-first staging enabled unless rollback, snapshot race, and concurrent-analysis tests pass.

---

## Rollback strategy

If 1.0.10 must be rolled back:

1. stop active Code Intel analysis processes;
2. inspect or remove a stale repository lock explicitly;
3. retain all successfully published generation directories;
4. restore the previous package version;
5. ensure `current.json` points to the last compatible generation;
6. run index trust/status verification;
7. verify one graph query, one BM25 symbol search, and one vector search when enabled.

Generation V2 must not mutate the active generation in place, so a failed rollout can return to a previously published generation.

---

## Success measures

The change is successful when:

- a healthy zero-change analysis publishes no generation and copies zero bytes;
- one-file source changes do not copy the old graph or BM25 databases;
- healthy vector indexes update only changed/deleted paths without full re-embedding;
- all multi-artifact operations use one pinned generation;
- concurrent analysis is rejected before staging creation;
- active staging cannot be deleted by another normal analyze process;
- failed analysis never changes the active generation;
- peak temporary disk use is materially reduced;
- existing CLI, HTTP, MCP, storage, and rollback behavior remains compatible.

---

## Final decision

Code Intel will keep immutable generation-based index publication because it provides the required crash safety, rollback, and artifact consistency boundary.

Version 1.0.10 will replace the current operational pattern:

```text
create staging first
copy every artifact
resolve artifact paths independently
allow competing analysis processes
clean staging by prefix
publish equivalent zero-change generations
```

with Generation V2:

```text
lock repository
pin active snapshot
plan all work first
return immediately for a true no-op
create staging only when publication is required
clone only artifacts required for incremental mutation
validate and publish atomically
swap complete reader state by generation
clean only stale, unowned staging
```

This proposal is intentionally limited to the OpenSpec proposal phase. Detailed implementation design, specification deltas, and executable task breakdown will be produced as follow-up artifacts after proposal review.
