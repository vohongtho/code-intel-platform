import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface EmbeddedNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  text: string;
  embedding: number[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineInstance: ((text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>) | null = null;

async function getEmbedder() {
  if (!pipelineInstance) {
    // Dynamic import to keep startup fast
    const { pipeline } = await import('@xenova/transformers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pipelineInstance = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as unknown as typeof pipelineInstance;
  }
  return pipelineInstance!;
}

export async function embedNodes(
  graph: KnowledgeGraph,
  opts: { batchSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<EmbeddedNode[]> {
  const { batchSize = 32, onProgress } = opts;

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

    for (let j = 0; j < texts.length; j++) {
      const out = await embedder(texts[j], { pooling: 'mean', normalize: true });
      results.push({ ...batch[j], embedding: Array.from(out.data) });
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
