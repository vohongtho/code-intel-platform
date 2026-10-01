import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisBoundary, AnalysisCertainty, AnalysisCoverage, CodeEdge } from '../shared/index.js';
import { detectLanguage } from '../shared/detection.js';
import type { ChangeSlice, ProjectedSliceImpact, SliceCallEdge } from '../program-analysis/change-slice.js';
import type { ChangedLineRange } from '../program-analysis/source-map.js';
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
  precision?: 'graph' | 'pdg';
  slice?: ChangeSlice;
  fallbackReason?: string;
}

export type PRImpactPrecision = 'graph' | 'pdg' | 'auto';

export interface PRImpactPrecisionMetrics {
  changedFunctions: number;
  pdgBuilds: number;
  pdgCacheHits: number;
  sliceNodes: number;
  projectionHops: number;
  pdgDurationMs: number;
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
  requestedPrecision?: PRImpactPrecision;
  actualPrecision?: 'graph' | 'pdg' | 'mixed';
  sliceSummary?: {
    analyzedFunctions: number;
    slicedFunctions: number;
    truncatedFunctions: number;
  };
  fallbackCounts?: Record<string, number>;
  projectedImpact?: ProjectedSliceImpact[];
  riskFactors?: Array<{ functionId: string; factors: string[] }>;
  precisionMetrics?: PRImpactPrecisionMetrics;
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

/** Extracts changed new-file line ranges from unified diff hunks. */
export function parseDiffChangedLineRanges(diff: string): ChangedLineRange[] {
  const ranges: ChangedLineRange[] = [];
  let filePath: string | undefined;
  let newLine: number | undefined;
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)/);
    if (fileMatch) {
      filePath = fileMatch[1];
      newLine = undefined;
      continue;
    }
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      newLine = filePath ? Number(hunkMatch[1]) : undefined;
      continue;
    }
    if (!filePath || newLine === undefined) continue;
    if (line.startsWith('+')) {
      const previous = ranges.at(-1);
      if (previous?.filePath === filePath && previous.endLine + 1 === newLine) previous.endLine = newLine;
      else ranges.push({ filePath, startLine: newLine, endLine: newLine });
      newLine += 1;
    } else if (line.startsWith(' ')) {
      newLine += 1;
    } else if (!line.startsWith('-') && !line.startsWith('\\')) {
      newLine = undefined;
    }
  }
  return ranges;
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

