# Design: Generation V2 — Planned, Pinned, and Serialized Index Publication

## 1. Context

### 1.1 Current v1.0.9 control flow

The public CLI entry point in `code-intel/core/src/cli/main.ts` routes every top-level `code-intel analyze` invocation through `runAtomicAnalyze()` unless the process is already the isolated atomic child.

The current flow is:

```text
main.ts
  └─ runAtomicAnalyze(args, binUrl)
       ├─ resolveAnalyzeWorkspaceRoot(args)
       ├─ createIndexGeneration(repoDir)
       ├─ seedIndexGeneration(repoDir, generation)
       │    └─ copy graph.db, bm25.db, vector.db, and meta.json when present
       ├─ spawn child with CODE_INTEL_INDEX_STAGING_DIR
       ├─ child executes existing analyze pipeline against staging
       ├─ read staging meta.json
       ├─ publishIndexGeneration(...)
       │    ├─ validate required artifacts
       │    ├─ rename staging directory to final generation directory
       │    ├─ atomically replace current.json
       │    └─ cleanupOldGenerations(...)
       └─ abortIndexGeneration(...) on failure
```

This flow correctly prevents a failed child analysis from mutating the currently published index. However, it creates and seeds staging before the child knows whether the run is a true no-op, and each artifact path helper may independently resolve `current.json`.

### 1.2 v1.0.9 vector behavior

Version 1.0.9 introduced `resolveEmbeddingUpdatePlan()` in `code-intel/core/src/search/embedding-update-plan.ts`. It separates vector update scope from graph execution mode:

- graph and BM25 may perform correctness-first full rebuilds;
- healthy vector indexes may update only changed/deleted paths;
- zero-change runs skip vector writes;
- force, missing vector state, stale state, incompatible fingerprint, or unknown change scope use a full vector rebuild.

Generation V2 MUST preserve this behavior. The purpose of this change is to avoid unnecessary generation work and make reads/concurrency safe; it is not a redesign of graph or vector semantics.

## 2. Design goals

1. Preserve atomic all-or-nothing publication of graph, BM25, vector, and metadata artifacts.
2. Resolve the complete work plan before creating staging.
3. Make a true zero-change analysis leave the active generation byte-for-byte unchanged.
4. Seed only artifacts that will be preserved or incrementally mutated.
5. Ensure every multi-artifact reader uses one pinned generation.
6. Serialize analysis mutation per repository.
7. Prevent cleanup from deleting active staging.
8. Preserve generation-v1 and legacy-flat compatibility.
9. Introduce no new runtime dependency.
10. Keep public CLI, HTTP, MCP, and web contracts backward compatible.

## 3. Non-goals

- Restoring selective graph incremental analysis.
- Changing graph schema, search ranking, vector model, or BM25 algorithm.
- Distributed locking across multiple machines sharing a network filesystem.
- Replacing LadybugDB or SQLite.
- Removing legacy flat artifacts automatically.
- Changing repository registration or group membership behavior.
- Adding user-visible generation management beyond status/cleanup/unlock maintenance commands required by this design.

## 4. Core invariants

### I1 — Published generations are immutable

After a generation becomes reachable through `current.json`, no analyze path may modify any artifact inside that generation.

### I2 — One manifest read defines one snapshot

A logical operation that needs multiple artifacts MUST read `current.json` once, derive every artifact path from the resulting `generationId`, and retain that snapshot until the operation completes.

### I3 — Publication is all-or-nothing

`current.json` MUST change only after all required staging artifacts validate and the staging directory has been renamed to its final immutable generation directory.

### I4 — No-op means no publication

When the planner returns `mode: 'noop'`, no staging directory, generation directory, artifact copy, artifact write, or manifest write may occur.

### I5 — One repository, one mutating analysis

At most one process may own the repository analysis lock and prepare/publish a generation at a time.

### I6 — Cleanup cannot remove active work

Automatic cleanup MUST preserve the current generation, retained previous generations, staging referenced by the active lock, and recent staging whose owner cannot safely be proven dead.

### I7 — Unknown state fails safe

