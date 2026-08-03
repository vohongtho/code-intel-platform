export interface EmbeddingModelDescriptor {
  id: string;
  label: string;
  provider: 'huggingface-transformers';
  dimension: number;
  dtype: 'q8' | 'fp32';
  maxSequenceLength: number;
  description: string;
  aliases: string[];
}

const MODELS: readonly EmbeddingModelDescriptor[] = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'all-MiniLM-L6-v2',
    provider: 'huggingface-transformers',
    dimension: 384,
    dtype: 'q8',
    maxSequenceLength: 512,
    description: 'Fast general-purpose sentence embedding model optimized for local CPU inference.',
    aliases: ['all-MiniLM-L6-v2'],
  },
] as const;

export const DEFAULT_EMBEDDING_MODEL_ID = MODELS[0].id;

export function listEmbeddingModels(): EmbeddingModelDescriptor[] {
  return MODELS.map((model) => ({ ...model, aliases: [...model.aliases] }));
}

export function resolveEmbeddingModel(modelId?: string | null): EmbeddingModelDescriptor | null {
  const candidate = modelId?.trim();
  if (!candidate) return MODELS[0];
  const match = MODELS.find((model) => model.id === candidate || model.aliases.includes(candidate));
  return match ? { ...match, aliases: [...match.aliases] } : null;
}

export function normalizeEmbeddingModelId(modelId?: string | null): string {
  return resolveEmbeddingModel(modelId)?.id ?? modelId?.trim() ?? DEFAULT_EMBEDDING_MODEL_ID;
}

export function supportedEmbeddingModelIds(): string[] {
  return MODELS.map((model) => model.id);
}