function incrementCount(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function callCertainty(edge: CodeEdge): SliceCallEdge['certainty'] {
  if (edge.certainty === 'exact') return 'exact';
  if (edge.certainty === 'candidate') return 'candidate-set';
  if (edge.certainty === 'heuristic') return 'heuristic';
  return 'unresolved';
}

/**
 * Additive precision-aware PR impact. The existing synchronous graph result
 * remains the default; PDG analysis is attempted only when explicitly
 * requested. `auto` stays on graph precision until the mutation gate enables
 * it, so it cannot silently promote an unevaluated precision mode.
 */
export async function computePRImpactWithPrecision(
  graph: KnowledgeGraph,
  changedFiles: string[],
  maxHops: number,
  options: {
    repoDir?: string;
    precision?: PRImpactPrecision;
    changedRanges?: readonly ChangedLineRange[];
    mutationGateEnabled?: boolean;
  } = {},
): Promise<PRImpactResult> {
  const requestedPrecision = options.precision ?? 'graph';
  const result = computePRImpact(graph, changedFiles, maxHops, options.repoDir);
  const fallbackCounts: Record<string, number> = {};
  const metrics: PRImpactPrecisionMetrics = {
    changedFunctions: 0,
    pdgBuilds: 0,
    pdgCacheHits: 0,
    sliceNodes: 0,
    projectionHops: 0,
    pdgDurationMs: 0,
  };

  if (requestedPrecision === 'graph' || (requestedPrecision === 'auto' && !options.mutationGateEnabled)) {
    if (requestedPrecision === 'auto') incrementCount(fallbackCounts, 'mutation-gate-disabled');
    return {
      ...result,
      requestedPrecision,
      actualPrecision: 'graph',
      fallbackCounts,
      precisionMetrics: metrics,
    };
  }

  const [pipelineModule, changeSliceModule, sourceMapModule] = await Promise.all([
    import('../program-analysis/pipeline.js'),
    import('../program-analysis/change-slice.js'),
    import('../program-analysis/source-map.js'),
  ]);
  const { analyzeFunctionDependence } = pipelineModule;
  const { buildChangeSlice, projectChangeSliceAcrossCalls } = changeSliceModule;
  const { mapChangedLineRanges } = sourceMapModule;

  const changedNodes = [...graph.allNodes()]
    .filter((node) => (node.kind === 'function' || node.kind === 'method') && node.startLine !== undefined && isChangedFile(node.filePath, changedFiles))
    .sort((a, b) => a.id.localeCompare(b.id));
  metrics.changedFunctions = changedNodes.length;
  const slices = new Map<string, ChangeSlice>();
  const projectedByFunction = new Map<string, ProjectedSliceImpact>();
  const riskFactors: Array<{ functionId: string; factors: string[] }> = [];
  const startedAt = Date.now();

  for (const node of changedNodes) {
    const language = detectLanguage(node.filePath);
    if (!language || !options.repoDir) {
      incrementCount(fallbackCounts, !options.repoDir ? 'repository-path-unavailable' : 'language-unsupported');
      continue;
    }
    const ranges = (options.changedRanges ?? [])
      .filter((range) => isChangedFile(node.filePath, [range.filePath]))
      .map((range) => ({ ...range, filePath: path.resolve(options.repoDir!, node.filePath) }));
    if (ranges.length === 0) {
      incrementCount(fallbackCounts, 'changed-lines-unavailable');
      continue;
    }

    metrics.pdgBuilds += 1;
    const analysis = await analyzeFunctionDependence({
      language,
      filePath: path.resolve(options.repoDir, node.filePath),
      startLine: node.startLine!,
      canonicalFunctionId: node.identityId ?? node.id,
      resolverVersion: 'evidence-based-v1',
    });
    if (analysis.cacheHit) metrics.pdgCacheHits += 1;
    if (analysis.capability !== 'supported' || !analysis.ir || !analysis.pdg) {
      incrementCount(fallbackCounts, analysis.reason ?? 'pdg-unsupported');
      continue;
    }

    const mapped = mapChangedLineRanges([analysis.ir], ranges);
    if (mapped.statementRefs.length === 0) {
      incrementCount(fallbackCounts, 'changed-lines-not-mapped');
      continue;
    }
    const slice = buildChangeSlice({
      pdg: analysis.pdg,
      seedStatementIds: mapped.statementRefs.map((ref) => ref.statementId),
      includeBackward: true,
    });
    slices.set(node.id, slice);
    metrics.sliceNodes += slice.forward.length + (slice.backward?.length ?? 0);
    const factors = [
      slice.dataDependencies > 0 ? 'data-dependencies' : '',
      slice.controlDependencies > 0 ? 'control-dependencies' : '',
      slice.truncated ? 'truncated-analysis' : '',
    ].filter(Boolean);
    riskFactors.push({ functionId: node.id, factors });

    const callEdges = [...graph.findEdgesTo(node.id)]
      .filter((edge) => edge.kind === 'calls')
      .map((edge): SliceCallEdge => ({
        sourceFunctionId: node.id,
        targetFunctionId: edge.source,
        certainty: callCertainty(edge),
        evidenceRef: edge.evidenceRef,
      }));
    if (callEdges.length > 0) {
      const projection = projectChangeSliceAcrossCalls({ repoDir: options.repoDir, slice, callEdges });
      if (!projection.allowed && projection.reason) incrementCount(fallbackCounts, 'interprocedural-projection-gated');
      for (const impact of projection.projected) {
        projectedByFunction.set(impact.functionId, impact);
        metrics.projectionHops += impact.depth;
      }
    }
  }
  metrics.pdgDurationMs = Date.now() - startedAt;

  const changedSymbols = result.changedSymbols.map((symbol) => {
    const node = changedNodes.find((candidate) => candidate.name === symbol.name);
    if (!node) return symbol;
    const slice = slices.get(node.id);
    return slice
      ? { ...symbol, precision: 'pdg' as const, slice }
      : { ...symbol, precision: 'graph' as const, fallbackReason: 'PDG evidence unavailable; graph result retained.' };
  });
  const slicedFunctions = slices.size;
  const truncatedFunctions = [...slices.values()].filter((slice) => slice.truncated).length;
  return {
    ...result,
    changedSymbols,
    requestedPrecision,
    actualPrecision: slicedFunctions === 0 ? 'graph' : Object.keys(fallbackCounts).length > 0 ? 'mixed' : 'pdg',
    sliceSummary: { analyzedFunctions: metrics.pdgBuilds, slicedFunctions, truncatedFunctions },
    fallbackCounts,
    projectedImpact: [...projectedByFunction.values()].sort((a, b) => a.functionId.localeCompare(b.functionId)),
    riskFactors,
    precisionMetrics: metrics,
  };
}
