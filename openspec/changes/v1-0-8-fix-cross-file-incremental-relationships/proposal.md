# Proposal: Preserve Cross-File Relationships During Incremental Analysis

## Problem
Incremental node removal cascades incoming and outgoing edges. Unchanged callers, importers, and inheritors are not currently re-resolved, so cross-file relationships can be lost. Generated cluster and flow nodes can also remain stale. Vector fallback reporting also cannot distinguish an unavailable vector index from a vector query failure.

## Goals
- Prevent publication of a partially re-resolved graph.
- Preserve cross-file calls, imports, extends, implements, clusters, and flows.
- Preserve the zero-change incremental fast path.
- Distinguish `VECTOR_INDEX_UNAVAILABLE` from `VECTOR_QUERY_FAILED`.

## v1.0.8 design
For a safe go-live fix, any non-empty changed/deleted set falls back to a clean full rebuild. This guarantees that all source relationships and generated derived state are reconstructed consistently. A future release may restore selective incremental processing using dependency-closure re-resolution.

Hybrid search returns explicit vector execution status. Missing or unbuilt indexes map to `VECTOR_INDEX_UNAVAILABLE`; execution exceptions map to `VECTOR_QUERY_FAILED`; a legitimate empty vector result is not reported as a failure.

## Release criteria
- Changed/deleted source sets trigger a clean full rebuild.
- Zero-change analysis keeps its fast path.
- Cross-file relationship fixtures match a clean rebuild.
- Missing vector index and vector query failure return different reasons.
- Quality, Test, PR Impact, and Release Readiness pass on the same commit.