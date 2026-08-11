# Design: Progressive Program-Analysis Foundation

## Architecture

```text
semantic facts + canonical symbol/call-site identity
  -> language function lowering
  -> Universal IR
  -> CFG
  -> dominators/post-dominators
  -> control dependence
  -> reaching definitions / def-use
  -> function summary
  -> PDG
  -> bounded taint
```

Cross-function summary use is gated by relationship certainty; an uncertain call cannot magically create exact interprocedural data flow.

## New modules

```text
code-intel/core/src/program-analysis/contracts.ts
code-intel/core/src/program-analysis/limits.ts
code-intel/core/src/program-analysis/ir/*
code-intel/core/src/program-analysis/cfg/*
code-intel/core/src/program-analysis/dataflow/*
code-intel/core/src/program-analysis/pdg/*
code-intel/core/src/program-analysis/taint/*
code-intel/core/src/program-analysis/summaries/*
code-intel/core/src/program-analysis/cache/*
code-intel/core/src/program-analysis/languages/<language>.ts
```

## Universal IR

Statements at minimum:

```text
declaration
assignment
call
return
throw
conditional
switch/match
loop
break/continue
try/catch/finally/defer
await/yield
label/goto
unknown
```

Expressions at minimum:

```text
literal
local/parameter read
member/index read
unary/binary
call/new
lambda
cast/type-test
unknown
```

Every item carries canonical function ID, source range, stable IR ID, and uncertainty where lowering is partial.

## CFG

Per function/method:

- explicit entry/exit;
- basic blocks;
- deterministic successor/predecessor ordering;
- normal/conditional/loop edges;
- return/throw;
- exceptional/finally/defer edges where language lowering supports them;
- validation that every referenced block exists and entry/exit invariants hold.

## Data flow

Start with deterministic intraprocedural reaching definitions for locals/parameters and explicitly represented fields where safe. Worklist algorithms must have convergence/iteration limits. Heap/alias uncertainty becomes boundary rather than guessed kill/gen behavior.

## Control dependence and PDG

Compute dominators/post-dominators over validated CFG, then control dependence. PDG combines control dependence and def-use/data dependencies. Main symbol graph stores only approved summaries; detailed statement/block graph remains a versioned side artifact.

## Function summaries

Summaries may include:

- parameter-to-return influence;
- parameter/member reads/writes;
- sink/source behavior;
- called canonical symbol IDs with relationship certainty;
- unknown/truncated markers.

Summary identity includes function body hash + program-analysis version + required semantic graph fingerprints.

## Taint

Rules:

```ts
interface TaintRuleSet {
  version: string;
  sources: TaintMatcher[];
  sinks: TaintMatcher[];
  sanitizers: TaintMatcher[];
}
```

Findings include source, propagation steps, sanitizer evidence, sink, confidence/certainty, boundaries, truncation, and source ranges. Existing security signals can seed rule definitions but must not be mistaken for proven source-to-sink paths.

## Progressive/lazy runtime

Normal `analyze` may precompute only cheap summaries according to internal policy. Existing security/context/inspect workflows can request missing detailed artifact internally. Cache is keyed by:

```text
canonical function ID
+ body hash
+ language lowering version
+ program-analysis version
+ resolver/evidence compatibility fingerprints
```

No user mode switch is required.

## Resource limits

Define defaults for:

- max statements/function;
- max blocks;
- max worklist iterations;
- max call-summary depth;
- max analyzed functions/request;
- timeout/function/request;
- max artifact bytes.

Limit hit => `truncated` with reason, never silent complete result.

## Language rollout

All executable advertised languages receive explicit capability state. Internal rollout can be staged, but shared changes cannot regress base language graph semantics. Raw HTML program analysis is `not-applicable`; embedded scripts lower through their executable language adapter.

## Query runtime boundary

Heavy grammars/CFG/dataflow/taint builders must not become static dependencies of MCP/HTTP read-only startup. Lazy load advanced runtime only when artifact generation is required.

## Alternatives considered

### Materialize every CFG/PDG block as LadybugDB nodes

Rejected as the default because graph size and query startup would grow substantially. Persist summaries centrally and detailed artifacts in a side store.

### Implement taint directly on AST without CFG/def-use

Rejected for the strategic engine because it produces fragile propagation and duplicates control/data semantics.

## Test strategy

- IR golden lowering per construct/language;
- CFG structural golden tests;
- randomized small CFG dominator/data-flow differential tests against a simple reference implementation;
- def-use positive/negative cases;
- taint source/sink/sanitizer positive/negative fixtures;
- truncation/resource-limit tests;
- cache/full equivalence;
- body-only invalidation;
- cross-function certainty propagation;
- performance/memory budgets.