When change scope, index compatibility, snapshot integrity, or seed requirements are uncertain, the planner MUST choose a full rebuild or fail before publication. It MUST NOT choose an unsafe incremental mutation.

## 5. Ownership boundaries

### 5.1 `storage/index-snapshot.ts` — read-side generation ownership

New module responsible for resolving one immutable generation snapshot.

```ts
export interface IndexSnapshot {
  readonly generationId: string;
  readonly generationDir: string;
  readonly manifestPath: string;
  readonly manifest: IndexGenerationManifest;
  readonly graphDbPath: string;
  readonly bm25DbPath: string;
  readonly vectorDbPath: string;
  readonly metadataPath: string;
}

export function resolveIndexSnapshot(repoDir: string): IndexSnapshot | null;
export function requireIndexSnapshot(repoDir: string): IndexSnapshot;
```

Responsibilities:

- read `current.json` exactly once;
- validate manifest structure and generation ID;
- resolve the generation directory under `.code-intel/generations`;
- reject path traversal and symlink escape attempts;
- return all artifact paths derived from the same generation directory;
- support generation-v1 and generation-v2 manifests;
- fall back to legacy flat paths only through an explicit legacy snapshot representation, never by mixing flat and generation paths.

It does not open databases or decide whether an index is trusted.

### 5.2 `pipeline/analysis-plan.ts` — work planning ownership

New pure module responsible for deciding whether publication is needed and which artifacts must be seeded.

```ts
export type GraphWorkMode = 'preserve' | 'full';
export type Bm25WorkMode = 'preserve' | 'full';
export type VectorWorkMode = 'disabled' | 'preserve' | 'incremental' | 'full';

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
    }
  | {
      mode: 'publish';
      reason: AnalysisPublishReason;
      graph: GraphWorkMode;
      bm25: Bm25WorkMode;
      vector: VectorWorkMode;
      changedPaths: string[];
      deletedPaths: string[];
      seedArtifacts: IndexArtifactName[];
      requiredArtifacts: IndexArtifactName[];
    };

export interface ResolveAnalysisPlanInput {
  force: boolean;
  hasPublishedSnapshot: boolean;
  changeSetKnown: boolean;
  changedPaths: string[];
  deletedPaths: string[];
  graphRequiresFullRebuild: boolean;
  embeddingsEnabled: boolean;
  vectorDbExists: boolean;
  vectorStateHealthy: boolean;
  vectorFingerprintCompatible: boolean;
  schemaMigrationRequired: boolean;
  parserMigrationRequired: boolean;
  metadataRewriteRequired: boolean;
}

export function resolveAnalysisPlan(input: ResolveAnalysisPlanInput): AnalysisPlan;
```

The planner MUST be deterministic and filesystem-write-free.

Decision order:

1. Initial analysis or missing published snapshot requires publication.
2. Explicit force requires full graph/BM25 and full vector when embeddings are enabled.
3. Required schema/parser migration requires publication and the migration-defined rebuild scope.
4. Unknown source change scope requires safe full rebuild.
5. Changed/deleted source paths require full graph/BM25; healthy vectors use incremental mutation.
6. Missing/stale/incompatible vector state requires full vector build.
7. Metadata-only changes require a new generation containing a complete immutable artifact set.
8. Only when no work is required may the planner return `noop`.

### 5.3 `storage/analyze-lock.ts` — mutation serialization ownership

New module responsible for repository-scoped exclusive analysis ownership.

```ts
export interface AnalyzeLockOwner {
  version: 1;
  pid: number;
  hostname: string;
  startedAt: string;
  baseGenerationId?: string;
  stagingGenerationId?: string;
}

export interface AnalyzeLock {
  readonly lockPath: string;
  readonly owner: AnalyzeLockOwner;
  update(patch: Partial<Pick<AnalyzeLockOwner, 'baseGenerationId' | 'stagingGenerationId'>>): void;
  release(): void;
}

export function acquireAnalyzeLock(
  repoDir: string,
  options?: { staleAfterMs?: number; now?: Date },
): AnalyzeLock;

export function readAnalyzeLock(repoDir: string): AnalyzeLockOwner | null;
export function removeStaleAnalyzeLock(repoDir: string, options: StaleLockOptions): boolean;
```

