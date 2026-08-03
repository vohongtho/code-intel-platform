# Tasks: Embedding model selector

## 1. Backend model registry

- [ ] Create `code-intel/core/src/search/embedding-model-registry.ts` with `EmbeddingModelDescriptor`, immutable catalog, default-model resolver, ID lookup, availability resolution, and legacy short-ID normalization.
- [ ] Add registry self-validation tests covering duplicate IDs, missing/multiple defaults, invalid dimensions, and unsupported provider/dtype combinations.
- [ ] Register `Xenova/all-MiniLM-L6-v2` as the canonical initial model with dimension `384` and dtype `q8`.

## 2. Configuration validation

- [ ] Update `code-intel/core/src/cli/config-manager.ts` so `embeddings.model` is validated against the backend registry.
- [ ] Reject unknown models when embeddings are enabled with a structured `embeddings.model` validation error and actionable hint.
- [ ] Add compatibility migration for the historical short value `all-MiniLM-L6-v2` without silently mapping arbitrary values.
- [ ] Add unit tests for valid, unknown, unavailable, disabled-embeddings, and legacy-normalization cases.

## 3. Embedding runtime

- [ ] Refactor `code-intel/core/src/search/embedder.ts` to accept a validated model descriptor instead of relying on a single unrelated constant.
- [ ] Key pipeline cache entries by canonical model ID and dtype.
- [ ] Derive expected vector dimension and embedding fingerprint from the selected descriptor.
- [ ] Validate output vector dimensions before accepting a batch.
- [ ] Update every embedder call site to pass the resolved configured model.
- [ ] Add regression tests proving a model change changes the fingerprint and cannot reuse an incompatible pipeline/vector index.

## 4. HTTP API

- [ ] Add `GET /api/v1/embeddings/models` in `code-intel/core/src/http/app.ts` with viewer access.
- [ ] Ensure the catalog endpoint does not call `pipeline()` or trigger model download.
- [ ] Return deterministic descriptors, availability state, unavailable reason, and default model.
- [ ] Add HTTP integration tests for authorization, response shape, no-load side effect, and config validation.

## 5. Web API and types

- [ ] Add catalog response and descriptor types to `code-intel/web/src/api/client.ts` or shared Web types.
- [ ] Add `ApiClient.listEmbeddingModels()` with structured API error handling.
- [ ] Add Web tests for successful, unavailable, malformed, and failed catalog responses.

## 6. Settings UI

- [ ] Replace the Embeddings Model `<input>` in `code-intel/web/src/pages/SettingsPage.tsx` with an accessible `<select>`/combobox.
- [ ] Load the backend model catalog without blocking unrelated Settings sections.
- [ ] Show canonical ID, provider, dimension, availability, loading, retry, and read-only states.
- [ ] Render an explicit unsupported legacy option when persisted config is not in the catalog.
- [ ] Block saving an enabled unsupported/unavailable model and show the server validation hint.
- [ ] Add component tests confirming no editable text input remains for Embeddings Model.

## 7. Metadata and publication safety

- [ ] Ensure embedding metadata records the actual selected descriptor.
- [ ] Ensure `shouldRebuildEmbeddings()` detects model/dimension changes.
- [ ] Abort publication on descriptor/vector dimension mismatch.
- [ ] Add integration coverage for model-change rebuild and trusted-generation preservation on failure.

## 8. Documentation and release validation

- [ ] Update README/Settings documentation with the supported-model selector and catalog behavior.
- [ ] Update 1.0.10 release notes and changelog.
- [ ] Add release-readiness checks that the Settings Model control is not a free-text input and the catalog endpoint returns the canonical default.
- [ ] Run Web tests, core tests, typecheck, build, package validation, and security gate on one final commit.
