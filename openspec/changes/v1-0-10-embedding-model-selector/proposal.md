# v1.0.10: Replace the Embeddings model text input with a supported-model selector

## Change ID

`v1-0-10-embedding-model-selector`

## Release

`1.0.10`

## Priority

`P1 — Configuration correctness and safer UX`

## Owner area

`web-settings-and-embedding-runtime`

## One-liner

Replace the free-text Embeddings Model field with a backend-authoritative pull-down that exposes only runtime-supported models and ensures the selected model is the model actually used for embedding generation.

---

## 1. Summary

The Settings page currently renders `config.embeddings.model` as a free-text `<input>`. This permits arbitrary values even though the embedding runtime is not dynamically driven by that value. The current embedder exports a hard-coded model constant:

```ts
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
```

This creates two separate problems:

1. the UI suggests that any model name can be configured;
2. changing the value may not change the model used by the runtime.

Version 1.0.10 will establish a single supported-model catalog owned by the backend. The Web Settings page will render a pull-down from that catalog, preserve valid existing configuration, clearly identify unsupported legacy values, and prevent saving a value that the runtime cannot load.

---

## 2. Current behavior

The Embeddings settings section currently uses:

```tsx
<Field label="Model">
  <input
    value={config.embeddings.model}
    onChange={...}
  />
</Field>
```

The configuration type accepts any string:

```ts
embeddings: {
  model: string;
  enabled: boolean;
}
```

The runtime embedder separately uses a compile-time model constant. Therefore UI state, persisted configuration, embedding metadata, and runtime execution can diverge.

---

## 3. User-visible problem

An administrator can enter a typo or an unsupported identifier such as:

```text
all-minilm-l6
```

The settings form may accept and persist it, but the runtime may still load:

```text
Xenova/all-MiniLM-L6-v2
```

This is misleading and can also cause incorrect assumptions when diagnosing vector-index fingerprints, rebuilds, model dimensions, memory usage, or search quality.

---

## 4. Required behavior

### 4.1 Backend-owned model catalog

The backend MUST define one embedding-model registry containing only models supported by the current runtime implementation.

Each catalog entry MUST include:

```ts
interface EmbeddingModelDescriptor {
  id: string;
  label: string;
  provider: 'huggingface-transformers';
  dimension: number;
  dtype: 'q8' | 'fp32';
  default: boolean;
  available: boolean;
  description?: string;
}
```

For the initial 1.0.10 implementation, the catalog may contain only the currently supported model:

```text
Xenova/all-MiniLM-L6-v2
```

The pull-down is still required even when the initial catalog has one entry because it makes the supported contract explicit and safely extensible.

### 4.2 Catalog API

Add a read-only endpoint:

```http
GET /api/v1/embeddings/models
```

Response:

```json
{
  "models": [
    {
      "id": "Xenova/all-MiniLM-L6-v2",
      "label": "all-MiniLM-L6-v2",
      "provider": "huggingface-transformers",
      "dimension": 384,
      "dtype": "q8",
      "default": true,
      "available": true,
      "description": "Fast 384-dimensional local sentence embedding model"
    }
  ],
  "defaultModel": "Xenova/all-MiniLM-L6-v2"
}
```

The endpoint MUST NOT trigger model download or inference.

### 4.3 Settings pull-down

The Embeddings `Model` control MUST be a `<select>` or accessible combobox populated from the catalog API.

The control MUST:

- display a human-readable label;
- persist the canonical model ID;
- show dimension and provider information near the selection;
- be disabled while the catalog is loading;
- show a recoverable inline error if the catalog cannot be loaded;
- remain read-only for users without settings-edit permission;
- never allow an arbitrary unsupported value to be submitted.

### 4.4 Runtime configuration must be effective

The embedder MUST resolve its model from validated configuration rather than always using an unrelated compile-time constant.

The selected descriptor determines:

- model ID passed to `pipeline('feature-extraction', modelId, ...)`;
- expected embedding dimension;
- quantization/dtype options;
- embedding fingerprint stored in metadata;
- vector-index rebuild decision.

A saved model selection that differs from the active vector metadata MUST cause the existing fingerprint logic to mark embeddings stale and rebuild them through the normal analysis flow.

### 4.5 Validation

`PUT /api/v1/config` MUST reject an embeddings model not present and available in the model catalog.

Validation response MUST identify:

```text
path: embeddings.model
reason: Unsupported embedding model
hint: Select one of the models returned by GET /api/v1/embeddings/models
```

### 4.6 Legacy configuration

When an existing configuration contains an unknown model value:

- the page MUST not silently replace it before the user saves;
- the selector MUST show an `Unsupported legacy model` option containing the current value;
- the Save action MUST remain blocked until the administrator chooses a supported model, unless embeddings are disabled and the server explicitly permits preserving the legacy value;
- the UI MUST explain that enabling embeddings requires a supported model;
- the backend MUST not silently fall back to a different model.

### 4.7 Loading and availability states

A catalog entry may be known but unavailable because the optional embedding dependency is not installed.

Unavailable entries MUST:

- be visible for diagnostics;
- be disabled in the pull-down;
- include an availability reason;
- never be accepted by server validation for an enabled embeddings configuration.

### 4.8 Accessibility

The selector MUST have an associated label, keyboard navigation, visible focus, and descriptive text for dimension/provider/availability. Error text MUST be linked using `aria-describedby`.

---

## 5. Proposed architecture

Create a shared backend registry:

```text
code-intel/core/src/search/embedding-model-registry.ts
```

Suggested exports:

```ts
export const EMBEDDING_MODELS: readonly EmbeddingModelDescriptor[];
export function getEmbeddingModel(id: string): EmbeddingModelDescriptor | null;
export function getDefaultEmbeddingModel(): EmbeddingModelDescriptor;
export function validateEmbeddingModel(id: string, enabled: boolean): ValidationResult;
```

Update:

```text
code-intel/core/src/search/embedder.ts
code-intel/core/src/cli/config-manager.ts
code-intel/core/src/http/app.ts
code-intel/web/src/api/client.ts
code-intel/web/src/state/types.ts
code-intel/web/src/pages/SettingsPage.tsx
```

The registry is the only source of supported IDs and runtime dimensions.

---

## 6. API and UI flow

```text
Settings page opens
  -> GET /api/v1/config
  -> GET /api/v1/embeddings/models
  -> render selected canonical model
  -> administrator chooses model
  -> PUT /api/v1/config
  -> backend validates against registry
  -> next embedding build uses selected descriptor
  -> metadata fingerprint records actual model and dimension
```

---

## 7. In scope

- backend model catalog;
- catalog endpoint;
- Embeddings Model pull-down;
- loading, unavailable, and legacy states;
- config validation against catalog;
- runtime use of selected model;
- fingerprint/rebuild consistency;
- unit, HTTP, Web, and integration tests;
- Settings documentation updates.

---

## 8. Non-goals

This change will not:

- provide an arbitrary Hugging Face model input;
- download a model while rendering Settings;
- benchmark models in the browser;
- add remote embedding providers;
- automatically migrate vector dimensions without rebuilding;
- expose unsupported models merely because they exist on Hugging Face;
- change the LLM Model input in this proposal.

---

## 9. Compatibility

- Existing valid `Xenova/all-MiniLM-L6-v2` configuration remains valid.
- The short legacy value `all-MiniLM-L6-v2` MAY be normalized once to the canonical ID during config migration, with a recorded warning.
- Existing vector indexes remain valid when their fingerprint matches the selected canonical descriptor.
- Unknown values are preserved for display but cannot be used as if supported.

---

## 10. Failure semantics

- Catalog API failure: Settings remains usable outside Embeddings; model control shows retry state.
- Invalid saved value: do not crash; render legacy warning and require correction.
- Optional dependency unavailable: catalog returns `available: false`; enabling embeddings is rejected.
- Runtime model-load failure: return a clear embedding error and preserve the last trusted vector generation.
- Dimension mismatch: abort vector publication; never publish vectors with a descriptor/row-dimension mismatch.

---

## 11. Security and safety

- Never execute or dynamically import user-entered model identifiers.
- Only registry entries can reach the model loader.
- Do not expose local cache paths.
- Do not trigger network downloads from the catalog endpoint.
- Validate model ID again at runtime, not only in the browser.

---

## 12. Acceptance criteria

1. The Embeddings Model setting is no longer a free-text input.
2. Options come from `GET /api/v1/embeddings/models`.
3. The canonical selected model is the model passed to the embedding pipeline.
4. Unsupported values cannot be newly saved.
5. Legacy unsupported values render without crashing or silent replacement.
6. Model changes invalidate the prior embedding fingerprint and require rebuild.
7. The vector dimension is derived from the selected descriptor.
8. Viewer/non-admin users can view but cannot modify the selector.
9. Catalog, validation, Settings, runtime, and fingerprint regression tests pass.
10. The package build and release gates pass on one candidate commit.

---

## 13. Final decision

Version 1.0.10 will replace the misleading free-text Embeddings Model field with a backend-authoritative selector and will make the selected value operationally effective across configuration, runtime loading, metadata, and vector-index lifecycle.