The lock MUST be acquired with exclusive file creation (`wx`) before staging creation or artifact writes.

The normal command behavior is fail-fast. Waiting/retry is not part of v1.0.10.

### 5.4 `storage/index-generation.ts` — write-side generation ownership

Existing module remains responsible for staging creation, validation, final rename, manifest publication, abort, migration, retention, and artifact cloning.

Changes:

- replace unconditional seeding with selected artifact cloning;
- add generation-v2 manifest support;
- stop blanket deletion of every `.staging-*` directory;
- separate successful-generation retention from stale-staging cleanup;
- validate artifact containment under the expected generation directory;
- expose clone diagnostics.

Suggested symbols:

```ts
export interface CloneArtifactResult {
  artifact: IndexArtifactName;
  mode: 'reflink' | 'copy';
  logicalBytes: number;
  physicalBytesCopied: number;
}

export function cloneArtifact(source: string, target: string): CloneArtifactResult;

export function seedIndexGeneration(args: {
  snapshot: IndexSnapshot;
  generation: IndexGeneration;
  artifacts: IndexArtifactName[];
}): CloneArtifactResult[];

export function validateIndexGeneration(args: {
  generation: IndexGeneration;
  metadata: IndexMetadata;
  requiredArtifacts: IndexArtifactName[];
}): void;
```

### 5.5 `cli/atomic-analyze.ts` — orchestration ownership

`runAtomicAnalyze()` remains the outer process boundary but is refactored into explicit stages.

Suggested internal symbols:

```ts
export function runAtomicAnalyze(args: string[], binUrl: URL): number;
export function resolveAtomicAnalyzePreflight(args: string[], repoDir: string): AtomicAnalyzePreflight;
export function runPlannedAnalyze(preflight: AtomicAnalyzePreflight, binUrl: URL): number;
```

The parent process owns:

- lock acquisition/release;
- current snapshot pinning;
- preflight change/config/schema detection sufficient to resolve a plan;
- no-op return;
- staging creation;
- selected seeding;
- child execution;
- final validation/publication;
- safe cleanup after lock release.

The child process owns existing graph/BM25/vector construction against the provided staging directory. The parent passes the resolved plan through a versioned JSON plan file or environment variable. A file is preferred to avoid environment-size limits and to provide inspectable failure evidence.

Suggested path:

```text
<stagingDir>/analysis-plan.json
```

The child MUST validate the plan version before using it.

## 6. Proposed control flow

```text
main.ts
  └─ runAtomicAnalyze()
       ├─ resolve workspace
       ├─ acquireAnalyzeLock()
       ├─ resolveIndexSnapshot()
       ├─ detect source/config/schema state
       ├─ resolveAnalysisPlan()
       │
       ├─ if noop
       │    ├─ emit preserved-generation diagnostic
       │    ├─ release lock
       │    └─ return 0
       │
       ├─ createIndexGeneration()
       ├─ update lock with staging generation ID
       ├─ seedIndexGeneration(selected artifacts only)
       ├─ write analysis-plan.json
       ├─ spawn atomic child
       ├─ read and validate staged metadata
       ├─ validateIndexGeneration()
       ├─ publishIndexGeneration()
       ├─ release lock
       ├─ cleanup retained generations
       ├─ cleanup stale staging
       └─ return status
```

All error paths use `finally` to release the lock if the current process still owns it.

## 7. Planning matrix

| State | Graph | BM25 | Vector | Seed | Publish |
|---|---|---|---|---|---|
| Initial, embeddings off | full | full | disabled | none | yes |
| Initial, embeddings on | full | full | full | none | yes |
| Healthy, no changes | preserve | preserve | preserve/disabled | none | no |
| Source changed, embeddings off | full | full | disabled | none | yes |
| Source changed, healthy vectors | full | full | incremental | vector.db | yes |
| Source deleted, healthy vectors | full | full | incremental | vector.db | yes |
| Force, embeddings off | full | full | disabled | none | yes |
| Force, embeddings on | full | full | full | none | yes |
| Vector missing/stale/incompatible | as required | as required | full | none | yes |
| Change scope unknown | full | full | full when enabled | none | yes |
| Metadata-only migration | preserve | preserve | preserve | graph.db, bm25.db, vector.db when present | yes |

