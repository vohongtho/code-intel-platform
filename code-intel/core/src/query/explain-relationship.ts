import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisBoundary, AnalysisCoverage } from '../shared/index.js';
import { emptyTrust, loadEdgeEvidence, mergeBoundaries, mergeCoverage, summarizeEdgeTrust } from './trust.js';

export interface ExplainRelationshipPath {
  hops: number;
  nodes: string[];
  edgeKind: string;
  evidence?: string;
  certainty?: string;
  strategy?: string;
  coverage?: AnalysisCoverage;
  boundaries?: readonly AnalysisBoundary[];
}

export interface ExplainRelationshipResult {
  paths: ExplainRelationshipPath[];
  sharedImports: string[];
  heritage: string | null;
  summary: string;
  certainty?: string;
  coverage?: AnalysisCoverage;
  boundaries?: readonly AnalysisBoundary[];
}


export function explainRelationship(
  graph: KnowledgeGraph,
  from: string,
  to: string,
  repoDir?: string,
): ExplainRelationshipResult | { error: string; suggestions: string[] } {
  const allNodes = [...graph.allNodes()];

  const fromNode = allNodes.find((n) => n.name === from);
  if (!fromNode) {
    const firstChar = from[0]?.toLowerCase() ?? '';
    const fromLower = from.toLowerCase();
    const suggestions = allNodes
      .filter((n) => n.name.toLowerCase().startsWith(firstChar) || n.name.toLowerCase().includes(fromLower))
      .slice(0, 5)
      .map((n) => n.name);
    return { error: `Symbol not found: ${from}`, suggestions };
  }

  const toNode = allNodes.find((n) => n.name === to);
  if (!toNode) {
    const firstChar = to[0]?.toLowerCase() ?? '';
    const toLower = to.toLowerCase();
    const suggestions = allNodes
      .filter((n) => n.name.toLowerCase().startsWith(firstChar) || n.name.toLowerCase().includes(toLower))
      .slice(0, 5)
      .map((n) => n.name);
    return { error: `Symbol not found: ${to}`, suggestions };
  }

  const paths: ExplainRelationshipPath[] = [];
  const traversedEdges: Array<ReturnType<KnowledgeGraph['findEdgesFrom']> extends Iterable<infer T> ? T : never> = [];
  let truncated = false;

  type QueueEntry = { id: string; nodeNames: string[]; visited: Set<string> };
  const queue: QueueEntry[] = [{
    id: fromNode.id,
    nodeNames: [fromNode.name],
    visited: new Set([fromNode.id]),
  }];

  while (queue.length > 0 && paths.length < 10) {
    const entry = queue.shift()!;
    const { id, nodeNames, visited } = entry;
    if (nodeNames.length > 6) {
      truncated = true;
      continue;
    }

    for (const edge of graph.findEdgesFrom(id)) {
      const targetNode = graph.getNode(edge.target);
      if (!targetNode) continue;
      if (visited.has(edge.target)) continue;

      const newNames = [...nodeNames, targetNode.name];
      traversedEdges.push(edge);
      const evidence = loadEdgeEvidence(repoDir, edge.evidenceRef);

      if (edge.target === toNode.id) {
        paths.push({
          hops: newNames.length - 1,
          nodes: newNames,
          edgeKind: edge.kind,
          evidence: edge.evidenceRef ?? edge.label,
          certainty: edge.certainty,
          strategy: edge.strategy,
          coverage: evidence.coverage,
          boundaries: evidence.boundaries,
        });
        if (paths.length >= 10) {
          truncated = true;
          break;
        }
        continue;
      }

      if (newNames.length < 6) {
        const newVisited = new Set(visited);
        newVisited.add(edge.target);
        queue.push({ id: edge.target, nodeNames: newNames, visited: newVisited });
      } else {
        truncated = true;
      }
    }
  }

  const fromImports = new Set<string>();
  for (const edge of graph.findEdgesFrom(fromNode.id)) {
    if (edge.kind === 'imports') fromImports.add(edge.target);
  }

  const sharedImportIds: string[] = [];
  for (const edge of graph.findEdgesFrom(toNode.id)) {
    if (edge.kind === 'imports' && fromImports.has(edge.target)) sharedImportIds.push(edge.target);
  }

  const sharedImports = sharedImportIds.map((id) => graph.getNode(id)?.name ?? id);

  let heritage: string | null = null;
  for (const edge of graph.findEdgesFrom(fromNode.id)) {
    if ((edge.kind === 'extends' || edge.kind === 'implements') && edge.target === toNode.id) {
      heritage = `${from} ${edge.kind} ${to}`;
      break;
    }
  }
  if (!heritage) {
    for (const edge of graph.findEdgesFrom(toNode.id)) {
      if ((edge.kind === 'extends' || edge.kind === 'implements') && edge.target === fromNode.id) {
        heritage = `${to} ${edge.kind} ${from}`;
        break;
      }
    }
  }

  const emptyResultTrust = emptyTrust();
  const trust = paths.length === 0 && traversedEdges.length === 0
    ? emptyResultTrust
    : summarizeEdgeTrust(traversedEdges, repoDir, { truncated });
  const mergedCoverage = mergeCoverage(paths.map((path) => path.coverage)) ?? trust.coverage;
  const mergedBoundaries = mergeBoundaries([trust.boundaries, ...paths.map((path) => path.boundaries)]);
  const sharedStr = sharedImports.length > 0 ? sharedImports.join(', ') : 'none';
  const heritageStr = heritage ?? 'none';
  const evidenceBits = [...new Set(paths.map((path) => path.evidence).filter(Boolean))].slice(0, 3);
  const evidenceStr = evidenceBits.length > 0 ? ` Evidence: [${evidenceBits.join('; ')}].` : '';
  const certaintyBits = [...new Set(paths.map((path) => path.certainty).filter(Boolean))].slice(0, 3);
  const certaintyStr = certaintyBits.length > 0
    ? ` Certainty: [${certaintyBits.join(', ')}, ${trust.certainty}].`
    : ` Certainty: [${trust.certainty}].`;
  const coverageStr = mergedCoverage
    ? ` Coverage: ${mergedCoverage.complete ? 'complete' : 'incomplete'} (${mergedCoverage.examinedCount}${mergedCoverage.totalKnownCount != null ? `/${mergedCoverage.totalKnownCount}` : ''}).`
    : '';
  const boundaryStr = mergedBoundaries.length > 0 ? ` Boundaries: [${mergedBoundaries.map((item) => item.kind).join(', ')}].` : '';
  const connectionStr = paths.length === 0 ? 'No connection found.' : `${from} → ${to} via ${paths.length} path(s).`;
  const summary = `${connectionStr} Shared imports: [${sharedStr}]. Heritage: ${heritageStr}.${certaintyStr}${coverageStr}${boundaryStr}${evidenceStr}`;

  return {
    paths,
    sharedImports,
    heritage,
    summary,
    certainty: trust.certainty,
    coverage: mergedCoverage,
    boundaries: mergedBoundaries,
  };
}
