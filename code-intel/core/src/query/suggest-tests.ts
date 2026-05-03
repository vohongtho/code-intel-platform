import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface SuggestTestsResult {
  callPaths: string[][];
  suggestedCases: string[];
  existingTests: string[];
  untestedCallers: string[];
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
): SuggestTestsResult | { error: string } {
  // Find node by name
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

  // ── Call paths (BFS backwards up to 3 hops, collect up to 5 paths) ─────────
  const callPaths: string[][] = [];

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

      const newPath = [callerNode.name, ...path];

      if (depth + 1 >= 3 || callPaths.length >= 5) {
        if (callPaths.length < 5) callPaths.push(newPath);
        continue;
      }
      pathQueue.push({ id: edge.source, path: newPath, depth: depth + 1 });
    }

    if (!hasCallers && path.length > 1) {
      callPaths.push(path);
    }
  }

  // If no call paths discovered via BFS, still check direct callers
  if (callPaths.length === 0) {
    for (const edge of graph.findEdgesTo(targetId)) {
      if (edge.kind !== 'calls') continue;
      const callerNode = graph.getNode(edge.source);
      if (!callerNode) continue;
      callPaths.push([callerNode.name, symbolName]);
      if (callPaths.length >= 5) break;
    }
  }

  // ── Existing tests ─────────────────────────────────────────────────────────
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

  // ── Untested callers ───────────────────────────────────────────────────────
  // Nodes that call this symbol AND are not in test files AND no test file imports them
  const untestedCallers: string[] = [];

  for (const edge of graph.findEdgesTo(targetId)) {
    if (edge.kind !== 'calls') continue;
    const callerNode = graph.getNode(edge.source);
    if (!callerNode) continue;

    // Skip if caller is itself a test file
    if (
      callerNode.filePath.includes('.test.') ||
      callerNode.filePath.includes('.spec.')
    ) {
      continue;
    }

    // Check if any test file imports this caller
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

  // ── Suggested cases ────────────────────────────────────────────────────────
  const suggestedCases = getSuggestedCases(symbolName);

  return {
    callPaths,
    suggestedCases,
    existingTests,
    untestedCallers,
  };
}