A metadata-only publication must still produce an immutable complete generation. It may clone preserved artifacts because mutating `meta.json` inside the current generation violates invariant I1.

## 8. True no-op semantics

A no-op is allowed only when all of the following are true:

- a valid current snapshot exists;
- source change scope is known;
- changed and deleted path sets are empty;
- no force flag is active;
- no schema migration is required;
- no parser migration is required;
- embedding mode/fingerprint/state requires no work;
- no metadata rewrite is required;
- required artifacts are present and trusted.

No-op output in normal mode:

```text
✓ No source or index changes detected
✓ Active generation preserved: <generation-id>
```

Verbose mode additionally prints the plan.

The no-op path MUST NOT update `indexedAt`, repository registry timestamps, or metadata counters if doing so would require publishing a logically identical generation. Status surfaces should distinguish `lastCheckedAt` from immutable `indexedAt` if a later change needs check-time reporting.

## 9. Selective artifact seeding

### 9.1 Full graph/BM25 rebuild

Do not seed `graph.db` or `bm25.db`. The child creates them directly in staging.

### 9.2 Incremental vector update

Seed only `vector.db`, including database sidecars only when the storage implementation requires them after a clean close. The parent MUST ensure the source database is closed/checkpointed before cloning or use the vector store's backup API when needed.

### 9.3 Full vector rebuild

Do not seed `vector.db`.

### 9.4 Metadata

Previous metadata is loaded into memory from the pinned snapshot. New metadata is written directly to staging. `meta.json` is not copied merely as a transport mechanism.

### 9.5 Metadata-only publication

Clone every preserved database artifact required by the new manifest, then write new metadata. This is the only normal case where graph/BM25 may be cloned despite no source rebuild.

## 10. Reflink and copy fallback

`cloneArtifact()` attempts:

1. `COPYFILE_FICLONE_FORCE`;
2. `COPYFILE_FICLONE`;
3. normal `copyFileSync`.

Correctness MUST be identical for every mode.

The implementation MUST NOT assume reflink implies zero physical writes on every filesystem. Diagnostics report:

- logical bytes cloned;
- clone mode;
- physical bytes copied as known by the implementation (`0` for successful reflink, source size for normal copy).

Clone failure aborts before the child starts.

## 11. Snapshot pinning and reader migration

### 11.1 Storage helpers

Existing helpers such as `getDbPath(repoDir)`, `getBm25DbPath(repoDir)`, `getVectorDbPath(repoDir)`, and `loadMetadata(repoDir)` remain for compatibility but MUST delegate through a snapshot when used for published reads.

New overloads or explicit functions accept `IndexSnapshot`:

```ts
loadMetadataFromSnapshot(snapshot: IndexSnapshot): IndexMetadata | null;
getDbPath(snapshot: IndexSnapshot): string;
getBm25DbPath(snapshot: IndexSnapshot): string;
getVectorDbPath(snapshot: IndexSnapshot): string;
```

Write paths continue to honor `CODE_INTEL_INDEX_STAGING_DIR` inside the atomic child. Read and write APIs must be named distinctly enough to prevent accidental writes into a published generation.

### 11.2 Trust verification

`verifyIndexTrust(repoDir)` MUST:

1. resolve one snapshot;
2. read metadata from that snapshot;
3. inspect graph/BM25/vector paths from that same snapshot;
4. report the pinned `generationId`;
5. never mix artifacts from a later manifest publication.

### 11.3 CLI one-shot commands

Each command pins one snapshot at invocation start and passes it through graph/search initialization.

### 11.4 HTTP and MCP runtime

Introduce a cohesive runtime holder:

