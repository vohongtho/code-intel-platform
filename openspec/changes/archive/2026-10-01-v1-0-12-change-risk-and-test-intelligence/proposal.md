# v1.0.12: Change Risk and Test Intelligence

## Change ID
`v1-0-12-change-risk-and-test-intelligence`

## Feature IDs
F06, F08, F13, F15

## Priority
P0 — strategic change-intelligence differentiator

## Summary
Connect the existing statement-level program-analysis engine to PR impact and test selection, add mutation-based evaluation so higher precision is measurable rather than asserted, and make execution-flow identity stable enough to diff and track across commits.

Delivery has two gates. Stable flow identity and migration land first as a shared foundation. PDG projection/test evidence then remain explicit/manual until the mutation benchmark proves the `auto` selection threshold; failing that threshold does not block stable flows or graph-mode improvements.

## 1. Source-verified baseline

v1.0.11 already provides:
- graph-level change impact in `code-intel/core/src/query/pr-impact.ts`;
- graph-backed test suggestions in `query/suggest-tests.ts`;
- API impact and cross-repository contract impact folded into PR analysis where evidence exists;
- universal IR, CFG, dominators/control dependence, reaching definitions, def/use, summaries, PDG and bounded taint under `src/program-analysis/*`;
- `semantic-graph-gate.ts`, which explicitly requires trusted graph state before future interprocedural program analysis and caps cross-function certainty by the call relationship;
- flow discovery in `flow-detection/entry-point-finder.ts`;
- semantic graph diff in `src/snapshots/*`.

The remaining gaps are specific:
1. `pr_impact` does not map changed lines/statements into CFG/PDG slices;
2. `suggest_tests` is primarily topology/import based and cannot distinguish direct changed behavior, transitive affected flow and unknown coverage with enough precision;
3. there is no mutation/effect oracle proving that PDG mode improves impact precision;
4. flow IDs are currently unstable across independent analyses, so `snapshots/types.ts` deliberately reports flow diff as unsupported.

## 2. User workflow

Existing workflow stays valid:
```bash
code-intel pr-impact --base main
```

Add optional precision:
```bash
code-intel pr-impact --base main --precision auto
code-intel pr-impact --base main --precision pdg
```

MCP/HTTP use:
```json
{
  "base_ref": "main",
  "precision": "auto"
}
```

`auto` uses PDG only for changed functions whose language/capability/budget/trust gates permit it, and graph fallback elsewhere.

## 3. Changed-line to PDG slicing

For each diff hunk:
1. map changed line ranges to owning canonical function/method;
2. lower the corresponding function to the existing program-analysis IR;
3. map changed source ranges to statement IDs;
4. build/reuse CFG, dataflow and PDG under existing resource limits;
5. compute a bounded forward slice for "what may depend on this change";
6. optionally compute a backward slice for inputs/guards needed to explain the effect;
7. project affected statements to the owning semantic symbol;
8. continue through trusted call relationships, APIs, execution flows and tests.

The main knowledge graph SHALL NOT gain one node per statement/basic block. Statement-level artifacts remain in the program-analysis layer and only focused results are projected upward.

## 4. Interprocedural rules

Cross-function expansion is allowed only when:
- the selected graph/index view is trusted;
- the call relationship is resolved enough to cross;
- the language supports the required summary/PDG capability;
- resource limits are not exceeded.

Certainty of any projected interprocedural result may never exceed the weakest call relationship traversed.

Candidate/ambiguous calls remain candidates; they are not promoted to exact affected behavior.

## 5. PR impact contract

Extend `PRImpactResult` additively with:
- requested/actual precision;
- statement-slice summary;
- PDG-eligible and fallback function counts;
- direct data/control impacts;
- projected affected symbols;
- affected stable flows;
- test evidence categories;
- analysis boundaries/truncation reasons;
- optional risk factors.

Existing graph-only fields remain valid.

Risk SHALL be evidence-based and explainable. A higher risk can be caused by breadth, proven API breakage, critical flow membership, missing relevant tests, or security-sensitive sinks. A low impacted-symbol count alone SHALL NOT imply low risk when coverage is partial.

