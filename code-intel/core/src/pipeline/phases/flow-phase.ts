import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { generateNodeId, generateEdgeId } from '../../graph/id-generator.js';

export const flowPhase: Phase = {
  name: 'flow',
  dependencies: ['resolve'],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();
    const { graph } = context;

    // Find entry points: exported functions with no incoming call edges
    const calledNodes = new Set<string>();
    for (const edge of graph.findEdgesByKind('calls')) {
      calledNodes.add(edge.target);
    }

    const entryPoints: { id: string; name: string; score: number; filePath: string }[] = [];

    for (const node of graph.allNodes()) {
      if (!['function', 'method'].includes(node.kind)) continue;

      let score = 0;
      const hasCallers = calledNodes.has(node.id);
      const outCalls = [...graph.findEdgesFrom(node.id)].filter((e) => e.kind === 'calls');

      if (!hasCallers && outCalls.length > 0) score += 10;
      if (node.exported) score += 5;
      if (/^(main|handle|init|start|run|execute|process|serve|listen|bootstrap)/.test(node.name)) score += 3;
      if (node.filePath.includes('test') || node.filePath.includes('spec') || node.filePath.includes('__test')) score -= 20;
      if (node.filePath.includes('route') || node.filePath.includes('controller') || node.filePath.includes('handler')) score += 8;

      if (score >= 5) {
        entryPoints.push({ id: node.id, name: node.name, score, filePath: node.filePath });
      }
    }

    entryPoints.sort((a, b) => b.score - a.score);

    // Trace flows from top entry points (max 20)
    const maxFlows = 75;
    const maxDepth = 10;
    const maxBranching = 4;
    let flowCount = 0;
    const epSlice = entryPoints.slice(0, 20);

    for (let epIdx = 0; epIdx < epSlice.length; epIdx++) {
      const ep = epSlice[epIdx];
      context.onPhaseProgress?.('flow', epIdx + 1, epSlice.length);
      if (flowCount >= maxFlows) break;

      // BFS trace
      const queue: { nodeId: string; path: string[] }[] = [{ nodeId: ep.id, path: [ep.id] }];
      const visited = new Set<string>();

      while (queue.length > 0 && flowCount < maxFlows) {
        const { nodeId, path } = queue.shift()!;
        if (path.length > maxDepth) continue;

        const callEdges = [...graph.findEdgesFrom(nodeId)]
          .filter((e) => e.kind === 'calls')
          .slice(0, maxBranching);

        if (callEdges.length === 0 && path.length >= 3) {
          // Record flow
          const flowId = generateNodeId('flow', ep.filePath, `flow-${flowCount}`);
          graph.addNode({
            id: flowId,
            kind: 'flow',
            name: `${ep.name} flow ${flowCount}`,
            filePath: ep.filePath,
            metadata: { steps: path, entryPoint: ep.name },
          });

          // Add step_of edges
          for (let i = 0; i < path.length; i++) {
            graph.addEdge({
              id: generateEdgeId(path[i], flowId, `step_of_${i}`),
              source: path[i],
              target: flowId,
              kind: 'step_of',
              weight: 1.0,
              label: `step ${i + 1}`,
            });
          }

          flowCount++;
          continue;
        }

        for (const edge of callEdges) {
          if (visited.has(edge.target)) continue;
          visited.add(edge.target);
          queue.push({ nodeId: edge.target, path: [...path, edge.target] });
        }
      }
    }

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: `Found ${entryPoints.length} entry points, traced ${flowCount} flows`,
    };
  },
};
