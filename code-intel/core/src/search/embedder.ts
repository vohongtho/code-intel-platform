import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { getDefaultEmbeddingModel, type EmbeddingModelDescriptor } from './embedding-model-registry.js';

export const EMBEDDING_PROVIDER = 'huggingface-transformers';
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSION = 384;

export interface EmbeddedNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  text: string;
  embedding: number[];
}

export interface EmbeddingFingerprint {
  provider: string;
  model: string;
  dimension: number;
}

export interface EmbeddingRuntimeConfig {
  descriptor: EmbeddingModelDescriptor;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmbeddingPipeline = (text: string | string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;

const pipelineCache = new Map<string, EmbeddingPipeline>();

function getPipelineCacheKey(descriptor: EmbeddingModelDescriptor): string {
  return `${descriptor.id}:${descriptor.dtype}`;
}

function resolveRuntimeConfig(config?: Partial<EmbeddingRuntimeConfig>): EmbeddingRuntimeConfig {
  return { descriptor: config?.descriptor ?? getDefaultEmbeddingModel() };
}

export async function getEmbedder(config?: Partial<EmbeddingRuntimeConfig>): Promise<EmbeddingPipeline> {
  const { descriptor } = resolveRuntimeConfig(config);
  const cacheKey = getPipelineCacheKey(descriptor);
  const cached = pipelineCache.get(cacheKey);
  if (cached) return cached;

  let pipeline: (typeof import('@huggingface/transformers'))['pipeline'];
  try {
    ({ pipeline } = await import('@huggingface/transformers'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Vector embeddings unavailable: install optional dependency @huggingface/transformers (${msg})`);
  }
  // dtype:'q8' loads the int8-quantized ONNX weights — ~2-4× faster on CPU,
  // negligible quality difference for code-symbol embeddings.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const embedder = (await pipeline('feature-extraction', descriptor.id, { dtype: descriptor.dtype } as any)) as unknown as EmbeddingPipeline;
  pipelineCache.set(cacheKey, embedder);
  return embedder;
}

export function getEmbeddingFingerprint(config?: Partial<EmbeddingRuntimeConfig>): EmbeddingFingerprint {
  const { descriptor } = resolveRuntimeConfig(config);
  return {
    provider: descriptor.provider,
    model: descriptor.id,
    dimension: descriptor.dimension,
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
  opts: { batchSize?: number; onProgress?: (done: number, total: number) => void; filePaths?: Iterable<string>; model?: EmbeddingModelDescriptor } = {},
): Promise<EmbeddedNode[]> {
  // Larger batch = fewer forward passes = faster overall
  const { batchSize = 64, onProgress, filePaths, model } = opts;

  // Collect candidates — skip cluster/directory/flow to save time
  const candidates = collectEmbeddingCandidates(graph, filePaths);

  const descriptor = model ?? getDefaultEmbeddingModel();
  const embedder = await getEmbedder({ descriptor });
  const results: EmbeddedNode[] = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const texts = batch.map((c) => c.text);

    // ── True batch inference ──────────────────────────────────────────────────
    // Pass the entire texts array in one forward pass instead of N sequential
    // calls.  The pipeline returns a flat Float32Array of shape [B * EMBED_DIM].
    const out = await embedder(texts, { pooling: 'mean', normalize: true });

    for (let j = 0; j < batch.length; j++) {
      const start = j * descriptor.dimension;
      // subarray() gives a view (no copy) into the underlying buffer
      const embedding = Array.from(out.data.subarray(start, start + descriptor.dimension));
      if (embedding.length !== descriptor.dimension) {
        throw new Error(`Embedding dimension mismatch for ${descriptor.id}: expected ${descriptor.dimension}, got ${embedding.length}`);
      }
      const candidate = batch[j];

      // Mark the node with embeddingSource so callers know which path was used
      const graphNode = graph.getNode(candidate.id);
      if (graphNode) {
        if (!graphNode.metadata) (graphNode as { metadata: Record<string, unknown> }).metadata = {};
        graphNode.metadata!['embeddingSource'] = candidate.embeddingSource;
      }

      results.push({ id: candidate.id, name: candidate.name, kind: candidate.kind, filePath: candidate.filePath, text: candidate.text, embedding });
    }

    onProgress?.(Math.min(i + batchSize, candidates.length), candidates.length);
  }

  return results;
}

export function buildText(node: { name: string; kind: string; filePath: string; content?: string | null; metadata?: Record<string, unknown> | null }): { text: string; embeddingSource: 'summary' | 'code' } {
  const sig = node.metadata?.signature as string | undefined;
  const summary = node.metadata?.summary as string | undefined;

  if (summary) {
    // Summary-based text: "[{kind}] {name}\n{signature}\n{summary}" capped at 512
    const text = `[${node.kind}] ${node.name}\n${sig ?? ''}\n${summary}`.slice(0, 512);
    return { text, embeddingSource: 'summary' };
  }

  // Code-based fallback (original behaviour)
  const parts: string[] = [`${node.kind} ${node.name}`];
  if (sig) parts.push(sig);
  if (node.content) parts.push(node.content.slice(0, 256));
  parts.push(node.filePath);
  return { text: parts.join(' ').slice(0, 512), embeddingSource: 'code' };
}
