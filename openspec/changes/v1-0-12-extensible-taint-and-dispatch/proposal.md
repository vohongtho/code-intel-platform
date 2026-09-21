# v1.0.12: Extensible Taint and Type-Aware Dispatch

## Change ID
`v1-0-12-extensible-taint-and-dispatch`

## Feature IDs
F14, F21

## Priority
P1 — advanced program-analysis foundation

## Summary
Make taint modeling configurable and framework-aware, add a bounded interprocedural taint path using trusted call relationships, and strengthen dynamic/interface dispatch by resolving receiver type sets rather than collapsing runtime-polymorphic calls to a single guessed target.

## 1. Source-verified baseline

### Taint
`code-intel/core/src/program-analysis/taint/contracts.ts` already defines versioned `TaintRuleSet` with `sources`, `sinks`, and `sanitizers`. Matching is currently a safe case-sensitive substring over shallow statement text. Findings are intraprocedural and intentionally heuristic.

`program-analysis/semantic-graph-gate.ts` explicitly states that future interprocedural program-analysis results must:
- require a trusted semantic graph;
- fail closed for stale/corrupt/legacy/missing graph state;
- bound certainty by the call relationship used to cross functions.

That gate SHALL be reused.

### Dispatch
`resolution/languages.ts` already advertises `receiver-type`, `inheritance-dispatch`, and sometimes `registration-dispatch` for many languages. Several language rows remain `partial` and explicitly list runtime/reflection/magic dispatch boundaries.

The gap is therefore not "add type-aware resolution from scratch". The gap is a stronger, shared receiver-type-set/dispatch-candidate model with explicit completeness and caching that can improve call edges and safely support interprocedural analyses.

## 2. Configurable taint model

Add a versioned model registry with two sources:
1. built-in models contributed by Code Intel/framework adapters;
2. optional project-local models.

A model describes semantic matchers, not arbitrary executable code.

Suggested matcher kinds:
- `qualified-call`: canonical or qualified callee identity/name;
- `framework-input`: route/request/message input fact;
- `annotation`: known framework annotation/decorator fact;
- `field-read`: known property/source category;
- `literal-call-pattern`: bounded exact/prefix/text fallback for unsupported semantic cases;
- `return-of`: result of a known source function.

Rule roles:
- source;
- sink;
- sanitizer;
- propagator/summary override only if later proven necessary.

Project models SHALL be declarative, schema-validated, size/count bounded, deterministically ordered, and fingerprinted.

## 3. Model precedence and certainty

Built-in semantic model matches can have stronger certainty than text fallback, but no model alone proves exploitability.

If multiple models match:
- retain model IDs/evidence;
- do not silently overwrite a stronger/weaker model;
- sanitizer application is path-specific;
- an alternate sanitized branch does not erase a distinct unsanitized reaching definition.

Project models cannot raise certainty above the semantic evidence available at the matched statement/call.

## 4. Model storage/configuration

Prefer the existing Code Intel configuration hierarchy if it can cleanly host:
```yaml
analysis:
  taint:
    models:
      - id: company-http-input
        version: "1"
        sources: [...]
        sinks: [...]
        sanitizers: [...]
```

If the existing config format cannot support structured models without breaking compatibility, use one project-local file under `.code-intel/`, not a new top-level repository file.

The model content fingerprint SHALL participate in program-analysis cache identity and any persisted/derived compatibility receipt. A model change invalidates cached taint output.

## 5. Framework model contributions

Framework semantic adapters may register built-in taint model fragments using standard contracts rather than mutating taint output directly.

Examples:
- HTTP route parameters/body as potential untrusted input;
- database raw-query execution as SQL sink;
- shell/process invocation as command sink;
- template/raw HTML APIs as XSS sink;
- URL-fetch APIs as SSRF sink;
- framework sanitizer/validation APIs where semantics are specific enough.

Each adapter contribution records adapter ID/version/model version.

Do not classify a generic validation function as sanitizer solely by its display name.

## 6. Interprocedural taint

Add an opt-in bounded interprocedural mode.

A tainted value may cross a call boundary only when:
- `gateInterproceduralAnalysis` permits the graph;
- the call target candidate is supported by the dispatch result;
- parameter/argument mapping is known enough;
- callee/caller summary supports the transfer;
- request-level chain/hop/time limits are not exceeded.

Return-value propagation uses existing/new function summaries. Parameter-to-sink and parameter-to-return summaries SHALL be content/version cached.

Every crossed edge lowers/bounds certainty to the weakest call/dispatch evidence.

Candidate dispatch can produce candidate taint paths, but never an exact path.

## 7. Public taint trace surface

Expose a focused read-only query:
```bash
code-intel taint-trace --symbol handleRequest
code-intel taint-trace --source <selector> --sink <selector>
```

MCP/HTTP equivalent may be named `taint_trace`.

