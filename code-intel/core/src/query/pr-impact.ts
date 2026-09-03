import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisBoundary, AnalysisCertainty, AnalysisCoverage, CodeEdge } from '../shared/index.js';
import { riskFromCount, summarizeEdgeTrust } from './trust.js';
import {
  buildRouteContractView,
  collectGraphFacts,
  matchConsumersToRoutes,
  type ConsumerMatchView,
  type RouteContractView,
} from '../semantic/api-contracts/index.js';

export interface PRApiImpact {
  /** Routes whose source file is among the changed files. */
  routes: RouteContractView[];
  /** Known consumers (exact or candidate) resolved to any of those routes. */
  consumers: ConsumerMatchView[];
  /** True only when every consumer match used to build this section was itself complete
   * (no candidate-cap truncation) — mirrors api_impact's own coverage semantics. */
  consumerCoverageComplete: boolean;
}

export interface PRImpactChangedSymbol {
  name: string;
  risk: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  callerCount: number;
  testCoverage: boolean;
  certainty?: AnalysisCertainty;
  coverage?: AnalysisCoverage;
  boundaries?: readonly AnalysisBoundary[];
}

export interface PRImpactResult {
  changedSymbols: PRImpactChangedSymbol[];
  impactedSymbols: Array<{ name: string; filePath: string }>;
  riskSummary: { HIGH: number; MEDIUM: number; LOW: number; UNKNOWN?: number };
  coverageGaps: string[];
  filesToReview: string[];
  crossRepoImpact: null;
  /** Additive: present when semantic-snapshot PR impact can enrich local blast radius with synchronized group contract drift. */
  crossRepositoryContracts?: unknown;
  certainty?: AnalysisCertainty;
  coverage?: AnalysisCoverage;
  boundaries?: readonly AnalysisBoundary[];
  /** Additive: present only when at least one changed file contains an API-contract route.
   * Absent (not an empty object) when there is nothing to report, so existing consumers that
   * don't know about this field see no change in shape. */
  apiImpact?: PRApiImpact;
}

function isChangedFile(filePath: string, changedFiles: readonly string[]): boolean {
  return changedFiles.some(
    (changedFile) => filePath === changedFile || filePath.endsWith(changedFile) || changedFile.endsWith(filePath),
  );
}

/**
 * Parse a unified diff string to extract changed file paths.
 * Scans lines for `+++ b/` prefix and returns everything after `b/`.
 */
export function parseDiffFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split('\n')) {
    const match = line.match(/^\+\+\+ b\/(.+)/);
    if (match) {
      files.push(match[1]);
    }
  }
  return files;
}

