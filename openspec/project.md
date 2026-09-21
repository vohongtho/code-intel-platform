# Project Context — Code Intelligence Platform v1.0.12

## Product

Code Intelligence Platform statically analyzes repositories, persists evidence-backed semantic graphs, and exposes code/change intelligence through CLI, HTTP, Web, and MCP. It combines symbol/call/import/inheritance graphs, framework facts, API contracts, semantic snapshots, multi-repository contracts, search, agent workflows, and a separate program-analysis layer.

## Exact planning baseline

The v1.0.12 branch was created from:

```text
main
20e46e8a251eaf52772388a5ef67b4fa290f934f
2026-09-21
```

The package version at this baseline is 1.0.11. v1.0.12 planning therefore treats all released 1.0.11 capabilities and any mainline fixes present at the baseline SHA as existing brownfield behavior.

## What already exists

### Semantic graph and evidence

- canonical identity and legacy IDs;
- evidence-backed relationship certainty, strategy, resolver version and ambiguity;
- framework semantic adapters;
- compact/lazy graph implementations;
- clusters, execution flows, vulnerability nodes and test relationships.

### Search and context

- BM25, vector search and hybrid RRF;
- embedding model registry/fingerprints;
- structured context blocks with hard token budgets;
- adaptive snippets, signature-only low-relevance rendering, trust-ranked evidence;
- cross-block dedup and session-aware source delivery.

### Change intelligence

- textual PR impact and blast radius;
- suggested tests and coverage gaps;
- immutable semantic snapshots for committed Git refs;
- semantic graph diff with conservative rename/move correlation;
- optional API-contract deltas;
- cross-repository contract drift over synchronized groups.

### API intelligence

- normalized HTTP route/request/response/consumer facts;
- producer↔consumer matching by method + normalized path;
- response-key evidence for supported frontend consumers;
- compatibility classification;
- GraphQL and protobuf/gRPC extraction hooks in multi-repo contract sync, but drift remains incomplete/unknown.

### Program analysis

- universal IR;
- CFG construction and validation;
- dominators/control dependence;
- reaching definitions and def/use;
- function summaries;
- PDG construction;
- bounded taint;
- language capability registry and resource-limit semantics.

The advanced layer is not yet broadly connected to PR impact, MCP, HTTP, or Web surfaces.

### Runtime and release

- self-contained runtime bundles for Linux/macOS x64/arm64;
- version pin/upgrade/rollback/uninstall;
- checksum, SBOM and provenance sidecars;
- GitHub artifact attestations;
- keyless cosign signing for Docker images;
- doctor/index trust/runtime verification.

The remaining runtime gap is authenticity verification of the downloadable runtime archive itself from inside Code Intel and a complete offline bundle workflow.

## v1.0.12 product direction

v1.0.12 focuses on **verified change intelligence** rather than adding another parallel graph engine. The release should make Code Intel capable of answering, with explicit evidence and boundaries:

> What will this change affect across statements, symbols, flows, APIs, repositories and tests, and what context does an AI agent need to change it safely?

The eight implementation programs are:

1. adaptive agent exploration;
2. runtime trust and offline installation;
3. ref-aware portable indexes;
4. safe refactoring and architecture guards;
5. change-risk and test intelligence;
6. API/protocol contract intelligence;
7. extensible taint and dispatch;
8. agentic cross-repository change workflows.

See `openspec/changes/v1-0-12-release-program/proposal.md` for the complete F01–F22 mapping.

## Architectural guardrail

Keep two analysis layers:

```text
semantic graph: repository / symbol / API / flow / contract / test
                         |
                         | stable symbol + call-site identity
                         v
program analysis: function IR / CFG / dataflow / PDG / taint
```

Do not flood the main graph with every statement/basic block merely to expose PDG features. Project focused slices and evidence upward when a query needs them.

## Compatibility policy

- Existing current-repository queries require no new arguments.
- Ref-aware queries are additive.
- Existing workflow assets remain installable.
- Existing graph/API/contract response fields remain valid; new fields are additive unless a spec explicitly versions a contract.
- Existing Generation V2 remains the authoritative active-index publication model.
- Semantic snapshots remain the authoritative alternate-ref materialization model.
- Unsupported advanced capability returns a bounded/unknown result rather than a fabricated exact result.

## Definition of done for a v1.0.12 change

1. OpenSpec validation passes.
2. Focused unit/integration/e2e tests pass.
3. Compatibility and migration behavior is tested.
4. Persisted artifacts are reopened when persistence is involved.
5. Agent/MCP outputs are bounded and deterministic.
6. Relevant 15-language capability rows are produced.
7. Security and license review passes for any new dependency.
8. Performance/evaluation thresholds in the change design pass.
9. Existing v1.0.11 workflows remain operational.
10. Build/package/runtime release validation passes on the final release candidate.
