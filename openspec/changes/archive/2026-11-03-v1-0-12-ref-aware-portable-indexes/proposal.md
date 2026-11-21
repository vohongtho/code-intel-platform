# v1.0.12: Ref-Aware and Portable Indexes

## Change ID
`v1-0-12-ref-aware-portable-indexes`

## Feature IDs
F04, F10, F20

## Priority
P0/P1

## Summary
Turn the v1.0.11 semantic-snapshot engine into a first-class read source for normal intelligence queries, add a validated portable index package for team/CI reuse, and extend the existing Web graph-diff experience with stable-flow and selected-index evidence.

## Source-verified baseline
`code-intel/core/src/snapshots/*` already safely resolves committed refs, materializes throwaway worktrees, runs the normal analyzer into isolated artifacts, validates graph/BM25/vector/evidence read-back, caches snapshots, and never mutates Generation V2. Snapshot artifacts already include `graph.db`, `bm25.db`, optional `vector.db`, `evidence.db`, metadata and semantic index files.

`graph_diff` and semantic-snapshot PR impact already compare refs. The remaining gaps are:
1. normal read tools do not consistently accept a ref;
2. snapshots are not portable/shareable as a supported artifact;
3. the existing Web `/diff` page renders ref descriptors, paginated node/relationship deltas, certainty, contract findings and coverage, but stable flow deltas remain unavailable until flow identity is stabilized and selected-index metadata is not yet shared across normal read tools.

## Ref-aware read behavior
Applicable read-only tools gain optional `ref`. Omitted `ref` preserves active-generation semantics. Provided `ref` resolves/builds/reuses the existing semantic snapshot and pins one immutable view for the whole request.

A query against an alternate ref SHALL never:
- change the user's checkout/HEAD/index;
- read active-generation vectors for alternate-ref semantic data;
- silently fall back to current state if the ref fails.

## Read index abstraction
Introduce one transport-independent `ReadIndexView` representing:
- active Generation V2, or
- immutable semantic snapshot.

This is an adapter over existing artifacts, not a third storage engine.

## Portable index workflow
```bash
code-intel index refs
code-intel index export --ref main --output service-main.cidx
code-intel index import service-main.cidx --pin
```

A `.cidx` package contains:
- versioned manifest;
- semantic snapshot descriptor;
- graph/BM25/evidence/meta artifacts;
- optional vector artifact;
- content fingerprints;
- artifact hashes/sizes;
- analyzer/package/schema fingerprints;
- privacy profile and resulting capability flags.

Import treats the file as untrusted input, validates into snapshot staging, reopens artifacts, and only then publishes a snapshot-cache entry. It never automatically advances active Generation V2.

## Privacy profiles
`full`: indexed source/snippet content preserved.
`metadata-only`: source content removed through a controlled graph rewrite/readback, not byte patching; source-dependent capabilities are marked unavailable.

The export manifest SHALL state the privacy profile and capability consequences.

## Repository identity
Package binds to canonical repository identity plus Git tree/commit. Import into a different repo identity fails by default. Repository adoption/remapping is out of scope for the first release.

## Web graph diff
Extend the existing `GraphDiffPage` and its existing HTTP client/types only where the backend adds:
- stable flow deltas from `v1-0-12-change-risk-and-test-intelligence`;
- selected-index/ref identity metadata needed to explain the compared views;
- regression coverage for paginated, partial and candidate-continuity responses.

The Web must not reimplement diff classification.

## Cache lifecycle
Imported snapshots participate in normal cache retention. A local `pinned` marker may protect a shared snapshot from eviction; pin/origin metadata must not change semantic snapshot identity.

## Security
Bound manifest and archive entries, prevent path/symlink escape, verify hashes before DB open, open imported DBs read-only for verification, validate identity/schema/fingerprints, and never import executable hooks/plugins.

## Performance gates
A cached-ref query avoids Git/analyze. Once opened, snapshot query overhead should be comparable to active generation. Export/import scales linearly with artifact bytes and has explicit max-size controls.

## Non-goals
Dirty working-tree refs; writing/refactoring alternate refs; replacing Generation V2; automatically activating imported indexes; cloud index hosting.
