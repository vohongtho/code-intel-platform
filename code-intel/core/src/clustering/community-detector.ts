import type { CodeNode } from '../shared/index.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { generateNodeId, generateEdgeId } from '../graph/id-generator.js';

export interface ClusterResult {
  clusterId: string;
  label: string;
  memberIds: string[];
}

export function detectCommunities(graph: KnowledgeGraph): ClusterResult[] {
  // Build adjacency for relevant node kinds
  const relevantKinds = new Set(['function', 'class', 'method', 'interface', 'struct']);
  const nodes: CodeNode[] = [];

  for (const node of graph.allNodes()) {
    if (relevantKinds.has(node.kind)) {
      nodes.push(node);
    }
  }

  if (nodes.length < 10) return [];

  // Group by file directory as simple heuristic clustering
  const dirGroups = new Map<string, CodeNode[]>();
  for (const node of nodes) {
    const dir = node.filePath.split('/').slice(0, -1).join('/') || '.';
    let group = dirGroups.get(dir);
    if (!group) {
      group = [];
      dirGroups.set(dir, group);
    }
    group.push(node);
  }

  const clusters: ClusterResult[] = [];
  let idx = 0;

  for (const [dir, members] of dirGroups) {
    if (members.length < 2) continue;
    const clusterId = generateNodeId('cluster', dir, `cluster-${idx}`);
    const label = generateLabel(dir, members);

    clusters.push({
      clusterId,
      label,
      memberIds: members.map((m) => m.id),
    });
    idx++;
  }

  return clusters;
}

function generateLabel(dir: string, members: CodeNode[]): string {
  const parts = dir.split('/').filter(Boolean);
  if (parts.length > 0) {
    return parts[parts.length - 1];
  }
  return `cluster-${members[0]?.name ?? 'unknown'}`;
}

export function addClustersToGraph(graph: KnowledgeGraph, clusters: ClusterResult[]): void {
  for (const cluster of clusters) {
    graph.addNode({
      id: cluster.clusterId,
      kind: 'cluster',
      name: cluster.label,
      filePath: '',
      metadata: { memberCount: cluster.memberIds.length },
    });

    for (const memberId of cluster.memberIds) {
      graph.addEdge({
        id: generateEdgeId(memberId, cluster.clusterId, 'belongs_to'),
        source: memberId,
        target: cluster.clusterId,
        kind: 'belongs_to',
        weight: 1.0,
      });
    }
  }
}
