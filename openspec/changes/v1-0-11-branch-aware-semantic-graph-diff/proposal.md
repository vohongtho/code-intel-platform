# Proposal: Branch-Aware Semantic Graph Diff

## Summary

Add immutable semantic snapshot descriptors and normalized graph comparison so `pr_impact` can reason about meaning changes between Git refs rather than only mapping textual hunks onto one graph state.

## User-visible problem

Git diff identifies changed text, but it cannot directly express that a call edge disappeared, a route contract changed, a symbol moved without semantic change, or relationship certainty degraded. Current impact can therefore miss semantic state transitions that are clearer when both base and head are independently analyzed.

## Goals

- Define semantic snapshot identity over Git tree plus analyzer/schema fingerprints.
- Materialize/reuse base and head snapshots without modifying the currently published generation.
- Compare normalized nodes, relationships, routes/contracts, flows, clusters, and certainty metadata.
- Extend existing `pr_impact` with optional snapshot-backed mode.
- Add `code-intel graph diff --base ... --head ...` and equivalent MCP/HTTP query only where it adds semantic-diff output rather than duplicating impact tools.
- Provide deterministic machine-readable diff for CI and Web visualization.

## In scope

- Commit/tree refs and clean worktree snapshot descriptors.
- Node add/remove/change/move evidence.
- Edge add/remove/change including certainty changes.
- API-contract and flow deltas when corresponding artifacts exist.
- Snapshot cache/reuse and bounded storage policy.
- Incremental construction where correctness can be proven; full temporary analysis fallback otherwise.

## Non-goals

- Source merge/conflict resolution.
- Persisting every commit in repository history automatically.
- Treating display-name equality as rename proof.
- Replacing textual diff; line hunks remain supporting evidence.

## Dependencies

Depends on Generation V2, canonical identity, relationship certainty, and semantic fact fingerprints. API/contract sections depend on their respective proposals.

## Release risk

High. Snapshot isolation, Git ref safety, storage lifetime, and semantic normalization must be correct. Initial implementation should prefer correctness and full temporary analysis over unsafe incremental shortcuts.

## Security

Git refs and paths must be passed through existing safe Git process APIs; never shell-interpolate refs.
