import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface EmbeddedNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  text: string;
  embedding: number[];
}

const EMBED_DIM = 384; // all-MiniLM-L6-v2 output dimension

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineInstance: ((text: string | string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array }>) | null = null;

async function getEmbedder() {
  if (!pipelineInstance) {
    const { pipeline } = await import('@huggingface/transformers');
    // dtype:'q8' loads the int8-quantized ONNX weights — ~2-4× faster on CPU,
    // negligible quality difference for code-symbol embeddings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pipelineInstance = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' } as any)) as unknown as typeof pipelineInstance;
  }
  return pipelineInstance!;
}

export async function embedNodes(
  graph: KnowledgeGraph,
  opts: { batchSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<EmbeddedNode[]> {
  // Larger batch = fewer forward passes = faster overall
  const { batchSize = 64, onProgress } = opts;

  // Collect candidates — skip cluster/directory/flow to save time
  const candidates: { id: string; name: string; kind: string; filePath: string; text: string }[] = [];
  for (const node of graph.allNodes()) {
    if (['cluster', 'directory', 'flow'].includes(node.kind)) continue;
    const text = buildText(node);
    candidates.push({ id: node.id, name: node.name, kind: node.kind, filePath: node.filePath, text });
  }

  const embedder = await getEmbedder();
  const results: EmbeddedNode[] = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const texts = batch.map((c) => c.text);

    // ── True batch inference ──────────────────────────────────────────────────
    // Pass the entire texts array in one forward pass instead of N sequential
    // calls.  The pipeline returns a flat Float32Array of shape [B * EMBED_DIM].
    const out = await embedder(texts, { pooling: 'mean', normalize: true });

    for (let j = 0; j < batch.length; j++) {
      const start = j * EMBED_DIM;
      // subarray() gives a view (no copy) into the underlying buffer
      const embedding = Array.from(out.data.subarray(start, start + EMBED_DIM));
      results.push({ ...batch[j], embedding });
    }

    onProgress?.(Math.min(i + batchSize, candidates.length), candidates.length);
  }

  return results;
}

function buildText(node: { name: string; kind: string; filePath: string; content?: string | null; metadata?: Record<string, unknown> | null }): string {
  const parts: string[] = [`${node.kind} ${node.name}`];
  const sig = node.metadata?.signature as string | undefined;
  if (sig) parts.push(sig);
  if (node.content) parts.push(node.content.slice(0, 256));
  parts.push(node.filePath);
  return parts.join(' ').slice(0, 512);
}
