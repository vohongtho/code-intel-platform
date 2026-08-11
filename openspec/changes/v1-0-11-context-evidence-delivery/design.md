# Design: Existing Context Evidence Selection and Delivery

## Observed v1.0.10 context flow

`context/builder.ts::build()` produces `[SUMMARY]`, `[LOGIC]`, `[RELATION]`, and `[FOCUS CODE]` using token presets and final `enforceContextBudget()`. This hard-budget behavior is retained.

`DedupeRegistry` currently keys `seenSymbols` and `logicSymbols` by `name`, and call-pair dedupe by caller/callee name strings. Those keys are unsafe after canonical identity exposes multiple same-name symbols.

## Shared selector

Use the identity proposal's `SymbolSelection` rather than first-match name lookup. Existing simple-name request can resolve exact only when unambiguous or contextual evidence proves the candidate.

## Request contract

Current request remains valid. Add optional task intent:

```ts
interface ContextRequest {
  symbols: string[];
  task?: string;
  // existing optional fields unchanged
}
```

If `task` exists, `detectQueryIntent(task)` and candidate relevance use it. Do not infer engineering intent from symbol spelling alone.

## Identity-based dedupe

Refactor `DedupeRegistry`:

```ts
class DedupeRegistry {
  private seenArtifacts = new Set<string>();
  private seenCallPairs = new Set<string>();
  private logicArtifacts = new Set<string>();
}
```

Keys are canonical IDs or stable artifact identities, not display names. Display names remain rendering values.

## Evidence allocation pipeline

```text
seed selection
  -> candidate retrieval
  -> semantic/trust relevance
  -> per-artifact reservation
  -> source realization
  -> final hard budget enforcement
  -> delivery receipt
```

Track internally:

```ts
interface ContextAllocationReceipt {
  artifactId: string;
  namedByUser: boolean;
  relevanceScore: number;
  certainty?: string;
  reservedTokens: number;
  deliveredTokens: number;
  deliveryMode: 'full' | 'window' | 'pointer' | 'omitted';
  omissionReason?: 'budget' | 'ambiguous' | 'missing-source' | 'stale-source' | 'lower-ranked' | 'hard-limit';
}
```

Named/requested evidence receives protected allocation before lower-ranked material. If it cannot be rendered, omission reason is surfaced compactly.

## Trust ranking

Exact relationships are preferred to candidate/heuristic ones at equal task relevance. However uncertain evidence that materially changes safety must not be removed; it appears as boundary/coverage summary even if verbose source is trimmed.

## Session-aware delivery

Session state belongs to the MCP connection/workspace, not a global singleton:

```ts
interface ServedArtifactRecord {
  workspaceIdentity: string;
  artifactIdentity: string;
  contentFingerprint: string;
  deliveredRanges?: readonly SourceRange[];
  deliveredBytes: number;
  callIndex: number;
}
```

When an unchanged selected source range was already delivered and a back-reference is smaller, render a pointer such as file/symbol/range + “already delivered in this session”. If content fingerprint changed, emit source again.

Do not allow all selected source to become pointers; at least the current answer-bearing evidence should remain concrete unless the request itself only requires summaries.

## Output

Retain existing block strings and budget fields. Add optional compact:

```ts
coverage?: AnalysisCoverage;
trust?: ContextTrustSummary;
omitted?: ContextOmission[];
```

Do not expose entire evidence records by default.

## Query/runtime ownership

MCP server owns per-connection delivery state; context module owns selection/allocation/rendering. HTTP one-shot context requests do not retain cross-request state unless a future authenticated session contract explicitly owns it.

## Evaluation

Fixed-index benchmark metrics:

- named-symbol delivery rate;
- answer-bearing evidence recall;
- duplicate source bytes across 3–5 calls;
- unique evidence per token;
- irrelevant evidence ratio;
- external raw-file-read fallback count;
- hard `blockTokens.total <= maxTokens` for all cases.

## Failure semantics

Ambiguous seed returns compact candidate/omission metadata rather than silently selecting. Missing evidence store degrades trust-aware ranking but must report unavailable coverage; it may not fabricate exactness.