```ts
export interface LoadedRepositoryIndex {
  readonly snapshot: IndexSnapshot;
  readonly metadata: IndexMetadata;
  readonly graph: KnowledgeGraph;
  readonly bm25: Bm25Index;
  readonly vector?: VectorIndex;
  acquire(): RepositoryIndexLease;
  closeWhenUnused(): Promise<void>;
}
```

Reload sequence:

1. detect that `current.json.generationId` differs from the loaded snapshot;
2. resolve snapshot B once;
3. open and validate all required B artifacts;
4. construct a complete `LoadedRepositoryIndex` B;
5. atomically replace the repository runtime reference;
6. mark A for close after existing leases release.

A request that acquired A completes with A. New requests acquire B.

If B fails to open or validate, the runtime continues serving A and reports reload failure; it does not partially replace components.

## 12. Analysis lock design

### 12.1 Path and format

```text
.code-intel/analyze.lock
```

```json
{
  "version": 1,
  "pid": 12345,
  "hostname": "host",
  "startedAt": "2026-08-03T04:30:00.000Z",
  "baseGenerationId": "generation-a",
  "stagingGenerationId": "generation-b"
}
```

### 12.2 Acquisition

- create parent `.code-intel` directory if needed;
- open with `wx`;
- write owner JSON;
- fsync/close where practical;
- return ownership token.

If the file exists, parse and report owner details. Do not create staging.

### 12.3 Release

The lock object records the file identity/content written at acquisition. `release()` removes the file only if it still represents the same owner. This prevents an old process from deleting a replacement lock.

### 12.4 Process liveness

For same-host owners, use `process.kill(pid, 0)` with platform-aware error handling.

For different-host owners, automatic liveness determination is not trusted. Age alone does not permit immediate deletion unless the configured stale threshold is exceeded and no active staging heartbeat exists.

### 12.5 Maintenance command

Add:

```bash
code-intel index unlock
code-intel index unlock --force
```

Without `--force`, removal succeeds only when the lock is provably stale. With `--force`, print owner information and remove explicitly.

## 13. Staging ownership and cleanup

Every staging directory includes `staging.json`:

```ts
export interface StagingManifest {
  version: 1;
  generationId: string;
  baseGenerationId?: string;
  pid: number;
  hostname: string;
  createdAt: string;
  lastActivityAt: string;
}
```

The parent updates `lastActivityAt` at phase boundaries communicated by the child or at least before/after the child process.

Cleanup rules:

- current process may delete its own staging during abort;
- retain staging referenced by the active lock;
- retain recent staging younger than TTL;
- retain cross-host staging unless stale by TTL and not referenced by the lock;
- remove abandoned staging only after containment validation;
- never follow symlinks outside the generations root;
- report removed/preserved paths in verbose mode.

`cleanupOldGenerations()` is split into:

```ts
cleanupPublishedGenerations(...)
cleanupStaleStaging(...)
```

## 14. Manifest v2

```ts
export interface IndexGenerationManifestV2 {
  version: 2;
  generationId: string;
  publishedAt: string;
  baseGenerationId?: string;
  schemaVersion?: number;
  parser?: 'tree-sitter' | 'regex';
  artifacts: Partial<Record<IndexArtifactName, {
    required: boolean;
    size: number;
    fingerprint?: string;
  }>>;
}
```

Reader compatibility:

- missing `version` is interpreted as v1;
- v1 `artifacts: string[]` is normalized in memory;
- v1 is not rewritten during a no-op;
- the next real publication writes v2.

Fingerprints are optional in v1.0.10. Required validation remains size, existence, containment, metadata compatibility, and database-specific integrity checks already available. Hashing a large vector DB is not mandatory because it would negate performance goals.

## 15. Publication and failure semantics

### 15.1 Before child execution

Failures in lock acquisition, snapshot resolution, planning, staging creation, seeding, or plan-file writing:

- do not change current manifest;
- delete only staging owned by the current process;
- release the lock;
- return non-zero with actionable diagnostics.

### 15.2 Child failure

- preserve current generation;
- remove owned staging;
- release lock;
- propagate child exit status when available.

### 15.3 Validation failure

