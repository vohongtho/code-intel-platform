# Tasks

- [ ] Create `code-intel/core/src/resolution/contracts.ts` with outcome/candidate/coverage/certainty contracts and deterministic candidate ordering.
- [ ] Create prepared workspace/declaration/scope/module/type/heritage/registration indexes; add instrumentation for build count and full workspace traversal count.
- [ ] Refactor `pipeline/phases/resolve-phase.ts` so semantic facts are authoritative and line-regex imports/calls/heritage are no longer the primary production model.
- [ ] Implement lexical/import/public-surface/qualified-owner strategies with bounded cycle-safe re-export traversal.
- [ ] Implement receiver/type/member strategies using structured `TypeReferenceFact`; prohibit global generic stripping before language semantics.
- [ ] Implement inheritance/interface/protocol/trait candidate-set dispatch and deterministic fan-out truncation metadata.
- [ ] Implement callback/delegate/function-value/event/registration strategies for languages with proven static evidence.
- [ ] Implement language strategy modules for all 15 registry entries; each module declares capability state and unsupported boundaries.
- [ ] Add TS/JS alias/re-export/receiver/callback/structural-shape fixtures and forbidden same-name target cases.
- [ ] Add Go value/pointer method-set, embedded promotion, package-sensitive unexported identifier, generic interface, and interface-field dispatch fixtures.
- [ ] Add C# overload/interface/record/partial/delegate/event/extension fixtures.
- [ ] Add Python direct/package re-export, cycle, alias, local-scope import, ambiguous publication, and dynamic-boundary fixtures.
- [ ] Add equivalent Java/Kotlin/C/C++/Rust/PHP/Ruby/Swift/Dart/HTML semantic matrices.
- [ ] Add exact-empty proof fixtures ensuring unresolved/unsupported classes prevent exact-safe absence.
- [ ] Add adapter-level structural traversal/index-build guards and per-language scaling/retained-heap benchmarks.
- [ ] Add `resolverFingerprint`/version to Generation compatibility and automatic full reanalysis when incompatible.
- [ ] Remove one-name-one-node authoritative maps from resolver code after all language gates pass.
- [ ] Run 15-language correctness/scalability gates, integration/e2e, package validation, and OpenSpec validation.