Result includes:
- source/sink;
- statement/function path;
- sanitizer evidence;
- model IDs;
- certainty;
- intraprocedural/interprocedural boundaries;
- truncation/resource limits;
- unsupported-language/model notes.

"No finding" SHALL NOT be described as "safe" when model/language/coverage is incomplete.

## 8. Receiver type-set resolution

Introduce a common receiver-type analysis contract:
```ts
interface ReceiverTypeSet {
  callSiteId: string;
  staticTypes: readonly TypeCandidate[];
  possibleRuntimeTypes: readonly TypeCandidate[];
  complete: boolean;
  boundaries: readonly string[];
}
```

Evidence may come from:
- lexical/local variable declaration;
- constructor/new assignment;
- parameter type;
- field/property type;
- import/type binding;
- generic type application where recoverable;
- class/interface inheritance graph;
- DI/registration facts;
- narrowed/cast type evidence;
- language-specific self/this receiver.

Do not infer a unique runtime type merely because one implementation is currently indexed if interface/subclass scope is incomplete.

## 9. Dispatch resolution

For a method/interface call:
1. resolve receiver type set;
2. find member declaration on static type(s);
3. expand permitted runtime overrides/implementations according to language semantics;
4. apply registration/DI narrowing when exact evidence exists;
5. emit one or multiple dispatch candidates with strategy, confidence/certainty and completeness;
6. retain an unresolved/candidate boundary when expansion is incomplete.

Do not replace multiple candidates with the highest-score candidate as though exact.

Suggested:
```ts
interface DispatchResolution {
  callSiteId: string;
  candidates: readonly DispatchCandidate[];
  complete: boolean;
  certainty: ResolutionCertainty;
  strategy: string;
  boundaries: readonly string[];
}
```

## 10. Language rollout

Do not flip all 15 languages at once.

Phase A should target languages with existing receiver-type/inheritance support and strong fixtures, likely TypeScript, JavaScript, Python, Java, C#, Go and Rust after source verification.

C/C++ templates/function pointers, PHP magic calls, Ruby `method_missing`, reflection-heavy Java/.NET, Swift runtime protocol specialization, Dart mirrors and runtime-generated JS remain explicit boundaries until separately proven.

The language capability registry SHALL state which dispatch evidence is:
- supported;
- partial;
- unsupported.

## 11. Interaction with call graph and PDG

Improved dispatch updates semantic `calls` relationships through the existing resolver/evidence path. Program-analysis interprocedural consumers read those persisted relationships and their certainty; they do not run a separate hidden dispatch resolver.

This preserves one semantic source of truth.

## 12. Performance

Receiver type sets are cached by call-site identity + resolver/type-environment fingerprints.

Bound:
- maximum runtime type candidates;
- inheritance expansion depth;
- DI registration candidates;
- interprocedural taint call depth;
- taint states/worklist;
- findings/path count.

Cap hits return incomplete coverage.

No per-call-site full-workspace scans are acceptable in a hot path; use prepared type/member/hierarchy indexes.

## 13. Security and configuration safety

Project taint models:
- cannot execute code;
- no unbounded regex by default;
- file/model/matcher counts bounded;
- unknown matcher kind fails validation;
- model paths cannot escape the repository;
- secrets in model config are unnecessary and must not be encouraged.

## 14. Persistence/migration

Add fingerprints/version fields for:
- taint model schema/content;
- receiver-type/dispatch algorithm version;
- function-summary transfer schema where extended.

Incompatible cached derived results rebuild through normal analysis/cache planning. Existing graph schema may remain unchanged if current edge evidence fields can represent candidate dispatch; if new persisted metadata is required, migration must be additive and read-back verified.

## 15. Evaluation

Add separate evaluation sets:
- taint true/false-positive fixtures with sources/sinks/sanitizers;
- interface/polymorphism/DI dispatch target sets;
- negative fixtures proving forbidden targets are not emitted;
- candidate-cap and incomplete hierarchy cases.

Measure dispatch precision/recall against declared target sets, not just edge count.

## 16. License/IP

General taint/PDG/dispatch concepts may be implemented from standard static-analysis literature. GitNexus's PolyForm-Noncommercial implementation expression, tests, schemas, and prompts SHALL NOT be copied.

## 17. Non-goals

- runtime dynamic tracing;
- whole-program soundness claims;
- arbitrary regex/programming language inside taint model config;
- cross-repository taint propagation in v1.0.12;
- treating scanner/taint results as confirmed exploitability;
- replacing the existing resolver with a second call-graph engine.

## 18. Acceptance

Project model changes invalidate taint cache; built-in and project evidence is visible; trusted interprocedural paths bound certainty; interface dispatch preserves multiple valid targets; unsupported dynamic behavior remains explicit; public taint trace distinguishes no finding from proven safety.