- preserve current generation;
- keep or remove staging according to debug policy; default remove;
- report the exact missing/empty/incompatible artifact;
- release lock.

### 15.4 Manifest write failure after final rename

The final generation directory may exist but remain unreachable. `current.json` still points to the old generation. Cleanup may remove the unreachable directory later as abandoned unpublished state.

### 15.5 Runtime reload failure

Keep serving the previously loaded generation and expose reload diagnostics. Do not roll back `current.json`; the publication itself may be valid even if one process cannot open it. Subsequent requests/restarts retry.

## 16. Observability

### 16.1 Verbose plan output

```text
Analysis plan:
  mode: publish
  reason: source-changed
  base generation: generation-a
  graph: full
  BM25: full
  vector: incremental
  changed paths: 1
  deleted paths: 0
  seed artifacts: vector.db
```

No-op:

```text
Analysis plan:
  mode: noop
  reason: no-changes
  active generation: generation-a
```

### 16.2 Profile fields

Extend profile output with:

```ts
interface GenerationProfile {
  baseGenerationId?: string;
  publishedGenerationId?: string;
  planMode: 'noop' | 'publish';
  planReason: string;
  seedArtifacts: IndexArtifactName[];
  cloneResults: CloneArtifactResult[];
  logicalBytesCloned: number;
  physicalBytesCopied: number;
  lockWaitMs: number;
}
```

Fail-fast locking normally produces near-zero lock wait.

### 16.3 Trust/status output

Index status includes the pinned generation ID and manifest version. Existing fields remain compatible.

## 17. Security and path safety

- Resolve the repository root and `.code-intel/generations` root with absolute paths.
- Reject generation IDs containing path separators, `..`, null bytes, or unsupported characters.
- Validate `path.relative(generationsRoot, candidate)` does not escape the root.
- Treat symlinked generation/staging directories conservatively; do not recursively delete through a symlink.
- Parse lock, staging, and manifest JSON with structural validation.
- Never put credentials, source contents, or environment secrets in lock/plan/staging manifests.
- Plan files are internal data, not executable input.

## 18. Alternatives considered

### A. Remove generations and atomically rename each DB

Rejected. Independent renames still permit graph/BM25/vector/metadata combinations from different analysis states and weaken rollback.

### B. Keep current always-copy behavior

Rejected. It preserves correctness but causes O(total index size) disk work for no-op and one-file vector updates.

### C. Mutate current generation in place for no-op or metadata-only updates

Rejected. It violates immutable publication and makes readers observe changes without a generation transition.

### D. Resolve `current.json` separately for every helper and rely on rename atomicity

Rejected. Atomic pointer writes do not prevent one operation from resolving different generations across calls.

### E. Allow concurrent staging and serialize only final publication

Rejected for v1.0.10. It wastes compute, creates cleanup races, and permits an older analysis to publish after a newer one. Repository-level serialization is simpler and safer.

### F. Use a third-party lock package

Rejected. The repository does not need a new runtime dependency; exclusive file creation and explicit owner metadata are sufficient for local serialization.

### G. Hard-link databases instead of reflink/copy

Rejected. Incremental mutation of a hard-linked database would modify the published generation and violate immutability.

### H. Hash all artifacts before publication

Deferred. Full hashing of large vector databases can be expensive. Existing integrity checks plus size/metadata/generation identity are sufficient for this release; optional fingerprints remain extensible.

## 19. Migration

### 19.1 Generation v1

- normalize v1 manifest to `IndexSnapshot` in memory;
- do not rewrite on no-op;
- publish v2 on the next real index publication;
- retain v1 generation directories unchanged.

### 19.2 Legacy flat index

- existing migration continues to create a validated generation;
- migration must acquire the analysis lock;
- legacy source artifacts remain after migration;
- removal is explicit through `code-intel index cleanup --remove-legacy`.

### 19.3 Rollback to v1.0.9

Artifact database formats remain unchanged. A v2 `current.json` could be unknown to v1.0.9, so either:

1. keep v2 fields backward-compatible with v1 expectations, especially `generationId`, `publishedAt`, and an artifact-name list; or
2. write a compatibility projection accepted by v1.0.9.

