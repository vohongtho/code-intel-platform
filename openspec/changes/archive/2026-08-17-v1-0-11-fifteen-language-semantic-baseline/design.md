# Design: 15-Language Semantic and Scalability Baseline

## Observed v1.0.10 control flow

`parsePhase` detects a language, looks up a static `LANG_QUERIES` entry, attempts Tree-sitter extraction, and uses regex extraction if Tree-sitter did not run successfully. `parser-manager.ts` owns grammar loading. Shared language detection owns file-extension mapping. Tests maintain their own enumerations.

The design replaces duplicated enumeration, not the public pipeline.

## New modules and ownership

Create:

```text
code-intel/core/src/languages/capability-types.ts
code-intel/core/src/languages/capability-registry.ts
code-intel/core/tests/semantic-corpus/<language>/...
code-intel/core/tests/semantic-corpus/manifests/...
code-intel/core/tests/performance/language-resolution-contract.test.ts
```

### `LanguageCapabilityDescriptor`

```ts
type CapabilityState = 'supported' | 'partial' | 'not-applicable' | 'unsupported';

interface LanguageCapabilityDescriptor {
  language: Language;
  extensions: readonly string[];
  grammarArtifact: string;
  queryProvider?: () => string;
  adapterId: string;
  capabilities: {
    definitions: CapabilityState;
    ownership: CapabilityState;
    imports: CapabilityState;
    exports: CapabilityState;
    calls: CapabilityState;
    references: CapabilityState;
    heritage: CapabilityState;
    typeHints: CapabilityState;
    controlFlow: CapabilityState;
    dataFlow: CapabilityState;
    embeddedLanguages: CapabilityState;
  };
  resolutionPerformance?: {
    maxWorkspaceTraversalsPerPass: number;
    maxPreparedIndexBuildsPerPass: number;
    scalingBudget: number;
    depthScalingBudget?: number;
    retainedHeapMiB?: number;
  };
}
```

The registry becomes canonical for supported extensions, parser/query dispatch metadata, packaging checks, test enumeration, and capability reporting. Do not create another hard-coded 15-language array in tests.

## Semantic corpus design

Every language fixture has a manifest containing expected and forbidden semantic observations. Prefer paired controls rather than raw edge counts.

Minimum paired controls where applicable:

- same-file vs cross-file declaration use;
- direct vs aliased import;
- local vs imported same-name target;
- concrete vs interface/protocol receiver;
- generic vs non-generic typed receiver;
- single vs grouped/multi declaration;
- same simple name under different owner/module;
- serial vs parallel analysis;
- full vs incremental path once incremental semantics are enabled.

A row can explicitly mark a case `not-applicable`.

## HTML

Implement an initial HTML semantic profile for addressable/resource relationships:

- element ID/class properties;
- `<script src>`;
- `<link href>`;
- `<a href>`;
- `<form action>`;
- embedded script region ranges.

Do not model ordinary HTML elements as functions. Raw HTML CFG/data flow is `not-applicable`.

## Performance contract

Timing alone is insufficient. The production adapter path must expose test-only instrumentation for:

- prepared workspace-index build count;
- full file-set traversal count;
- candidate lookup count;
- bounded fan-out/truncation count.

Scaling fixtures vary repository file count, import/reference count, path depth, and collision density. A language that does not require workspace scanning may set traversal budget to zero.

## Release report

Produce a machine-readable report with one row per language and dimensions for correctness, completeness, determinism, scalability, and resource use. One failed accepted capability fails a shared semantic release.

## Alternatives considered

### Keep independent maps

Rejected because drift already exists: HTML grammar support and production query support differ.

### Use aggregate parser coverage

Rejected because improvements in large TS/JS corpora can hide regressions in smaller languages.

## Failure semantics

A missing grammar/query/adapter is a failed or partial language capability, not a silent fallback to `supported`. Benchmark instrumentation failure must fail non-vacuously through positive anchor assertions.

## Observability

Verbose analysis may include per-language file counts and fallback counts. Public API expansion is not required by this change.

## Test strategy

- registry completeness and uniqueness;
- extension-detection parity;
- grammar load parity;
- query/provider availability;
- corpus positive/negative assertions;
- persist/reopen through LadybugDB;
- BM25/search visibility;
- deterministic normalized fingerprints;
- serial/parallel parity;
- structural traversal/index-build performance contracts.
