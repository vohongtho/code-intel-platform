# Proposal: Preserve Cross-File Relationships During Incremental Analysis

## Problem
Incremental node removal cascades incoming and outgoing edges. Unchanged callers, importers, and inheritors are not currently re-resolved, so cross-file relationships can be lost. Generated cluster and flow nodes can also remain stale. Vector fallback reporting also cannot distinguish an unavailable vector index from a vector query failure.

## Goals
- Preserve cross-file calls, imports, extends, and implements relationships.
- Rebuild cluster and flow derived state from a clean baseline.
- Parse changed files once while resolving the complete impacted closure.
- Distinguish VECTOR_INDEX_UNAVAILABLE from VECTOR_QUERY_FAILED.

## Design
- Collect source files of incoming semantic edges before removing changed or deleted nodes.
- Expand the resolve set with those unchanged dependent files.
- Rebuild file content and function indexes for dependent files without rebuilding their AST nodes.
- Remove generated cluster and flow nodes before regeneration.
- Return vector execution status from hybridSearch and map fallback reasons accurately.

## Release criteria
- Incremental graph equals a clean full rebuild for cross-file calls, imports, inheritance, and flows.
- Repeated incremental runs are idempotent.
- Missing vector index and vector query failure return different reasons.
- Quality, Test, PR Impact, and Release Readiness pass on the same commit.