Chosen approach: retain the existing top-level `artifacts: IndexArtifactName[]` field and add optional `artifactDetails` for v2 metadata. This avoids breaking v1.0.9 readers.

Revised v2 interface:

```ts
interface IndexGenerationManifestV2 {
  version: 2;
  generationId: string;
  publishedAt: string;
  artifacts: IndexArtifactName[];
  artifactDetails?: Partial<Record<IndexArtifactName, {
    required: boolean;
    size: number;
    fingerprint?: string;
  }>>;
  baseGenerationId?: string;
  schemaVersion?: number;
  parser?: 'tree-sitter' | 'regex';
}
```

## 20. Test strategy

### 20.1 Unit tests

`tests/unit/pipeline/analysis-plan.test.ts`

- exhaustive decision table;
- deterministic deduplication/sorting of paths;
- unsafe/unknown state chooses full rebuild;
- no-op only under complete stable conditions;
- seed list exactly matches work modes.

`tests/unit/storage/index-snapshot.test.ts`

- one manifest read yields one generation;
- v1/v2 normalization;
- missing/invalid manifest;
- path traversal and symlink containment rejection;
- legacy snapshot compatibility.

`tests/unit/storage/analyze-lock.test.ts`

- exclusive acquisition;
- active owner error details;
- same-host dead PID recovery;
- cross-host conservative behavior;
- owner-safe release;
- force unlock.

`tests/unit/storage/index-generation.test.ts`

- selective seeding;
- no seed for full rebuild;
- reflink then copy fallback;
- manifest v2 compatibility;
- publication validation;
- current generation retention.

`tests/unit/storage/staging-cleanup.test.ts`

- active staging preserved;
- recent staging preserved;
- stale abandoned staging removed;
- symlink/path escape rejected;
- published generation never removed.

### 20.2 Integration tests

`tests/integration/cli/analyze-zero-change-generation.test.ts`

Assert generation ID, current.json bytes/mtime, artifact mtimes, generation directory count, and copied-byte diagnostics remain unchanged.

`tests/integration/cli/analyze-selective-seeding.test.ts`

For one changed file with healthy vectors, assert graph/BM25 are newly built, only vector is cloned, and embedding work includes only changed paths.

`tests/integration/cli/analyze-concurrency.test.ts`

Hold the lock in process A, start process B, assert B exits non-zero, creates no staging, and does not alter A.

`tests/integration/storage/pinned-generation-read.test.ts`

Pause a read after snapshot A resolves, publish B, resume and assert every artifact path remains under A; a new read resolves B.

`tests/integration/storage/generation-publication-rollback.test.ts`

Inject graph, BM25, vector, metadata, validation, and manifest-write failures; reopen persisted artifacts and assert old generation remains usable.

### 20.3 Runtime tests

HTTP/MCP reload tests construct A, publish B during in-flight request, verify old request completes against A and new request uses B. Inject B-open failure and verify A remains active.

### 20.4 Performance gates

- zero-change copied bytes = 0;
- force rebuild seeded artifacts = 0;
- one-file healthy-vector update does not copy graph/BM25;
- when reflink is available, physical copied bytes for vector = 0;
- normal copy fallback remains bounded to selected vector artifact only.

## 21. Implementation sequence

1. Add plan and snapshot pure primitives with unit tests.
2. Add selective seeding and manifest compatibility.
3. Add repository lock and staging ownership.
4. Refactor atomic analyze preflight/no-op flow.
5. Migrate trust and one-shot readers to pinned snapshots.
6. Migrate long-lived HTTP/MCP runtime to cohesive snapshot reload.
7. Add cleanup/unlock maintenance commands.
8. Add integration, failure, race, and performance tests.
9. Update documentation, release notes, package version, and release gates.

## 22. Decision summary

Generation V2 keeps the safety property of immutable generation publication but changes the preparation and consumption model:

```text
plan first
lock once
pin once
stage only when needed
clone only what must survive
publish atomically
reload as one unit
clean only proven stale state
```

This is the selected design for Code Intel 1.0.10.