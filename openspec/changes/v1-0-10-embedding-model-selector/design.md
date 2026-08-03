# Design: Embedding model selector and runtime registry

## 1. Context

The current Settings page stores an arbitrary `embeddings.model` string, while `embedder.ts` independently uses hard-coded constants for model ID and dimension. The design must remove that split-brain state without allowing arbitrary model execution.

## 2. Invariants

1. A model selectable in the Web UI is registered and supported by the backend.
2. A model accepted by config validation is loadable by the embedding runtime.
3. The fingerprint records the model and dimension actually used.
4. A model change cannot reuse vectors built with another model or dimension.
5. Reading the model catalog has no model-download side effect.
6. Unsupported legacy values are visible and recoverable, never silently remapped to an unrelated model.

## 3. Components

### 3.1 `embedding-model-registry.ts`

Add a pure registry containing immutable descriptors.

```ts
export interface EmbeddingModelDescriptor {
  id: string;
  label: string;
  provider: 'huggingface-transformers';
  dimension: number;
  dtype: 'q8' | 'fp32';
  default: boolean;
  description?: string;
}

export interface EmbeddingModelAvailability extends EmbeddingModelDescriptor {
  available: boolean;
  unavailableReason?: string;
}
```

The initial registry contains `Xenova/all-MiniLM-L6-v2`, dimension 384, dtype q8.

Registry validation runs at module initialization in tests and asserts:

- IDs are unique;
- exactly one default exists;
- dimension is a positive integer;
- labels are non-empty;
- provider/dtype values are supported by the loader.

### 3.2 Availability resolver

Availability is derived without loading a model. It may check whether `@huggingface/transformers` can be resolved, but MUST not invoke `pipeline()`.

### 3.3 Config manager

`validateConfig()` resolves `config.embeddings.model` against the registry. When embeddings are enabled, unknown or unavailable models are validation errors. A compatibility normalizer may convert the historical short ID `all-MiniLM-L6-v2` to `Xenova/all-MiniLM-L6-v2`.

### 3.4 Embedder

Replace compile-time model/dimension assumptions with a model runtime context:

```ts
interface EmbeddingRuntimeConfig {
  descriptor: EmbeddingModelDescriptor;
}

getEmbedder(config): Promise<EmbeddingPipeline>
embedNodes(graph, { model, batchSize, ... }): Promise<EmbeddedNode[]>
getEmbeddingFingerprint(model): EmbeddingFingerprint
```

Pipeline caching MUST be keyed by model ID and dtype. A cached pipeline for model A cannot satisfy a request for model B.

The output length MUST be validated against `descriptor.dimension` for each batch before vectors are accepted.

### 3.5 HTTP catalog

`GET /api/v1/embeddings/models` is authenticated with viewer access. It returns sanitized descriptors and availability state. It does not return cache directories or environment details.

### 3.6 Web client and state

Add:

```ts
ApiClient.listEmbeddingModels()
EmbeddingModelDescriptor
EmbeddingModelCatalog
```

Settings keeps catalog loading/error state local to the Embeddings section or in config state. Config loading and catalog loading may run concurrently.

### 3.7 Settings selector

Use a native `<select>` initially for accessibility and predictable behavior. Options show label; helper text shows canonical ID, dimension, and provider. Unavailable options are disabled.

When the configured value is absent from the catalog, prepend a disabled legacy option:

```text
Unsupported legacy model: <value>
```

The form retains that value until an administrator selects a valid option.

## 4. Data flow

```text
GET config ─────────────┐
                        ├─> Settings selector ─> PUT config
GET model catalog ──────┘                         │
                                                  v
                                        server validation
                                                  │
                                                  v
                                      analyze/vector build
                                                  │
                                                  v
                           registry descriptor -> loader/fingerprint/dimension
```

## 5. Model-change lifecycle

1. Admin saves a different registered model.
2. Existing vector metadata still records the old fingerprint.
3. `shouldRebuildEmbeddings()` compares old metadata with the selected runtime descriptor.
4. The next vector-capable analysis rebuilds vectors in staging.
5. Publication validation checks dimension/fingerprint consistency.
6. The new generation is published atomically.

The Settings save operation itself does not mutate an active generation.

## 6. API contract

```ts
interface EmbeddingModelCatalogResponse {
  models: EmbeddingModelAvailability[];
  defaultModel: string;
}
```

Responses are deterministic and sorted with the default first, then label.

## 7. Error handling

- Catalog request error: show inline retry, preserve existing settings state.
- Unsupported configured value: show legacy option and validation notice.
- Model unavailable: disabled option with reason.
- Loader failure: propagate a typed embedding-runtime error.
- Dimension mismatch: abort build and mark embeddings stale/failed; do not publish.

## 8. Testing strategy

### Core unit

- registry uniqueness/default validation;
- ID lookup and legacy normalization;
- enabled config rejects unknown/unavailable model;
- pipeline cache keys include model ID/dtype;
- output dimension mismatch fails.

### HTTP

- viewer can list models;
- catalog does not initialize pipeline;
- config update accepts registered model;
- config update rejects unsupported model with path/hint.

### Web

- model control is a select, not text input;
- catalog options render;
- non-admin control is disabled;
- unavailable option is disabled;
- legacy configured value renders warning;
- selecting a model updates canonical ID;
- catalog failure does not break other Settings sections.

### Integration

- selected model appears in embedding metadata;
- changing model causes fingerprint rebuild decision;
- published vector rows match descriptor dimension.

## 9. Alternatives rejected

### Keep free-text input with autocomplete

Rejected because arbitrary strings still enter persisted config and runtime validation becomes delayed.

### Hard-code options only in React

Rejected because Web and runtime would drift again.

### Allow any Hugging Face model

Rejected because dimensions, pooling, tokenizer support, dtype, licensing, and memory requirements are not automatically safe.

### Change the label only

Rejected because the underlying runtime/config mismatch would remain.

## 10. Rollout and rollback

The registry starts with the existing model, minimizing behavior change. Rollback may restore the old UI while retaining registry validation, but runtime must never revert to silently ignoring configured values.
