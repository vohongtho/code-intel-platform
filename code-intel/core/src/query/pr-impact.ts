import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface PRImpactResult {
  changedSymbols: Array<{ name: string; risk: 'HIGH' | 'MEDIUM' | 'LOW'; callerCount: number; testCoverage: boolean }>;
  impactedSymbols: Array<{ name: string; filePath: string }>;
  riskSummary: { HIGH: number; MEDIUM: number; LOW: number };
  coverageGaps: string[];
  filesToReview: string[];
  crossRepoImpact: null;
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
): PRImpactResult {
  // Collect all nodes belonging to changed files
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

  // For each changed symbol, compute blast radius (BFS reverse: incoming calls + imports edges)
  const allBlastRadiusNodes = new Set<string>();
  const changedSymbols: PRImpactResult['changedSymbols'] = [];

  for (const symbolId of changedSymbolIds) {
    const symbolNode = graph.getNode(symbolId);
    if (!symbolNode) continue;

    // BFS reverse
    const blastRadius = new Set<string>();
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
        }
      }
    }

    // Add to global set
    for (const id of blastRadius) allBlastRadiusNodes.add(id);

    // Risk scoring
    const blastCount = blastRadius.size;
    let risk: 'HIGH' | 'MEDIUM' | 'LOW';
    if (blastCount > 50) {
      risk = 'HIGH';
    } else if (blastCount >= 10) {
      risk = 'MEDIUM';
    } else {
      risk = 'LOW';
    }

    // Caller count = incoming `calls` edges
    let callerCount = 0;
    for (const edge of graph.findEdgesTo(symbolId)) {
      if (edge.kind === 'calls') callerCount++;
    }

    // Test coverage: any node with a test file path that imports this symbol
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

    changedSymbols.push({ name: symbolNode.name, risk, callerCount, testCoverage });
  }

  // Impacted symbols: all nodes in blast radii that are NOT in changed files
  const impactedSymbols: PRImpactResult['impactedSymbols'] = [];
  for (const id of allBlastRadiusNodes) {
    if (changedSymbolIds.has(id)) continue;
    const node = graph.getNode(id);
    if (node) {
      impactedSymbols.push({ name: node.name, filePath: node.filePath });
    }
  }

  // Risk summary
  const riskSummary: PRImpactResult['riskSummary'] = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const s of changedSymbols) {
    riskSummary[s.risk]++;
  }

  // Coverage gaps: HIGH/MEDIUM risk symbols with testCoverage=false
  const coverageGaps: string[] = [];
  for (const s of changedSymbols) {
    if ((s.risk === 'HIGH' || s.risk === 'MEDIUM') && !s.testCoverage) {
      coverageGaps.push(`${s.name} has no test coverage`);
    }
  }

  // filesToReview: top 5 filePaths with most impacted symbols
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

  return {
    changedSymbols,
    impactedSymbols,
    riskSummary,
    coverageGaps,
    filesToReview,
    crossRepoImpact: null,
  };
}
