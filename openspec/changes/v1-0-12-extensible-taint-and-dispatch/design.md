# Design: Extensible Taint and Type-Aware Dispatch

## 1. Existing ownership

Taint rules/findings remain under `program-analysis/taint/*`.
Semantic call resolution remains under `resolution/*`.
Language capability status remains in existing capability registries.
Interprocedural analysis must call `gateInterproceduralAnalysis`.

The design avoids a second resolver inside taint.

## 2. New/extended modules

Taint:
- `program-analysis/taint/model-schema.ts`;
- `program-analysis/taint/model-registry.ts`;
- `program-analysis/taint/model-loader.ts`;
- `program-analysis/taint/interprocedural.ts`;
- extend `taint/contracts.ts`, `taint/build.ts`.

Dispatch:
- `resolution/receiver-types.ts`;
- `resolution/dispatch.ts`;
- `resolution/type-index.ts` or reuse an existing prepared type/member index if source inspection identifies one;
- language-specific adapters under the current resolution architecture rather than independent resolvers.

Public query:
- `query/taint-trace.ts`.

## 3. Taint model contract

```ts
type TaintMatcherKind =
  | 'qualified-call'
  | 'framework-input'
  | 'annotation'
  | 'field-read'
  | 'return-of'
  | 'literal-call-pattern';

interface TaintModel {
  schemaVersion: 1;
  id: string;
  version: string;
  framework?: string;
  languages?: Language[];
  sources: TaintSemanticMatcher[];
  sinks: TaintSemanticMatcher[];
  sanitizers: TaintSemanticMatcher[];
}
```

Each matcher produces `TaintModelMatch` with matcher/model ID, source anchor, certainty and evidence kind.

The legacy `textPattern` model can be adapted as `literal-call-pattern` and retains heuristic certainty.

## 4. Model merge/fingerprint

Registry loads built-ins first and project model(s) second in stable ID/version order. Duplicate IDs with incompatible versions fail; project models do not silently replace built-ins.

`taintModelFingerprint` hashes normalized schemas/matchers plus adapter model versions. Include it in program-analysis cache keys/compatibility metadata.

## 5. Framework contributions

Adapters expose declarative taint descriptors through a standard registry callback/type. The taint engine consumes descriptors after framework detection. Framework code never directly creates final taint findings.

## 6. Intra/interprocedural engine

Existing intraprocedural reaching-definition taint remains the foundation.

Add summaries:
```ts
interface TaintFunctionSummary {
  functionId: string;
  taintedParameterToReturn: number[];
  taintedParameterToSink: Array<{ parameterIndex: number; sinkMatcherId: string }>;
  sanitizingParameterEffects?: number[];
  truncated: boolean;
}
```

Interprocedural algorithm follows trusted call edges and maps arguments↔formal parameters/return values. Every hop carries `min(certaintySoFar, callCertainty, dispatchCertainty)`.

Unknown parameter mapping terminates that path with boundary rather than guessing.

## 7. Receiver type-set engine

Prepared indexes:
- declaration/type by canonical ID;
- hierarchy base→derived and interface→implementer;
- member lookup by owner/type/name;
- DI/registration provider index;
- local type evidence by call-site/receiver anchor.

`inferReceiverTypeSet(callSite)` combines language-specific signals. It distinguishes static type from possible runtime implementations and reports whether expansion is complete.

## 8. Dispatch engine

`resolveDispatch(callSite, receiverTypeSet)`:
- find static member;
- expand overrides/implementations;
- narrow with exact concrete assignment/registration evidence;
- keep all still-valid candidates;
- emit bounded candidate set and boundary on cap;
- produce standard `ResolutionOutcome`/evidence so the existing graph projector/persistence path remains authoritative.

Do not persist a private dispatch-only edge.

## 9. Public taint trace

`query/taint-trace.ts` invokes capability checks, program-analysis cache, model registry and optional interprocedural engine. It returns compact paths/finding summaries; verbose statement evidence is opt-in.

MCP `taint_trace`, CLI `taint-trace`, HTTP endpoint all call that service.

## 10. Configuration

First inspect whether current config manager can support structured `analysis.taint.models`. If not, add `.code-intel/taint-models.yaml` (or JSON) under repo-managed data. The final choice must be one canonical location and documented.

Parser is strict:
- schema version required;
- unique model/matcher IDs;
- max model/matcher/text lengths;
- no arbitrary regex/code.

## 11. Persistence and cache

Program-analysis cache key gains model fingerprint and relevant dispatch/resolver fingerprint. If function summaries become persisted in a Generation/snapshot, they require read-back and compatibility receipt; otherwise keep them cache-only in v1.0.12.

## 12. Failure semantics

- invalid project model -> analysis/query error with file/path/matcher diagnostics, built-in behavior is not silently substituted if user explicitly requested that model;
- untrusted semantic graph -> intraprocedural results only; interprocedural boundary;
- candidate dispatch -> candidate taint paths;
- candidate cap -> partial coverage;
- resource cap -> truncated finding set;
- unsupported language -> explicit unsupported, never "no taint".

## 13. Tests

Taint:
- model schema/merge/fingerprint;
- semantic vs text matcher certainty;
- sanitizer branches;
- model-change cache invalidation;
- exact/candidate interprocedural calls;
- resource limits.

Dispatch:
- concrete receiver;
- interface with multiple implementations;
- inheritance override;
- generic/application type where supported;
- DI exact and multiple providers;
- ambiguity/candidate cap;
- negative forbidden-target fixtures per language.

Integration:
- improved semantic call edges persist/reopen;
- taint uses persisted dispatch certainty;
- stale/untrusted graph disables cross-function taint.

## 14. Performance

Record receiver inference candidates/index lookups/cache hits, dispatch expansion counts/caps, taint state counts/call hops/cache hits. Scaling fixtures must prove no repeated workspace-wide scan per call site.