export function computePRImpact(
  graph: KnowledgeGraph,
  changedFiles: string[],
  maxHops: number,
  repoDir?: string,
): PRImpactResult {
  const changedSymbolIds = new Set<string>();
  for (const node of graph.allNodes()) {
    if (!node.filePath) continue;
    for (const changedFile of changedFiles) {
      if (
        node.filePath === changedFile ||
        node.filePath.endsWith(changedFile) ||
        changedFile.endsWith(node.filePath)
      ) {
        changedSymbolIds.add(node.id);
        break;
      }
    }
  }

  const allBlastRadiusNodes = new Set<string>();
  const changedSymbols: PRImpactResult['changedSymbols'] = [];
  const allTrustEdges: CodeEdge[] = [];

  for (const symbolId of changedSymbolIds) {
    const symbolNode = graph.getNode(symbolId);
    if (!symbolNode) continue;

    const blastRadius = new Set<string>();
    const trustEdges: CodeEdge[] = [];
    const queue: { id: string; depth: number }[] = [{ id: symbolId, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxHops) continue;
      visited.add(id);
      if (id !== symbolId) blastRadius.add(id);

      for (const edge of graph.findEdgesTo(id)) {
        if (edge.kind === 'calls' || edge.kind === 'imports') {
          queue.push({ id: edge.source, depth: depth + 1 });
          trustEdges.push(edge);
          allTrustEdges.push(edge);
        }
      }
    }

    for (const id of blastRadius) allBlastRadiusNodes.add(id);

    const trust = summarizeEdgeTrust(trustEdges, repoDir);
    const baseRisk = riskFromCount(blastRadius.size);
    const risk: PRImpactChangedSymbol['risk'] = trust.coverage.complete ? baseRisk : 'UNKNOWN';

    let callerCount = 0;
    for (const edge of graph.findEdgesTo(symbolId)) {
      if (edge.kind === 'calls') callerCount++;
    }

    let testCoverage = false;
    for (const edge of graph.findEdgesTo(symbolId)) {
      if (edge.kind === 'imports') {
        const callerNode = graph.getNode(edge.source);
        if (
          callerNode?.filePath &&
          (callerNode.filePath.includes('.test.') || callerNode.filePath.includes('.spec.'))
        ) {
          testCoverage = true;
          break;
        }
      }
    }

    changedSymbols.push({
      name: symbolNode.name,
      risk,
      callerCount,
      testCoverage,
      certainty: trust.certainty,
      coverage: trust.coverage,
      boundaries: trust.boundaries,
    });
  }

  const impactedSymbols: PRImpactResult['impactedSymbols'] = [];
  for (const id of allBlastRadiusNodes) {
    if (changedSymbolIds.has(id)) continue;
    const node = graph.getNode(id);
    if (node) {
      impactedSymbols.push({ name: node.name, filePath: node.filePath });
    }
  }

  const riskSummary: PRImpactResult['riskSummary'] = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const s of changedSymbols) {
    if (s.risk === 'UNKNOWN') {
      riskSummary.UNKNOWN = (riskSummary.UNKNOWN ?? 0) + 1;
      continue;
    }
    riskSummary[s.risk]++;
  }

  const coverageGaps: string[] = [];
  for (const s of changedSymbols) {
    if ((s.risk === 'HIGH' || s.risk === 'MEDIUM') && !s.testCoverage) {
      coverageGaps.push(`${s.name} has no test coverage`);
    }
    if (s.risk === 'UNKNOWN') {
      coverageGaps.push(`${s.name} impact coverage is incomplete`);
    }
  }

  const fileImpactCount = new Map<string, number>();
  for (const sym of impactedSymbols) {
    if (sym.filePath) {
      fileImpactCount.set(sym.filePath, (fileImpactCount.get(sym.filePath) ?? 0) + 1);
    }
  }
  const filesToReview = [...fileImpactCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([fp]) => fp);

  const aggregateTrust = summarizeEdgeTrust(allTrustEdges, repoDir);

  const { routes, consumers, shapesByFingerprint } = collectGraphFacts(graph);
  const changedRoutes = routes.filter((route) => isChangedFile(route.filePath, changedFiles));
  let apiImpact: PRApiImpact | undefined;
  if (changedRoutes.length > 0) {
    const changedRouteIds = new Set(changedRoutes.map((route) => route.factId));
    const matches = matchConsumersToRoutes(routes, consumers, repoDir ?? 'local');
    const consumerByFactId = new Map(consumers.map((consumer) => [consumer.factId, consumer]));
    const relevantMatches = matches.filter((match) => match.candidates.some((candidate) => changedRouteIds.has(candidate.targetId)));
    apiImpact = {
      routes: changedRoutes.map((route) => buildRouteContractView(route, shapesByFingerprint)),
      consumers: relevantMatches.map((match) => {
        const consumer = consumerByFactId.get(match.referenceId);
        return {
          consumerFactId: match.referenceId,
          filePath: consumer?.filePath ?? 'unknown',
          startLine: consumer?.sourceRange.startLine,
          clientLibrary: consumer?.clientLibrary ?? 'fetch',
          consumedKeys: consumer?.consumedKeys ?? [],
          match,
        };
      }),
      consumerCoverageComplete: matches.every((match) => match.coverage.complete),
    };
  }

  return {
    changedSymbols,
    impactedSymbols,
    riskSummary,
    coverageGaps,
    filesToReview,
    crossRepoImpact: null,
    certainty: aggregateTrust.certainty,
    coverage: aggregateTrust.coverage,
    boundaries: aggregateTrust.boundaries,
    apiImpact,
  };
}
