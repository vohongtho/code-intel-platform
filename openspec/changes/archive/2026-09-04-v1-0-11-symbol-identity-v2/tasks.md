# Tasks

- [x] Create `code-intel/core/src/identity/contracts.ts` with `LanguageIdentityQualifier`, `SymbolIdentityV2`, `DeclarationFragment`, `CallSiteIdentityV1`, and selection-result unions.
- [x] Create `code-intel/core/src/identity/normalization.ts` with repository-relative path, owner, signature, and deterministic JSON/hash normalization; add cross-platform path tests.
- [x] Create `code-intel/core/src/identity/symbol-identity.ts` and `callsite-identity.ts`; prove deterministic IDs across repeated runs and body-only edits.
- [x] Modify semantic language adapters to provide qualified owner, signature discriminator, visibility qualifier, and declaration-fragment facts.
- [x] Replace `parse-phase.ts` authoritative `${kind}:${name}` dedupe with identity-aware fragment/canonical-symbol projection.
- [x] Refactor `graph/id-generator.ts` into a compatibility facade; retain legacy helper output only for compatibility aliases/tests.
- [x] Create `code-intel/core/src/identity/selector-index.ts` with deterministic multi-candidate indexes and no one-name-one-node overwrite behavior.
- [x] Create `legacy-alias.ts` and map old IDs/simple selectors to one or multiple v2 candidates; return ambiguity instead of first match.
- [x] Extend shared `CodeNode`/`CodeEdge` contracts additively for identity/call-site metadata required by persistence.
- [x] Modify `code-intel/core/src/storage/schema.ts`, graph CSV/bulk writers, LadybugDB loader, export/import, and multi-repo loader so identity metadata and repeated call-site edges survive reopen.
- [x] Add fixtures for TS/JS overload-like declarations where applicable, Java/C#/Kotlin overloads, nested declarations, same-name locals, constructors, C# partials, TS merging, C/C++ forward declarations, and language-specific visibility domains.
- [x] Add tests proving two call sites from one caller to one target remain distinct after persistence/reopen.
- [x] Add body-only edit identity-stability and declaration-change identity tests.
- [x] Add Generation compatibility `identityFingerprint` and automatic full semantic reanalysis on incompatible identity.
- [x] Update MCP/HTTP selector helpers to consume the shared selection union without renaming public tools/routes.
- [x] Run all 15 language gates, normalized graph/evidence fingerprints, package validation, and OpenSpec validation.
