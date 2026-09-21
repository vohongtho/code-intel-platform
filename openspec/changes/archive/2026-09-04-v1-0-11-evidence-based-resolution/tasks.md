# Tasks

- [x] Create `code-intel/core/src/resolution/contracts.ts` with outcome/candidate/coverage/certainty contracts and deterministic candidate ordering.
- [x] Create prepared workspace/declaration/scope/module/type/heritage/registration indexes; add instrumentation for build count and full workspace traversal count.
- [x] Refactor `pipeline/phases/resolve-phase.ts` so semantic facts are authoritative and line-regex imports/calls/heritage are no longer the primary production model.
- [x] Implement lexical/import/public-surface/qualified-owner strategies with bounded cycle-safe re-export traversal.
- [x] Implement receiver/type/member strategies using structured `TypeReferenceFact`; prohibit global generic stripping before language semantics.
- [x] Implement inheritance/interface/protocol/trait candidate-set dispatch and deterministic fan-out truncation metadata.
- [x] Implement callback/delegate/function-value/event/registration strategies for languages with proven static evidence.
- [x] Implement language strategy modules for all 15 registry entries; each module declares capability state and unsupported boundaries.
- [x] Add TS/JS alias/re-export/receiver/callback/structural-shape fixtures and forbidden same-name target cases.
- [x] Add Go value/pointer method-set, embedded promotion, package-sensitive unexported identifier, generic interface, and interface-field dispatch fixtures.
- [x] Add C# overload/interface/record/partial/delegate/event/extension fixtures.
- [x] Add Python direct/package re-export, cycle, alias, local-scope import, ambiguous publication, and dynamic-boundary fixtures.
- [x] Add equivalent Java/Kotlin/C/C++/Rust/PHP/Ruby/Swift/Dart/HTML semantic matrices.
- [x] Add exact-empty proof fixtures ensuring unresolved/unsupported classes prevent exact-safe absence.
- [x] Add adapter-level structural traversal/index-build guards and per-language scaling/retained-heap benchmarks.
- [x] Add `resolverFingerprint`/version to Generation compatibility and automatic full reanalysis when incompatible.
- [x] Remove one-name-one-node authoritative maps from resolver code after all language gates pass.
- [x] Run 15-language correctness/scalability gates, integration/e2e, package validation, and OpenSpec validation.
