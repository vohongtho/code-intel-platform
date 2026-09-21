import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisBoundary, AnalysisCertainty, AnalysisCoverage, CodeEdge } from '../shared/index.js';
import { emptyTrust, summarizeEdgeTrust } from './trust.js';

export interface SuggestTestsResult {
  callPaths: string[][];
  suggestedCases: string[];
  existingTests: string[];
  untestedCallers: string[];
  certainty?: AnalysisCertainty;
  coverage?: AnalysisCoverage;
  boundaries?: readonly AnalysisBoundary[];
}

function getSuggestedCases(symbolName: string): string[] {
  const lower = symbolName.toLowerCase();

  if (/parse|validate|check|verify/.test(lower)) {
    return [
      'Valid input → success',
      'Invalid input → throws error',
      'Edge case: empty/null input → handled gracefully',
    ];
  }
  if (/create|add|insert|save/.test(lower)) {
    return [
      'Success: valid data → created',
      'Duplicate: existing item → error or no-op',
      'Missing required fields → validation error',
    ];
  }
  if (/delete|remove|destroy/.test(lower)) {
    return [
      'Existing item → deleted successfully',
      'Non-existent item → no error or 404',
      'Unauthorized access → rejected',
    ];
  }
  if (/get|find|fetch|load/.test(lower)) {
    return [
      'Found: returns correct data',
      'Not found: returns null or throws',
      'Empty collection: returns []',
    ];
  }
  return [
    'Happy path: valid input → expected output',
    'Error case: invalid input → error handled',
    'Edge case: boundary values → correct behavior',
  ];
}

export function suggestTests(
  graph: KnowledgeGraph,
  symbolName: string,
  repoDir?: string,
): SuggestTestsResult | { error: string } {
  let targetNode = undefined;
  for (const node of graph.allNodes()) {
    if (node.name === symbolName) {
      targetNode = node;
      break;
    }
  }

  if (!targetNode) {
    return { error: `Symbol not found: ${symbolName}` };
  }

  const targetId = targetNode.id;
  const trustEdges: CodeEdge[] = [];
  const callPaths: string[][] = [];
  let truncated = false;

  type PathEntry = { id: string; path: string[]; depth: number };
  const pathQueue: PathEntry[] = [{ id: targetId, path: [symbolName], depth: 0 }];

  while (pathQueue.length > 0 && callPaths.length < 5) {
    const { id, path, depth } = pathQueue.shift()!;

    let hasCallers = false;
    for (const edge of graph.findEdgesTo(id)) {
      if (edge.kind !== 'calls') continue;
      const callerNode = graph.getNode(edge.source);
      if (!callerNode) continue;
      hasCallers = true;
      trustEdges.push(edge);

      const newPath = [callerNode.name, ...path];

      if (depth + 1 >= 3 || callPaths.length >= 5) {
        truncated = true;
        if (callPaths.length < 5) callPaths.push(newPath);
        continue;
      }
      pathQueue.push({ id: edge.source, path: newPath, depth: depth + 1 });
    }

    if (!hasCallers && path.length > 1) {
      callPaths.push(path);
    }
  }

  if (callPaths.length === 0) {
    for (const edge of graph.findEdgesTo(targetId)) {
      if (edge.kind !== 'calls') continue;
      const callerNode = graph.getNode(edge.source);
      if (!callerNode) continue;
      trustEdges.push(edge);
      callPaths.push([callerNode.name, symbolName]);
      if (callPaths.length >= 5) {
        truncated = true;
        break;
      }
    }
  }

  const existingTestFiles = new Set<string>();
  for (const edge of graph.findEdgesTo(targetId)) {
    if (edge.kind !== 'imports') continue;
    const importerNode = graph.getNode(edge.source);
    if (!importerNode) continue;
    if (
      importerNode.filePath.includes('.test.') ||
      importerNode.filePath.includes('.spec.')
    ) {
      existingTestFiles.add(importerNode.filePath);
    }
  }
  const existingTests = [...existingTestFiles];

  const untestedCallers: string[] = [];

  for (const edge of graph.findEdgesTo(targetId)) {
    if (edge.kind !== 'calls') continue;
    const callerNode = graph.getNode(edge.source);
    if (!callerNode) continue;

    if (
      callerNode.filePath.includes('.test.') ||
      callerNode.filePath.includes('.spec.')
    ) {
      continue;
    }

    let callerHasTest = false;
    for (const callerImportEdge of graph.findEdgesTo(callerNode.id)) {
      if (callerImportEdge.kind !== 'imports') continue;
      const importerOfCaller = graph.getNode(callerImportEdge.source);
      if (!importerOfCaller) continue;
      if (
        importerOfCaller.filePath.includes('.test.') ||
        importerOfCaller.filePath.includes('.spec.')
      ) {
        callerHasTest = true;
        break;
      }
    }

    if (!callerHasTest) {
      untestedCallers.push(callerNode.name);
    }
  }

  const suggestedCases = getSuggestedCases(symbolName);
  const trust = trustEdges.length > 0
    ? summarizeEdgeTrust(trustEdges, repoDir, { truncated })
    : emptyTrust();

  return {
    callPaths,
    suggestedCases,
    existingTests,
    untestedCallers,
    certainty: trust.certainty,
    coverage: trust.coverage,
    boundaries: trust.boundaries,
  };
}
