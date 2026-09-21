# Design: Evidence-Based, Language-Aware Resolution

## Observed v1.0.10 control flow

`resolvePhase` independently scans source lines after parsing and builds one-value name maps. The replacement keeps `resolvePhase` as pipeline orchestration but delegates to a focused resolution package.

## New modules

```text
code-intel/core/src/resolution/contracts.ts
code-intel/core/src/resolution/engine.ts
code-intel/core/src/resolution/context.ts
code-intel/core/src/resolution/coverage.ts
code-intel/core/src/resolution/boundaries.ts
code-intel/core/src/resolution/indexes/workspace-index.ts
code-intel/core/src/resolution/indexes/declaration-index.ts
code-intel/core/src/resolution/indexes/lexical-scope-index.ts
code-intel/core/src/resolution/indexes/module-surface-index.ts
code-intel/core/src/resolution/indexes/type-index.ts
code-intel/core/src/resolution/indexes/heritage-index.ts
code-intel/core/src/resolution/indexes/registration-index.ts
code-intel/core/src/resolution/strategies/*.ts
code-intel/core/src/resolution/languages/<language>.ts
```

## Resolution contract

```ts
type ResolutionCertainty =
  | 'exact'
  | 'candidate-set'
  | 'heuristic'
  | 'unresolved'
  | 'external-boundary'
  | 'truncated';

interface ResolutionCandidate {
  targetId: string;
  confidence: number;
  strategy: string;
  evidenceRefs: readonly string[];
}

interface ResolutionCoverage {
  complete: boolean;
  totalKnownCandidates?: number;
  emittedCandidates: number;
  incompleteReasons: readonly string[];
}

interface ResolutionOutcome {
  referenceId: string;
  certainty: ResolutionCertainty;
  candidates: readonly ResolutionCandidate[];
  coverage: ResolutionCoverage;
  boundary?: AnalysisBoundary;
  resolverVersion: string;
}
```

Confidence is evidence strength, not runtime probability.

## Prepared workspace indexes

Build once per analysis generation and share across call/reference/import resolution:

- symbol IDs by simple and qualified name;
- members by owner;
- lexical scopes;
- module/public export surface;
- files by exact path/stem/suffix/directory;
- type definitions and aliases;
- direct supertypes/subtypes;
- registrations/callbacks/events.

Language modules may add indexes needed for package/import semantics. Production-path tests instrument full file-set traversals and index builds.

## Strategy ordering

Resolution strategy selection is evidence-driven, not a fixed global `first name wins` rule. A typical member call may evaluate:

```text
lexical caller
-> receiver expression
-> receiver type candidates
-> owner member candidates
-> import/module qualification
-> heritage/interface dispatch
-> signature compatibility
-> bounded candidate result
```

Fallback by global simple name can only produce heuristic/candidate semantics, never `exact` without additional evidence.

## Module/public surface

`ImportBindingFact` binds a local name; `PublishedNameFact` describes the target module/package public surface. The resolver traverses bounded re-export closure with cycle detection.

If two distinct definitions can legally publish the same name and static evidence cannot choose, outcome remains ambiguous/candidate; source or iteration order is not a tiebreaker for exactness.

## Type-aware receiver semantics

Structured type references preserve generics/specializations. Language modules decide how to compare/substitute them.

Examples of required language-specific behavior to benchmark:

### TypeScript/JavaScript

- aliases/re-exports;
- receiver annotation/initializer/constructor assignment;
- `this`/`super`;
- callback/function values;
- structural shape boundaries.

### Go

- package identity;
- `T` vs `*T` method sets;
- promoted methods through embedded values/pointers;
- package-sensitive unexported identifiers;
- structural interface satisfaction;
- bounded interface dispatch.

### C#

- namespaces/usings;
- overloads;
- interfaces/virtual/override/explicit implementation;
- records/partial declarations;
- delegates/events;
- extension methods;
- DI registration facts when available.

### Python

- module/package identity;
- aliases;
- module-level package re-export semantics;
- instance/class/static methods;
- dynamic boundaries.

Equivalent language-appropriate matrices are required for Java, Kotlin, C, C++, Rust, PHP, Ruby, Swift, Dart, and HTML structural references.

## Candidate fan-out and exact-empty proof

Interface/dynamic candidate fan-out is bounded. If known candidates exceed the cap, coverage becomes incomplete/truncated. A later consumer cannot call an empty result exact unless all relevant relationship classes were evaluated completely.

## Legacy fallback

During staged rollout, one language may use an internal legacy adapter only if:

- its output is tagged heuristic internally;
- the 15-language baseline shows no regression;
- it cannot override a stronger exact/candidate outcome;
- no user flag is required.

## Alternatives considered

### Keep regex resolver and add receiver checks

Rejected because imports, public surfaces, overloads, type semantics, and incremental invalidation would still be based on a separate semantic model.

### One identical algorithm for all languages

Rejected. Universal contracts/index lifecycle are shared, while language semantics differ materially.

## Failure semantics

Unsupported reflection/eval/dynamic registration becomes an explicit boundary. Ambiguity stays ambiguous. Candidate truncation is visible. Missing target is preferred over a confidently wrong edge.

## Test strategy

- per-language precision/recall and forbidden-target fixtures;
- duplicate-name and overload cases;
- generic/non-generic paired controls;
- interface/concrete paired controls;
- import/re-export/cycle/ambiguity cases;
- serial/parallel deterministic outcomes;
- prepared-index traversal/build counters;
- small/medium/large scaling and retained heap;
- production persistence/reopen once evidence storage lands.
