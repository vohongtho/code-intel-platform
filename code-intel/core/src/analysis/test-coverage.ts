import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface CoverageResult {
  nodeId: string;
  name: string;
  filePath: string;
  exported: boolean;
  tested: boolean;
  testFiles: string[];
  blastRadius: number;
  risk: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface CoverageSummary {
  totalExported: number;
  testedExported: number;
  coveragePct: number;
  untestedByRisk: CoverageResult[];
}

function isTestFile(filePath: string): boolean {
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return true;
  if (filePath.includes('_test.') || filePath.endsWith('_test.go')) return true;
  if (filePath.includes('__tests__')) return true;
  const base = path.basename(filePath);
  if (base.startsWith('Test') && filePath.endsWith('.java')) return true;
  return false;
}

function computeBlastRadius(graph: KnowledgeGraph, nodeId: string): number {
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: nodeId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (depth >= 3) continue;

    for (const edge of graph.findEdgesTo(id)) {
      if (edge.kind === 'calls' || edge.kind === 'imports') {
        if (!visited.has(edge.source)) {
          queue.push({ id: edge.source, depth: depth + 1 });
        }
      }
    }
  }

  // Subtract 1 for the node itself
  return Math.max(0, visited.size - 1);
}

function getRisk(blastRadius: number): CoverageResult['risk'] {
  if (blastRadius > 20) return 'HIGH';
  if (blastRadius >= 5) return 'MEDIUM';
  return 'LOW';
}

export function computeCoverage(graph: KnowledgeGraph, scope?: string): CoverageSummary {
  // Build set of test file paths
  const testFilePaths = new Set<string>();
  for (const node of graph.allNodes()) {
    if (isTestFile(node.filePath)) testFilePaths.add(node.filePath);
  }

  // Build set of node IDs that are imported by test files
  const nodesImportedByTests = new Set<string>();
  for (const edge of graph.findEdgesByKind('imports')) {
    const sourceNode = graph.getNode(edge.source);
    if (sourceNode && isTestFile(sourceNode.filePath)) {
      nodesImportedByTests.add(edge.target);
    }
  }

  // Build set of nodes that have tested_by edges
  const nodesWithTestedBy = new Set<string>();
  for (const edge of graph.findEdgesByKind('tested_by')) {
    nodesWithTestedBy.add(edge.source);
  }

  // Build file → test files mapping by basename heuristic
  // e.g. users.test.ts tests users.ts
  const baseNameToTestFiles = new Map<string, string[]>();
  for (const testPath of testFilePaths) {
    const base = path.basename(testPath);
    // Strip test/spec suffix patterns
    const stripped = base
      .replace(/\.test\.[^.]+$/, '')
      .replace(/\.spec\.[^.]+$/, '')
      .replace(/_test\.[^.]+$/, '')
      .replace(/_test$/, '');
    const existing = baseNameToTestFiles.get(stripped) ?? [];
    existing.push(testPath);
    baseNameToTestFiles.set(stripped, existing);
  }

  const exportedKinds = new Set(['function', 'method', 'class']);
  const results: CoverageResult[] = [];

  for (const node of graph.allNodes()) {
    if (!exportedKinds.has(node.kind)) continue;
    if (node.exported !== true) continue;
    if (scope && !node.filePath.startsWith(scope)) continue;

    // Check if tested
    const testFiles: string[] = [];

    // 1. tested_by edge
    if (nodesWithTestedBy.has(node.id)) {
      for (const edge of graph.findEdgesFrom(node.id)) {
        if (edge.kind === 'tested_by') {
          const testNode = graph.getNode(edge.target);
          if (testNode && !testFiles.includes(testNode.filePath)) {
            testFiles.push(testNode.filePath);
          }
        }
      }
    }

    // 2. imported by test file
    if (nodesImportedByTests.has(node.id)) {
      for (const edge of graph.findEdgesTo(node.id)) {
        if (edge.kind === 'imports') {
          const sourceNode = graph.getNode(edge.source);
          if (sourceNode && isTestFile(sourceNode.filePath) && !testFiles.includes(sourceNode.filePath)) {
            testFiles.push(sourceNode.filePath);
          }
        }
      }
    }

    // 3. basename heuristic
    const nodeBase = path.basename(node.filePath).replace(/\.[^.]+$/, '');
    const matchingTestFiles = baseNameToTestFiles.get(nodeBase) ?? [];
    for (const tf of matchingTestFiles) {
      if (!testFiles.includes(tf)) testFiles.push(tf);
    }

    const tested = testFiles.length > 0;
    const blastRadius = computeBlastRadius(graph, node.id);
    const risk = getRisk(blastRadius);

    results.push({
      nodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      exported: true,
      tested,
      testFiles,
      blastRadius,
      risk,
    });
  }

  const totalExported = results.length;
  const testedExported = results.filter((r) => r.tested).length;
  const coveragePct = totalExported === 0 ? 100 : Math.round((testedExported / totalExported) * 100);
  const untestedByRisk = results
    .filter((r) => !r.tested)
    .sort((a, b) => b.blastRadius - a.blastRadius);

  return { totalExported, testedExported, coveragePct, untestedByRisk };
}
