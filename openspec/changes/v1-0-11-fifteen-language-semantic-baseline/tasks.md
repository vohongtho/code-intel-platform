# Tasks

- [ ] Create `code-intel/core/src/languages/capability-types.ts` with `CapabilityState`, `LanguageCapabilityDescriptor`, and resolver-performance contract types; add unit tests for invalid/duplicate descriptor definitions.
- [ ] Create `code-intel/core/src/languages/capability-registry.ts` with exactly 15 descriptors and deterministic iteration order; assert every `Language` enum member is represented exactly once.
- [ ] Modify `code-intel/core/src/shared/detection.ts` to derive supported-extension metadata from the registry while preserving the existing `detectLanguage()` contract; add parity tests for every currently accepted extension.
- [ ] Modify `code-intel/core/src/parsing/parser-manager.ts` so grammar artifact metadata is registry-driven without changing bundled/dev fallback behavior; test all 15 WASM artifacts.
- [ ] Modify `code-intel/core/src/pipeline/phases/parse-phase.ts` to derive query selection from the registry; eliminate the independent `LANG_QUERIES` language list.
- [ ] Define and implement the first truthful HTML structural query/adapter semantics in `code-intel/core/src/parsing/queries/html.ts`; test script/link/anchor/form/ID/class and embedded-script ranges, and assert no fake function nodes.
- [ ] Refactor `code-intel/core/tests/unit/pipeline/parser-corpus.test.ts` to enumerate the canonical registry and report Tree-sitter vs regex fallback per language.
- [ ] Create `code-intel/core/tests/semantic-corpus/` fixture directories and manifests for all 15 languages with expected and forbidden observations.
- [ ] Add grouped/multi-declaration fixtures for languages where one syntax wrapper can contain multiple semantic entities.
- [ ] Add production persistence/reopen tests that write each language fixture through the existing LadybugDB bulk path and verify canonical node/relationship content after reload.
- [ ] Add BM25/search/inspect visibility assertions for every language row.
- [ ] Add serial/parallel normalized fingerprint tests and stable ordering of all fingerprint input.
- [ ] Add `code-intel/core/tests/performance/language-resolution-contract.test.ts` driven from the registry; instrument production adapter traversals/index builds and include non-vacuity anchors.
- [ ] Add scaling fixtures for file count, reference/import count, path depth, and same-name collision density; establish accepted baseline budgets before resolver replacement.
- [ ] Add a machine-readable 15-language release report and make one failed accepted row fail the shared semantic release gate.
- [ ] Update README capability documentation to distinguish `supported`, `partial`, `not-applicable`, and `unsupported` after implementation evidence is available.
- [ ] Run `openspec validate`, focused tests, full core tests, `npm run validate:dist --workspace=code-intel/core`, and record the 15-row release evidence.