## 6. Test selection and missing-test detection

Replace the current binary intuition with evidence categories:
- `direct`: an existing test reaches or tests the changed symbol/statement-owning function;
- `affected-flow`: test covers a stable flow containing an affected symbol;
- `transitive`: test covers a proven caller/consumer path;
- `candidate`: relationship is heuristic/ambiguous;
- `unknown`: coverage evidence is insufficient.

A "missing test" finding is emitted only when the relevant analysis scope is sufficiently complete to establish that no direct/affected-flow test is known. With incomplete coverage, return `unknown`, not "no test required" or "missing" as a definitive claim.

Generic suggested test-case text may remain as fallback guidance, but it must be clearly separated from discovered test evidence.

## 7. Stable execution-flow identity

Introduce deterministic flow identity derived from semantic identities rather than per-run enumeration:
- canonical entry-point identity;
- ordered canonical step identities;
- call-site identities where needed to distinguish parallel edges;
- flow algorithm/version.

Suggested:
```text
flowFingerprint = hash(version + entryPointCanonicalId + normalizedStepSequence)
flowId = flow:<entryPointCanonicalId>:<shortFingerprint>
```

Persist flow metadata sufficient to distinguish:
- same flow unchanged;
- path changed;
- membership changed;
- added/removed flow.

Flow identity must remain stable across independent full analyses of identical source.

Cluster identity stabilization is not required by this change.

## 8. Flow history and graph diff

After stable IDs are proven:
- enable `SemanticGraphDiff.flows.supported=true`;
- report `added`, `removed`, `path-changed`, `membership-changed`;
- correlate only by stable entry point + proven flow identity/fingerprint;
- ambiguous candidate flows remain separate rather than force-paired.

This enables changed-symbol-to-business-flow reporting and historical evolution.

## 9. Mutation benchmark

Add a repository-local mutation evaluation harness that makes controlled, source-valid changes such as:
- arithmetic/condition change;
- guard inversion/removal;
- changed assignment feeding return value;
- changed argument passed into a callee;
- removed sanitizer/validation call where supported;
- unrelated statement mutation as a negative control.

For every mutation, the fixture declares expected affected statement/function/flow/test evidence.

Compare:
- graph-only PR impact;
- PDG mode.

Release gate for PDG-eligible corpus:
- no more than 2 percentage-point recall regression versus graph mode;
- at least 10% relative precision improvement on the curated mutation corpus, or the feature remains experimental and `auto` does not select PDG by default;
- deterministic output across repeated runs.

## 10. Performance and budgets

PDG work is per changed function and bounded by existing program-analysis limits. Add request-level caps:
- max changed functions analyzed with PDG;
- max statements/blocks per function from existing limits;
- max projected interprocedural hops;
- max total analysis milliseconds;
- max affected/test results.

Cap hits return explicit lower-bound coverage/truncation.

Cache reusable per-function analysis by content + lowering/program-analysis/model fingerprints.

## 11. Compatibility

- `precision` is optional; existing behavior remains graph mode when omitted unless product decision selects `auto` after benchmark gates.
- Existing PR impact fields stay.
- Existing flow nodes require a migration/rebuild because their IDs change. Generation compatibility fingerprint must detect old unstable flow schema and rebuild.
- Snapshot flow diff stays unsupported until the stable identity migration is complete and validated.

## 12. Security and license

No GitNexus implementation is copied. PDG slicing/dataflow is implemented by extending Code Intel's existing engine and standard program-analysis algorithms.

## 13. Non-goals

- whole-program formal verification;
- runtime execution tracing;
- claiming PDG support for unsupported languages;
- adding statement/basic-block nodes to the main graph;
- automatically running tests;
- treating generic suggested cases as proof of coverage.

## 14. Acceptance

A changed statement can be traced through data/control dependence to projected symbols where supported; graph fallback remains safe elsewhere; test results distinguish direct/transitive/candidate/unknown; stable flows diff deterministically; mutation benchmarks quantify benefit.
