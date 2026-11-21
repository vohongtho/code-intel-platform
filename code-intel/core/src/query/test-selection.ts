import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisBoundary, AnalysisCertainty, AnalysisCoverage, CodeEdge, CodeNode } from '../shared/index.js';
import { emptyTrust, summarizeEdgeTrust } from './trust.js';

export type TestEvidenceKind = 'direct' | 'affected-flow' | 'transitive' | 'candidate' | 'unknown';

export interface TestEvidence {
  testId?: string;
  filePath?: string;
  kind: TestEvidenceKind;
  path?: string[];
  certainty: AnalysisCertainty;
  boundaries: AnalysisBoundary[];
}

export interface MissingTestFinding {
  definitive: boolean;
  reason: string;
}

export interface TestSelectionResult {
  evidence: TestEvidence[];
  coverage: AnalysisCoverage;
  missingTestFinding?: MissingTestFinding;
}

export const MINIMUM_TEST_COVERAGE_GATE = Object.freeze({ requireComplete: true });

const EVIDENCE_RANK: Record<TestEvidenceKind, number> = {
  direct: 0,
  'affected-flow': 1,
  transitive: 2,
  candidate: 3,
  unknown: 4,
};

function isTestNode(node: CodeNode): boolean {
  return /(?:^|[/.])(?:test|tests|spec|specs)(?:[/.]|$)|\.(?:test|spec)\./i.test(node.filePath);
}

function affectedFlowSteps(graph: KnowledgeGraph, impactedIds: ReadonlySet<string>): Set<string> {
  const impactedCanonicalIds = new Set<string>();
  for (const id of impactedIds) {
    const node = graph.getNode(id);
    impactedCanonicalIds.add(node?.identityId ?? id);
  }

  const affectedCanonicalSteps = new Set<string>();
  for (const node of graph.allNodes()) {
    if (node.kind !== 'flow') continue;
    const steps = Array.isArray(node.metadata?.['stepCanonicalIds'])
      ? node.metadata!['stepCanonicalIds'] as string[]
      : [];
    if (steps.some((step) => impactedCanonicalIds.has(step))) {
      for (const step of steps) affectedCanonicalSteps.add(step);
    }
  }

  const stepNodeIds = new Set<string>();
  for (const node of graph.allNodes()) {
    if (affectedCanonicalSteps.has(node.identityId ?? node.id)) stepNodeIds.add(node.id);
  }
  return stepNodeIds;
}

function pathKind(edges: readonly CodeEdge[], direct: boolean, reachesAffectedFlow: boolean): TestEvidenceKind {
  if (edges.some((edge) => edge.certainty === 'candidate' || edge.certainty === 'heuristic')) return 'candidate';
  if (direct) return 'direct';
  if (reachesAffectedFlow) return 'affected-flow';
  return 'transitive';
}

export function selectTestsForImpact(
  graph: KnowledgeGraph,
  impactedNodeIds: readonly string[],
  options: { repoDir?: string; maxDepth?: number; coverage?: AnalysisCoverage } = {},
): TestSelectionResult {
  const impacted = new Set(impactedNodeIds);
  const flowSteps = affectedFlowSteps(graph, impacted);
  const maxDepth = options.maxDepth ?? 4;
  const evidenceByIdentity = new Map<string, TestEvidence>();
  const allTraversedEdges: CodeEdge[] = [];
  let truncated = false;

  for (const testNode of [...graph.allNodes()].filter(isTestNode).sort((a, b) => a.id.localeCompare(b.id))) {
    const queue: Array<{ id: string; path: string[]; edges: CodeEdge[] }> = [{ id: testNode.id, path: [testNode.name], edges: [] }];
    const visited = new Set([testNode.id]);
    let best: TestEvidence | undefined;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.edges.length >= maxDepth) {
        if ([...graph.findEdgesFrom(current.id)].some((edge) => edge.kind === 'calls' || edge.kind === 'imports')) truncated = true;
        continue;
      }
      const outgoing = [...graph.findEdgesFrom(current.id)]
        .filter((edge) => edge.kind === 'calls' || edge.kind === 'imports')
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const edge of outgoing) {
        const target = graph.getNode(edge.target);
        if (!target) continue;
        const edges = [...current.edges, edge];
        allTraversedEdges.push(edge);
        const path = [...current.path, target.name];
        const reachesTarget = impacted.has(target.id);
        const reachesFlow = flowSteps.has(target.id) && !reachesTarget;
        if (reachesTarget || reachesFlow) {
          const trust = summarizeEdgeTrust(edges, options.repoDir);
          const candidate: TestEvidence = {
            testId: testNode.id,
            filePath: testNode.filePath,
            kind: pathKind(edges, reachesTarget && edges.length === 1, reachesFlow),
            path,
            certainty: trust.certainty,
            boundaries: [...trust.boundaries],
          };
          if (!best || EVIDENCE_RANK[candidate.kind] < EVIDENCE_RANK[best.kind]) best = candidate;
        }
        if (!visited.has(target.id)) {
          visited.add(target.id);
          queue.push({ id: target.id, path, edges });
        }
      }
    }

    if (best) evidenceByIdentity.set(testNode.id || testNode.filePath, best);
  }

  const trust = options.coverage
    ? { ...emptyTrust(), coverage: options.coverage }
    : allTraversedEdges.length > 0
      ? summarizeEdgeTrust(allTraversedEdges, options.repoDir, { truncated })
      : emptyTrust();
  const evidence = [...evidenceByIdentity.values()].sort((a, b) => (
    EVIDENCE_RANK[a.kind] - EVIDENCE_RANK[b.kind]
    || (a.filePath ?? '').localeCompare(b.filePath ?? '')
    || (a.testId ?? '').localeCompare(b.testId ?? '')
  ));

  let missingTestFinding: MissingTestFinding | undefined;
  if (evidence.length === 0) {
    const definitive = !MINIMUM_TEST_COVERAGE_GATE.requireComplete || trust.coverage.complete;
    missingTestFinding = {
      definitive,
      reason: definitive
        ? 'No test evidence was found with complete relevant coverage.'
        : 'Relevant test coverage is incomplete; absence of evidence is not proof that a test is missing.',
    };
    if (!definitive) {
      evidence.push({ kind: 'unknown', certainty: trust.certainty, boundaries: [...trust.boundaries] });
    }
  }

  return { evidence, coverage: trust.coverage, missingTestFinding };
}
