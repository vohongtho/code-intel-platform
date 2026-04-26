import type { CodeEdge, CodeNode } from '../shared/index.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { BindingTracker } from '../resolver/binding-tracker.js';
import { generateEdgeId } from '../graph/id-generator.js';
import type { CallSite } from './call-classifier.js';

interface ResolutionTier {
  name: string;
  confidence: number;
  resolve(callSite: CallSite): string | null;
}

export function buildCallEdges(
  callSites: CallSite[],
  graph: KnowledgeGraph,
  bindings: BindingTracker,
): CodeEdge[] {
  const edges: CodeEdge[] = [];
  const symbolIndex = buildSymbolIndex(graph);

  const tiers: ResolutionTier[] = [
    {
      name: 'same-file',
      confidence: 0.95,
      resolve(cs: CallSite) {
        const key = `${cs.callerFilePath}:${cs.name}`;
        return symbolIndex.get(key) ?? null;
      },
    },
    {
      name: 'imported',
      confidence: 0.9,
      resolve(cs: CallSite) {
        const binding = bindings.getBinding(cs.callerFilePath, cs.name);
        if (!binding) return null;
        const key = `${binding.sourcePath}:${binding.exportedName}`;
        return symbolIndex.get(key) ?? null;
      },
    },
    {
      name: 'global',
      confidence: 0.5,
      resolve(cs: CallSite) {
        return globalSymbolIndex.get(cs.name) ?? null;
      },
    },
  ];

  const globalSymbolIndex = new Map<string, string>();
  for (const node of graph.allNodes()) {
    if (['function', 'method', 'class', 'constructor'].includes(node.kind)) {
      if (!globalSymbolIndex.has(node.name)) {
        globalSymbolIndex.set(node.name, node.id);
      }
    }
  }

  for (const cs of callSites) {
    for (const tier of tiers) {
      const targetId = tier.resolve(cs);
      if (targetId && targetId !== cs.callerNodeId) {
        edges.push({
          id: generateEdgeId(cs.callerNodeId, targetId, 'calls'),
          source: cs.callerNodeId,
          target: targetId,
          kind: 'calls',
          weight: tier.confidence,
          label: cs.name,
        });
        break;
      }
    }
  }

  return edges;
}

function buildSymbolIndex(graph: KnowledgeGraph): Map<string, string> {
  const index = new Map<string, string>();
  for (const node of graph.allNodes()) {
    if (['function', 'method', 'class', 'constructor', 'variable'].includes(node.kind)) {
      const key = `${node.filePath}:${node.name}`;
      index.set(key, node.id);
    }
  }
  return index;
}
