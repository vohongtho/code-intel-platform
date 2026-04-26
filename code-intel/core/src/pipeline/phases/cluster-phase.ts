import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { generateNodeId, generateEdgeId } from '../../graph/id-generator.js';

export const clusterPhase: Phase = {
  name: 'cluster',
  dependencies: ['resolve'],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();
    const { graph } = context;

    const relevantKinds = new Set(['function', 'class', 'method', 'interface', 'struct', 'trait', 'enum']);
    const nodesByDir = new Map<string, { id: string; name: string }[]>();

    for (const node of graph.allNodes()) {
      if (!relevantKinds.has(node.kind)) continue;
      const dir = node.filePath.split('/').slice(0, -1).join('/') || '.';
      let group = nodesByDir.get(dir);
      if (!group) {
        group = [];
        nodesByDir.set(dir, group);
      }
      group.push({ id: node.id, name: node.name });
    }

    let clusterCount = 0;
    for (const [dir, members] of nodesByDir) {
      if (members.length < 2) continue;

      const clusterId = generateNodeId('cluster', dir, `cluster-${clusterCount}`);
      const label = dir.split('/').filter(Boolean).pop() ?? `cluster-${clusterCount}`;

      graph.addNode({
        id: clusterId,
        kind: 'cluster',
        name: label,
        filePath: dir,
        metadata: { memberCount: members.length },
      });

      for (const member of members) {
        graph.addEdge({
          id: generateEdgeId(member.id, clusterId, 'belongs_to'),
          source: member.id,
          target: clusterId,
          kind: 'belongs_to',
          weight: 1.0,
        });
      }
      clusterCount++;
    }

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: `Created ${clusterCount} clusters`,
    };
  },
};
