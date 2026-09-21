# Proposal: Add Symbol Identity v2 and Declaration Fragments

## Summary

Replace production simple-name identity with a canonical, versioned symbol identity that can distinguish overloads, nested declarations, same-name locals, constructors, visibility domains, and language-specific ownership while preserving partial/declaration-merged symbols as one canonical symbol with multiple declaration fragments.

Also add call-site identity so two invocations from the same caller to the same target remain distinguishable evidence rather than collapsing into one relationship ID.

## Production-baseline evidence

In v1.0.10, `graph/id-generator.ts::generateNodeId()` is exactly `kind:filePath:qualifiedName`, while production Tree-sitter extraction calls it with the simple captured declaration name. `parse-phase.ts::extractFromTree()` also deduplicates definitions using `${kind}:${name}` within a file. `generateEdgeId()` is only `kind:source->target`.

Consequences include potential loss/collision for overloads, nested declarations, constructors with multiple signatures, declaration merging, and repeated call sites.

## User-visible correctness problem

Wrong or collapsed identity makes every later analysis unstable: search can return the wrong symbol, resolver candidates overwrite each other, blast radius merges distinct entities, and relationship explanations cannot point to the exact call site that produced an edge.

## Goals

- Introduce deterministic `SymbolIdentityV2` with owner/signature/language qualifiers.
- Keep IDs stable across body-only edits.
- Introduce `DeclarationFragment` for partial/merged/forward declarations.
- Introduce `CallSiteIdentityV1` and relationship IDs that can preserve multiple call sites.
- Add canonical selector indexes by ID, qualified name, simple name, owner, and legacy ID.
- Preserve existing public string IDs and legacy selectors through compatibility resolution.
- Return ambiguity instead of silently choosing when a legacy/simple selector maps to multiple canonical symbols.

## Scope

### In scope

- Versioned identity types and deterministic hashing/normalization.
- Language-specific identity qualifier hook.
- Declaration fragments and canonical symbol merge rules.
- Call-site IDs and relationship identity v2.
- LadybugDB/CSV/reload changes needed to persist compact identity metadata.
- Automatic Generation V2 rebuild when old identity cannot satisfy v2 semantics.

### Non-goals

- Stable identity across arbitrary semantic renames/moves.
- Automatic source refactoring.
- Exposing a new mandatory selector syntax.
- Creating graph nodes for every fragment or call site by default.

## Compatibility

Existing CLI/MCP/HTTP selectors continue to work when unambiguous. New metadata is additive. No migration command is introduced.

## Migration

Identity schema/fingerprint becomes part of generation compatibility. Ordinary `code-intel analyze` automatically performs a full semantic reanalysis when an old generation lacks required v2 identity.

## Dependencies

Depends on `v1-0-11-universal-semantic-fact-model`.

## Release risk

High. IDs are pervasive. Rollout must keep legacy-ID aliases, compare old/new semantic snapshots, and prove body-only stability plus deterministic rebuilds.

## Performance impact

Low-to-medium. Multi-candidate indexes use more memory than a one-name-one-node map, but eliminate overwrite-based correctness loss and support O(1)/indexed candidate lookup.

## License/IP

Original Code Intel implementation. No competitor source reuse required.
