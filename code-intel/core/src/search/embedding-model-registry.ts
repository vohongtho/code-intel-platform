import { createRequire } from 'node:module';

export type EmbeddingModelProvider = 'huggingface-transformers';
export type EmbeddingModelDType = 'q8' | 'fp32';

export interface EmbeddingModelDescriptor {
  id: string;
  label: string;
  provider: EmbeddingModelProvider;
  dimension: number;
  dtype: EmbeddingModelDType;
  default: boolean;
  description?: string;
}

export interface EmbeddingModelAvailability extends EmbeddingModelDescriptor {
  available: boolean;
  unavailableReason?: string;
}

const require = createRequire(import.meta.url);
const LEGACY_MODEL_IDS = new Map<string, string>([
  ['all-MiniLM-L6-v2', 'Xenova/all-MiniLM-L6-v2'],
]);

export const EMBEDDING_MODELS: readonly EmbeddingModelDescriptor[] = Object.freeze([
  Object.freeze({
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'all-MiniLM-L6-v2',
    provider: 'huggingface-transformers',
    dimension: 384,
    dtype: 'q8',
    default: true,
    description: 'Fast 384-dimensional local sentence embedding model',
  }),
]);

function assertValidRegistry(models: readonly EmbeddingModelDescriptor[]): void {
  const seen = new Set<string>();
  let defaults = 0;

  for (const model of models) {
    if (seen.has(model.id)) throw new Error(`Duplicate embedding model id: ${model.id}`);
    seen.add(model.id);
    if (!model.label.trim()) throw new Error(`Embedding model label must be non-empty: ${model.id}`);
    if (!Number.isInteger(model.dimension) || model.dimension <= 0) {
      throw new Error(`Embedding model dimension must be a positive integer: ${model.id}`);
    }
    if (model.provider !== 'huggingface-transformers') {
      throw new Error(`Unsupported embedding model provider: ${model.provider}`);
    }
    if (model.dtype !== 'q8' && model.dtype !== 'fp32') {
      throw new Error(`Unsupported embedding model dtype: ${model.id} (${model.dtype})`);
    }
    if (model.default) defaults++;
  }

  if (defaults !== 1) throw new Error(`Embedding model registry must define exactly one default model, found ${defaults}`);
}

assertValidRegistry(EMBEDDING_MODELS);

export function normalizeEmbeddingModelId(id: string): string {
  return LEGACY_MODEL_IDS.get(id) ?? id;
}

export function getEmbeddingModel(id: string): EmbeddingModelDescriptor | null {
  const normalized = normalizeEmbeddingModelId(id);
  return EMBEDDING_MODELS.find((model) => model.id === normalized) ?? null;
}

export function getDefaultEmbeddingModel(): EmbeddingModelDescriptor {
  const model = EMBEDDING_MODELS.find((entry) => entry.default);
  if (!model) throw new Error('Default embedding model missing');
  return model;
}

export function resolveEmbeddingModelAvailability(descriptor: EmbeddingModelDescriptor): EmbeddingModelAvailability {
  if (descriptor.provider === 'huggingface-transformers') {
    try {
      require.resolve('@huggingface/transformers');
      return { ...descriptor, available: true };
    } catch {
      return {
        ...descriptor,
        available: false,
        unavailableReason: 'Optional dependency @huggingface/transformers is not installed',
      };
    }
  }

  return {
    ...descriptor,
    available: false,
    unavailableReason: `Unsupported provider: ${descriptor.provider}`,
  };
}

export function listEmbeddingModels(): EmbeddingModelAvailability[] {
  return EMBEDDING_MODELS
    .map(resolveEmbeddingModelAvailability)
    .sort((a, b) => {
      if (a.default !== b.default) return a.default ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

export function getEmbeddingModelCatalog(): { models: EmbeddingModelAvailability[]; defaultModel: string } {
  const defaultModel = getDefaultEmbeddingModel().id;
  return { models: listEmbeddingModels(), defaultModel };
}
