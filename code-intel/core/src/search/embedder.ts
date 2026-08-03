import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadConfig } from '../cli/init-wizard.js';
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  resolveEmbeddingModel,
  type EmbeddingModelDescriptor,
} from './embedding-models.js';

export const EMBEDDING_PROVIDER = 'huggingface-transformers';
export const EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL_ID;
export const EMBEDDING_DIMENSION = 384;

export interface EmbeddedNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  text: string;
  embedding: number[];
}

type FeatureExtractionPipeline = (
  text: string | string[],
  opts: Record<string, unknown>,
) => Promise<{ data: Float32Array }>;

const pipelineInstances = new Map<string, FeatureExtractionPipeline>();

export function getConfiguredEmbeddingModel(): EmbeddingModelDescriptor {
  const configured = loadConfig()?.embeddings.model;
  const model = resolveEmbeddingModel(configured);
  if (!model) {
    throw new Error(
      `Unsupported embedding model "${configured}". Choose a supported model in Settings > Embeddings.`,
    );
  }
  return model;
}

export async function getEmbedder(
  model: EmbeddingModelDescriptor = getConfiguredEmbeddingModel(),
): Promise<FeatureExtractionPipeline> {
  const existing = pipelineInstances.get(model.id);
  if (existing) return existing;

  let pipeline: (typeof import('@huggingface/transformers'))['pipeline'];
  try {
    ({ pipeline } = await import('@huggingface/transformers'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Vector embeddings unavailable: install optional dependency @huggingface/transformers (${msg})`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance = (await pipeline('feature-extraction', model.id, {
    dtype: model.dtype,
  } as any)) as unknown as FeatureExtractionPipeline;
  pipelineInstances.set(model.id, instance);
  return instance;
}

export function getEmbeddingFingerprint(
  model: EmbeddingModelDescriptor = getConfiguredEmbeddingModel(),
) {
  return {
    provider: model.provider,
    model: model.id,
    dimension: model.dimension,
  };
}

export function collectEmbeddingCandidates(
  graph: KnowledgeGraph,
  filePaths?: Iterable<string>,
): { id: string; name: string; kind: string; filePath: string; text: string; embeddingSource: 'summary' | 'code' }[] {
  const allowedPaths = filePaths ? new Set(filePaths) : null;
  const candidates: { id: string; name: string; kind: string; filePath: string; text: string; embeddingSource: 'summary' | 'code' }[] = [];

  for (const node of graph.allNodes()) {
    if (['cluster', 'directory', 'flow'].includes(node.kind)) continue;
    if (allowedPaths && !allowedPaths.has(node.filePath)) continue;
    const { text, embeddingSource } = buildText(node);
    candidates.push({ id: node.id, name: node.name, kind: node.kind, filePath: node.filePath, text, embeddingSource });
  }

  return candidates;
}

export async function embedNodes(
  graph: KnowledgeGraph,
  opts: {
    batchSize?: number;
    onProgress?: (done: number, total: number) => void;
    filePaths?: Iterable<string>;
    model?: EmbeddingModelDescriptor;
  } = {},
): Promise<EmbeddedNode[]> {
  const { batchSize = 64, onProgress, filePaths } = opts;
  const model = opts.model ?? getConfiguredEmbeddingModel();
  const candidates = collectEmbeddingCandidates(graph, filePaths);
  const embedder = await getEmbedder(model);
  const results: EmbeddedNode[] = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const texts = batch.map((candidate) => candidate.text);
    const out = await embedder(texts, { pooling: 'mean', normalize: true });

    const expectedLength = batch.length * model.dimension;
    if (out.data.length < expectedLength) {
      throw new Error(
        `Embedding model ${model.id} returned ${out.data.length} values; expected at least ${expectedLength}.`,
      );
    }

    for (let j = 0; j < batch.length; j++) {
      const start = j * model.dimension;
      const embedding = Array.from(out.data.subarray(start, start + model.dimension));
      const candidate = batch[j]!;
      const graphNode = graph.getNode(candidate.id);
      if (graphNode) {
        if (!graphNode.metadata) (graphNode as { metadata: Record<string, unknown> }).metadata = {};
        graphNode.metadata!['embeddingSource'] = candidate.embeddingSource;
      }
      results.push({
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        filePath: candidate.filePath,
        text: candidate.text,
        embedding,
      });
    }

    onProgress?.(Math.min(i + batchSize, candidates.length), candidates.length);
  }

  return results;
}

export function buildText(node: { name: string; kind: string; filePath: string; content?: string | null; metadata?: Record<string, unknown> | null }): { text: string; embeddingSource: 'summary' | 'code' } {
  const sig = node.metadata?.signature as string | undefined;
  const summary = node.metadata?.summary as string | undefined;

  if (summary) {
    const text = `[${node.kind}] ${node.name}\n${sig ?? ''}\n${summary}`.slice(0, 512);
    return { text, embeddingSource: 'summary' };
  }

  const parts: string[] = [`${node.kind} ${node.name}`];
  if (sig) parts.push(sig);
  if (node.content) parts.push(node.content.slice(0, 256));
  parts.push(node.filePath);
  return { text: parts.join(' ').slice(0, 512), embeddingSource: 'code' };
}
