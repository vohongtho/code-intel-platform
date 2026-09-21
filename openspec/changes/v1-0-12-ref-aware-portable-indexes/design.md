# Design: Ref-Aware and Portable Indexes

## Existing models
Active reads pin Generation V2. Alternate refs use `SemanticSnapshotDescriptor` and cache entries under `.code-intel/snapshots`. `snapshot-builder.ts` already uses the normal analyzer and `verifySnapshotReadBack`.

## New modules
- `code-intel/core/src/storage/index-view.ts`;
- `code-intel/core/src/storage/index-view-resolver.ts`;
- `code-intel/core/src/snapshots/portable-format.ts`;
- `code-intel/core/src/snapshots/export-import.ts`.

Suggested contract:
```ts
interface ReadIndexView {
  kind: 'generation' | 'semantic-snapshot';
  identity: string;
  repositoryIdentity: string;
  graphDbPath: string;
  bm25DbPath: string;
  vectorDbPath?: string;
  evidenceDbPath?: string;
  metadataPath: string;
  descriptor: object;
  boundaries: readonly AnalysisBoundary[];
  release(): void;
}
```

## View resolution and locking
`resolveReadIndexView({repoDir, ref?, allowBuild})`:
- no ref -> pin active Generation;
- ref -> use existing snapshot service/cache;
- acquire a cache read-pin so eviction cannot delete the directory mid-request;
- release after the transport-independent operation completes.

Snapshot build locks and eviction logic remain owned by `snapshots/cache.ts`; do not add a parallel lock manager.

## Search integration
BM25 opens from the selected view. Vector mode checks that same view's metadata/artifact. On-demand semantic snapshots currently use `--skip-embeddings`, so vector-preferred requests normally report BM25 fallback unless a compatible imported/prebuilt vector exists.

Using the active generation's vector DB to rank symbols from another ref is forbidden.

## Portable format
Use a deterministic archive with `PortableIndexManifestV1`:
- format/schema version;
- semantic snapshot descriptor;
- repository identity;
- Code Intel/analyzer versions;
- artifact array {name,size,sha256,required};
- privacy profile;
- capabilities {sourceContent,bm25,vector,evidence}.

Only allowlisted artifacts may be exported/imported.

## Import flow
```text
open package
 -> bound manifest/count/size
 -> reject unsafe paths/symlinks
 -> extract allowlisted files to snapshot staging
 -> verify every hash/size
 -> validate repository identity + semantic descriptor/fingerprints
 -> verifySnapshotReadBack
 -> atomically publish snapshot cache entry
 -> optional local pin
```

No active Generation mutation occurs.

## Metadata-only export
Do not mutate binary DB bytes. Load graph, remove content fields according to a versioned privacy transform, write a new export-only graph DB, reopen it, and set capability boundaries. BM25 may need rebuild/omission depending on content policy; manifest must state the result.

## Ref-aware public contracts
Add optional `ref` to repo-selectable read MCP tools and corresponding HTTP/CLI query contracts. Responses using non-current state include compact `indexView` identity/ref metadata.

## Web diff
Add API types/client and a graph-diff route/page. Large results remain paginated/virtualized. The server remains authoritative for continuity/compatibility/coverage.

## Failure semantics
Unknown ref -> error/boundary, no current fallback.
Missing vector -> requested/actual search-mode fallback.
Corrupt import -> staging deleted.
Incompatible schema/analyzer -> rejected with remediation.
Eviction race -> blocked by active read pin.

## Migration
Prefer separate local pin/import metadata so `SNAPSHOT_SCHEMA_VERSION` and content-derived `snapshotId` remain unchanged. Bump schema only if cache entry semantics truly change.

## Tests
Add index-view unit tests, ref-aware query integration, portable format/tamper/traversal tests, concurrent eviction/pin tests, deterministic package-manifest tests, and Web graph-diff component/e2e coverage.
