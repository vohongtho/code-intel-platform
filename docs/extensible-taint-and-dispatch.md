# Extensible taint models and receiver dispatch (v1.0.12)

This page covers three things added in v1.0.12: declarative taint models, the `taint-trace` query, and receiver type-set dispatch. It also states what each one does not do. Code lives in `code-intel/core/src/program-analysis/taint/`, `code-intel/core/src/resolution/receiver-types.ts`, `code-intel/core/src/resolution/dispatch.ts` and `code-intel/core/src/query/taint-trace.ts`.

## Taint models

A model is JSON data that names sources, sinks and sanitizers. It never contains code, and no field is compiled into a regular expression.

Models come from four places, merged in this order:

1. Built-in runtime models (`taint/builtin-models.ts`): `node-core`, `python-stdlib`, `go-stdlib`.
2. Framework adapter contributions (`FrameworkAdapter.taintModels()`): Express, NestJS, Spring, Flask, Go `net/http`, ASP.NET Core. Each contribution records the adapter id and version.
3. Project models in `.code-intel/taint-models.json`.
4. Legacy `TaintRuleSet` text rules, adapted to `literal-call-pattern` matchers. This exists for existing callers only.

### Project model file

Code Intel's only config file is the user-global `~/.code-intel/config.json`, which holds flat dot-path settings and has no per-repository scope. Project models therefore live in one fixed per-repository file:

```json
{
  "schemaVersion": 1,
  "models": [
    {
      "schemaVersion": 1,
      "id": "company-db",
      "version": "1",
      "languages": ["typescript"],
      "sources": [{ "id": "tenant-header", "kind": "field-read", "path": "ctx.headers" }],
      "sinks": [{ "id": "raw-query", "kind": "qualified-call", "callee": "db.rawQuery", "category": "sql" }],
      "sanitizers": [{ "id": "sql-escape", "kind": "qualified-call", "callee": "sqlstring.escape", "categories": ["sql"] }]
    }
  ]
}
```

Matcher kinds, and the roles each may fill:

| Kind | Matches | Source | Sink | Sanitizer |
|---|---|---|---|---|
| `qualified-call` | Callee path equals `callee` (`match: "suffix"` matches on a `.`/`::` boundary) | yes | yes | yes |
| `return-of` | The value assigned from calling `callee` | yes | no | yes |
| `field-read` | A read whose access path is `path` or extends it at a segment boundary | yes | no | no |
| `framework-input` | `<request param>.<accessPath>` inside a function that a route of `framework` registers as its handler | yes | no | no |
| `annotation` | Reads of a parameter carrying this annotation or decorator | yes | no | no |
| `literal-call-pattern` | Substring, prefix or exact text of the statement | yes | yes | yes |

Rules the loader enforces:

- Every sink names one `category`: `sql`, `command`, `xss`, `ssrf`, `path`, `code`, `deserialization` or `other`.
- Every sanitizer lists the `categories` it cleans. A sanitizer is never assumed to clean every class. Only adapted legacy rules use `*`.
- Unknown fields, unknown matcher kinds, wildcard or regex syntax in paths, duplicate ids, and limit overruns all fail validation. The diagnostic names the file, the path in the file, the model id and the matcher id.
- Limits: 32 models per file, 256 matchers per model, 256-character text fields, a 256 KiB file.
- If the file's real path resolves outside the repository (for example through a symlink), it is rejected.
- An invalid project file makes `taint-trace` return `verdict: "model-error"`. Built-in models are not substituted for a model the user wrote.
- A project model cannot reuse a built-in or framework model id. A duplicate id is accepted only when its content is byte-identical after normalization.

### Fingerprints and caching

`taintModelFingerprint` hashes the normalized models together with each contribution's origin and adapter id and version. It is part of the program-analysis cache key, along with the function context and any non-default limits. A changed model therefore misses the cache even when the source is unchanged; `tests/unit/program-analysis/taint/engine-models.test.ts` covers this case.

### Certainty

A match is statement-level evidence: callee syntax or text, not a resolved symbol identity. Findings therefore stay at `heuristic` certainty. `sourceMatchStrength` and `sinkMatchStrength` (`syntactic` or `text-fallback`) record how a match was made, but they never raise certainty. A path that crosses a call is additionally bounded by the weakest call edge it used, and each hop records `callCertainty` and `callComplete`.

### Sanitizers

Sanitizers apply per path and per category. A sanitizer cleans only its declared categories (`shlex.quote` cleans `command`, not `code`), and only on the path that passes through it. If a sanitized definition and an unsanitized definition both reach the same sink, the unsanitized path is still reported, and the sanitizer is attached as sibling evidence.

### Intraprocedural propagation

Taint propagates through:

- plain name copies;
- non-call expressions that read a tainted name, such as concatenation, member or index reads, and casts. This is field-insensitive: a tainted object taints its members.

A call result is tainted only when a source matches, or when a callee summary transfers the taint in interprocedural mode. An unmodeled call neither launders taint nor propagates it.

Declarations now lower their initializer, so `const x = req.body.id` is visible to the engine. `PROGRAM_ANALYSIS_VERSION` moved to `program-analysis-v2` for this change.

## Interprocedural taint

`taint/interprocedural.ts` follows `calls` edges already persisted in the semantic graph. It never runs a separate resolver. A value crosses a call only when all of these hold:

- `gateInterproceduralAnalysis` reports the index as trusted. A stale, corrupt, legacy or missing index returns intraprocedural results plus a `gated:` boundary.
- The edge certainty is `exact` or `candidate`. Heuristic name-fallback edges and legacy edges without certainty are reported as boundaries and not followed.
- The argument-to-parameter mapping is known. Spread or keyword arguments, unparseable calls and arity overflow produce an `unknown-parameter-mapping` boundary.
- The callee's taint summary transfers the value, whether parameter-to-sink, parameter-to-return, or a return source.

