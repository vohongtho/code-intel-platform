# Proposal: Cross-Repository Contract Drift

## Summary

Upgrade existing repository groups and `group_contracts` from discovery/linking into semantic compatibility analysis across producer and consumer repositories.

## Baseline

The platform already groups repositories, synchronizes them, performs federated search, and extracts export/route/schema/event contracts. This proposal preserves those workflows and adds versioned contract fingerprints, producer-consumer usage evidence, and drift classification.

## User-visible problem

A backend, shared-schema, or event change can be locally valid while breaking another repository. Today the group graph can expose related contracts, but it cannot consistently answer whether a proposed change is compatible with known consumers or which exact consumer properties/handlers are affected.

## Goals

- Compare group contract states across base/head semantic snapshots.
- Cover HTTP, schema, and event contracts first; provide extension points for GraphQL and protobuf/gRPC.
- Connect contract changes to known consumers, repositories, flows, and tests.
- Classify compatibility with certainty and coverage.
- Add `group_contract_drift` rather than creating another general group search/impact tool.
- Integrate findings into existing `pr_impact` when the repository belongs to a synchronized group.

## In scope

- Stable contract identity and fingerprints.
- Producer/consumer role metadata.
- HTTP route/shape changes from graph-aware API contracts.
- Shared schema property/type/requiredness changes.
- Event topic/name/payload-shape changes where statically modeled.
- Base/head diff, repository-group aggregation, deterministic findings.
- Compatibility policy hooks for contract kind.

## Non-goals

- Runtime deployment coordination.
- Semantic version publication automation.
- Guaranteeing compatibility for unknown runtime consumers.
- Treating an unsynchronized repository as evidence that no consumer exists.

## Compatibility

Existing `group_list`, `group_sync`, `group_contracts`, `group_query`, and group status behavior remains. Drift results are additive.

## Dependencies

Depends on canonical identities, relationship certainty, semantic snapshots, and graph-aware API contracts for HTTP shape compatibility.

## Release risk

Medium-high because incorrect negative findings could block safe releases or, worse, incorrect safe findings could hide cross-repo breaks. Unknown coverage must therefore be first-class.

## License/IP

Original implementation using Code Intel's existing group model.
