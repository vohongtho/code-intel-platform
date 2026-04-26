import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface EntryPoint {
  nodeId: string;
  name: string;
  score: number;
  filePath: string;
}

export function findEntryPoints(graph: KnowledgeGraph): EntryPoint[] {
  const calledNodes = new Set<string>();
  for (const edge of graph.findEdgesByKind('calls')) {
    calledNodes.add(edge.target);
  }

  const entryPoints: EntryPoint[] = [];

  for (const node of graph.allNodes()) {
    if (!['function', 'method'].includes(node.kind)) continue;

    const outEdges = [...graph.findEdgesFrom(node.id)].filter((e) => e.kind === 'calls');
    const inDegree = calledNodes.has(node.id) ? 1 : 0;

    let score = 0;
    if (outEdges.length > 0 && inDegree === 0) score += 10;
    if (node.exported) score += 5;
    if (/^(main|handle|init|start|run|execute|process|serve|listen)/.test(node.name)) score += 3;
    if (node.filePath.includes('test') || node.filePath.includes('spec')) score -= 20;
    if (node.filePath.includes('route') || node.filePath.includes('controller')) score += 8;

    if (score >= 5) {
      entryPoints.push({
        nodeId: node.id,
        name: node.name,
        score,
        filePath: node.filePath,
      });
    }
  }

  return entryPoints.sort((a, b) => b.score - a.score);
}

export interface FlowTrace {
  entryPointId: string;
  steps: string[];
}

export function traceFlow(
  entryId: string,
  graph: KnowledgeGraph,
  maxDepth = 10,
  maxBranching = 4,
): FlowTrace[] {
  const flows: FlowTrace[] = [];
  const maxFlows = 75;

  function bfs(): void {
    const queue: { nodeId: string; path: string[] }[] = [{ nodeId: entryId, path: [entryId] }];
    const visited = new Set<string>();

    while (queue.length > 0 && flows.length < maxFlows) {
      const { nodeId, path } = queue.shift()!;
      if (path.length > maxDepth) continue;

      const callEdges = [...graph.findEdgesFrom(nodeId)]
        .filter((e) => e.kind === 'calls')
        .slice(0, maxBranching);

      if (callEdges.length === 0 && path.length >= 3) {
        flows.push({ entryPointId: entryId, steps: [...path] });
        continue;
      }

      for (const edge of callEdges) {
        if (visited.has(edge.target)) continue;
        visited.add(edge.target);
        queue.push({ nodeId: edge.target, path: [...path, edge.target] });
      }
    }
  }

  bfs();
  return deduplicateFlows(flows);
}

function deduplicateFlows(flows: FlowTrace[]): FlowTrace[] {
  const result: FlowTrace[] = [];

  for (const flow of flows) {
    const edges = new Set<string>();
    for (let i = 0; i < flow.steps.length - 1; i++) {
      edges.add(`${flow.steps[i]}->${flow.steps[i + 1]}`);
    }

    const isDuplicate = result.some((existing) => {
      const existingEdges = new Set<string>();
      for (let i = 0; i < existing.steps.length - 1; i++) {
        existingEdges.add(`${existing.steps[i]}->${existing.steps[i + 1]}`);
      }
      let overlap = 0;
      for (const e of edges) {
        if (existingEdges.has(e)) overlap++;
      }
      return overlap / Math.max(edges.size, 1) > 0.7;
    });

    if (!isDuplicate) result.push(flow);
  }

  return result;
}
