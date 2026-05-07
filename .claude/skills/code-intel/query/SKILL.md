---
name: query
description: "Covers the **query** subsystem of code-intel-platform. 65 symbols across 9 files. Key symbols: `parse`, `summarizeCluster`, `computePRImpact`. Internal call density: 1.1 calls/symbol. Participates in 4 execution flow(s)."
---

# query

> **65 symbols** | **9 files** | path: `code-intel/core/src/query/` | call density: 1.1/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/query/`
- The user mentions `parse`, `summarizeCluster`, `computePRImpact` or asks how they work
- Adding, modifying, or debugging query-related functionality
- Tracing call chains that pass through the query layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/query/gql-parser.ts` | `Token`, `WhereExpr`, `WhereClause`, `FindStatement` +(24) | 10 exported |
| `code-intel/core/src/query/gql-executor.ts` | `CountGroup`, `GQLResult`, `withTimeout`, `getNodeProperty` +(7) | 3 exported |
| `code-intel/core/src/query/saved-queries.ts` | `SavedQueryInfo`, `getQueriesDir`, `ensureQueriesDir`, `saveQuery` +(4) | 6 exported |
| `code-intel/core/src/query/health-report.ts` | `HealthReportResult`, `computeHealthReport`, `inScope`, `dfs` | 4 exported |
| `code-intel/core/src/query/cluster-summary.ts` | `ClusterSummaryResult`, `getPathPrefix`, `summarizeCluster` | 2 exported |
| `code-intel/core/src/query/pr-impact.ts` | `PRImpactResult`, `parseDiffFiles`, `computePRImpact` | 3 exported |
| `code-intel/core/src/query/similar-symbols.ts` | `SimilarSymbol`, `levenshtein`, `findSimilarSymbols` | 2 exported |
| `code-intel/core/src/query/suggest-tests.ts` | `SuggestTestsResult`, `getSuggestedCases`, `suggestTests` | 2 exported |
| `code-intel/core/src/query/explain-relationship.ts` | `ExplainRelationshipResult`, `explainRelationship` | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `parse` | method | 55 | 6 | `query/gql-parser.ts` |
| `summarizeCluster` | function | 2 | 10 | `query/cluster-summary.ts` |
| `computePRImpact` | function | 4 | 8 | `query/pr-impact.ts` |
| `executePATH` | function | 1 | 10 | `query/gql-executor.ts` |
| `isGQLParseError` | function | 11 | 0 | `query/gql-parser.ts` |
| `peek` | method | 10 | 0 | `query/gql-parser.ts` |
| `consume` | method | 10 | 0 | `query/gql-parser.ts` |
| `findSimilarSymbols` | function | 2 | 8 | `query/similar-symbols.ts` |
| `explainRelationship` | function | 2 | 7 | `query/explain-relationship.ts` |
| `executeTRAVERSE` | function | 1 | 7 | `query/gql-executor.ts` |
| `executeCOUNT` | function | 1 | 7 | `query/gql-executor.ts` |
| `executeGQL` | function | 4 | 4 | `query/gql-executor.ts` |

## Execution Flows

**4** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect parse
# Blast radius for entry point
code-intel impact parse
# Search this area
code-intel search "query"
```