Summaries are computed bottom-up and transitively. They are bounded by `maxCallSummaryDepth`, `maxAnalyzedFunctionsPerRequest` and `maxAnalysisTimeMsPerRequest`; hitting any of these sets `truncated` with a reason. Recursion stops with a `recursive-call` boundary.

When tainted data is passed to a call that has no analyzed callee, the result records `tainted-argument-into-unanalyzed-call:<callee>`. In that case coverage is partial, not clean.

## `taint-trace`

```bash
code-intel taint-trace --symbol handleRequest
code-intel taint-trace --source express-request-input --sink sql
code-intel taint-trace --symbol run --format json
```

The same service backs the MCP tool `taint_trace` and `GET /api/v1/taint-trace` (parameters `symbol`, `source`, `sink`, `interprocedural`, `max_findings`, `max_functions`, `verbose`). Without `--symbol`, it scans at most 200 function nodes, does not follow calls, and reports a truncation reason if functions were skipped.

Verdicts:

| Verdict | Meaning |
|---|---|
| `findings` | Candidate paths found. These are static evidence under the listed models, not confirmed exploitability. |
| `no-findings-complete` | No path found, and every analyzed function had supported capability, with no truncation, unevaluated matcher, gate or boundary. This verdict covers only the listed models; it does not prove the code is free of injection bugs. |
| `no-findings-partial-coverage` | No path found, but coverage was incomplete. `coverage.notes` and `coverage.boundaries` say why. Do not read this as safe. |
| `unsupported` | No function could be analyzed. |
| `not-found` / `ambiguous` | The symbol did not resolve to exactly one function. |
| `model-error` | A model failed validation. `models.diagnostics` lists the errors. |

`framework-input` matchers need route `handles` edges, and `annotation` matchers need parameter annotations. The index does not extract parameter annotations yet. When the needed context is missing, these matchers are listed in `coverage.unevaluatedMatchers`.

## Receiver type sets and dispatch

`inferReceiverTypeSet` determines the static types of a call's receiver from the strongest available evidence:

1. a constructor expression (`new Foo()`, Go `Foo{}`, a Python call of an indexed class);
2. the receiver type declared on the call fact;
3. a typed parameter, local or field owned by the caller or its owner;
4. `this`/`self`, which resolves to the owner type.

It then expands runtime types through a reverse-heritage index, capped at 32 types and depth 6. An open interface, trait or protocol is narrowed only by exact evidence: a constructor, or one exact, static DI binding (for example ASP.NET Core `AddScoped<I, T>()`). Without that, the result stays incomplete with an `open-interface-implementations` boundary, even when only one implementation is indexed.

`resolveDispatch` maps each runtime type to the member it executes: its own member, or the nearest inherited one. Abstract interface members are excluded. Every distinct target is kept:

- several targets give `candidate-set`;
- a lone target is `exact` only when the type set is complete;
- more targets than the dispatch limit give `truncated` with `dispatch-candidate-limit`.

The result is a standard `ResolutionOutcome`. The existing materializer persists it as ordinary `calls` edges with evidence records, and `tests/unit/resolution/dispatch.test.ts` round-trips those edges through the CSV writer, graph loader and evidence store.

### Performance

The new indexes are `subtypesByTypeName`, `dependencyBindingsByContract` and `registrationsByTarget`. They replace the per-call-site scans of every heritage and registration entry that inheritance and registration dispatch used to perform.

Receiver type sets are cached per index build and call site. Instrumentation counters (`dispatchIndexLookupCount`, `receiverTypeInferenceCount`, `receiverTypeCacheHitCount`) back a test showing that lookups for the same calls are identical in a 10-declaration workspace and a 5,000-declaration one.

### Capability, stated plainly

`RESOLUTION_LANGUAGE_STRATEGIES[*].dispatchEvidence` records for all 15 languages what works in a real index:

- **Engine:** supported for TypeScript, JavaScript, Python, Java, C#, Go and Rust. Other languages use declared receiver types, but their results are never complete.
- **Receiver facts:** unsupported everywhere. No semantic adapter emits receiver text or type on call-site facts yet, and the TypeScript adapter skips `obj.method(` calls entirely. Over a real index, receiver dispatch therefore runs only on fact bundles that carry receiver evidence; other calls fall back to the existing non-receiver strategies.
- **Heritage facts:** partial for C#, Go and Python (regex adapters). Unsupported elsewhere.
- **Registration narrowing:** partial for C# only. Nest and Spring bindings name the contract but not the implementation.

The program-analysis matrix gains an `interproceduralTaint` axis. It is never better than `partial`, because it depends on call-graph coverage rather than on lowering quality.

## Evaluation

- `tests/unit/resolution/dispatch-eval.test.ts` scores dispatch precision and recall against declared target sets in TypeScript, Java, C#, Go, Python and Rust, with forbidden targets and expected completeness for each case.
- `tests/unit/program-analysis/taint/eval-fixtures.test.ts` scores taint true and false positives across TypeScript, Python and Go, including sanitizer category mismatches, regex `.exec`, non-handler request objects and unrelated variables.

Both sets currently reach full precision and recall. They are regression fixtures, not a measure of real-world accuracy.

## Clean-room and dependency notes

- The taint, PDG and dispatch concepts used here are standard static-analysis techniques: reaching definitions, function summaries, class-hierarchy analysis and receiver type sets. They were implemented from that general literature and this repository's existing modules.
- No GitNexus (PolyForm-Noncommercial) code, tests, schemas or prompts were consulted or copied.
- No runtime dependency was added. Model files are JSON so that no YAML parser is needed, and matching uses bounded string scanning instead of regular expressions built from model content.
