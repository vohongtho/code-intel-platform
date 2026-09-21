# Proposal: Harden Generation V2 with Semantic Verification and Derived Compatibility

## Summary

Extend the existing Generation V2 publication model so a generation is not merely atomically published but also proven semantically compatible and reopenable before `current.json` changes.

## Existing v1.0.10 strength to reuse

Generation V2 already provides staging directories, immutable published generations, analysis locks, pinned snapshots, selective artifact seeding, rollback safety, cleanup, and legacy migration. v1.0.11 MUST keep that architecture.

## Remaining gap

A required artifact can exist and be non-empty while still containing incomplete semantic output. File/stat fingerprints and manually maintained schema versions also cannot prove compatibility after parser/fact/identity/resolver semantics change without changing basic file layout.

## User-visible problem

MCP/HTTP/Web can trust a fresh generation that is structurally present but semantically collapsed or incompatible. This is especially dangerous after the resolver/evidence migration because downstream tools may confidently analyze incomplete relationships.

## Goals

- Add derived fingerprints for graph DDL, analyzer/fact projection, language registry/adapters, fact schema, identity, resolver, evidence schema, and embedding configuration.
- Add produced-vs-persisted artifact receipts.
- Reopen staging graph/BM25/vector/evidence through production read paths before publication.
- Detect collapsed/partial/unverified/corrupt required artifacts.
- Make index trust artifact-specific and truthful.
- Choose reuse/metadata migration/artifact rebuild/full reanalysis/reject-corrupt automatically.
- Preserve the previously published generation whenever candidate verification fails.

## Scope

### In scope

- Generation manifest compatibility receipts.
- Artifact verification states and counts/fingerprints.
- Post-persist read-back before pointer replacement.
- `index-trust.ts` artifact-level trust.
- Analysis-plan compatibility decisions.
- Failure injection for non-empty-but-wrong artifacts.

### Non-goals

- Replacing Generation V2.
- Public migration command.
- Requiring vector artifacts when embeddings are disabled.
- Deleting legacy migration inputs implicitly.

## Compatibility

Generation-v1/v2 manifests remain readable through normalization. New fields are additive. Ordinary `analyze` decides rebuild/migration automatically.

## Dependencies

Can be implemented after identity/resolver/evidence schemas are defined; dependency-aware incremental publication relies on it.

## Release risk

Medium-to-high. The main risk is over-triggering rebuilds; correctness requires conservative rebuild when compatibility cannot be proven.

## Performance impact

Low-to-medium on publication. Read-back verification adds I/O only when publishing a generation, not on no-op analysis. Large-graph fingerprint strategy may use streaming hashes/receipts.

## License/IP

Original extension of Code Intel's Generation V2.
