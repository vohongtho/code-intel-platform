import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { build, type ContextDocument, type SeedSymbol } from '../context/builder.js';
import { computePRImpact, type PRImpactResult } from './pr-impact.js';
import { suggestTests, type SuggestTestsResult } from './suggest-tests.js';

export interface ChangeContextOptions {
  changedFiles: string[];
  maxHops?: number;
  maxTokens?: number;
  maxChangedSymbols?: number;
}

export interface ChangeContextTestSuggestion {
  symbol: string;
  result: SuggestTestsResult | { error: string };
}

export interface ChangeContextResult {
  changedFiles: string[];
  impact: PRImpactResult;
  context: ContextDocument;
  testSuggestions: ChangeContextTestSuggestion[];
  summary: {
    changedSymbolCount: number;
    impactedSymbolCount: number;
    coverageGapCount: number;
    highestRisk: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  };
}

function normalizeChangedFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.trim().replace(/\\/g, '/')).filter(Boolean))].sort();
}

function seedSymbolsForChangedFiles(
  graph: KnowledgeGraph,
  changedFiles: string[],
  maxChangedSymbols: number,
): SeedSymbol[] {
  const seeds: SeedSymbol[] = [];
  for (const node of graph.allNodes()) {
    if (!node.filePath) continue;
    const normalizedPath = node.filePath.replace(/\\/g, '/');
    const matches = changedFiles.some(
      (file) => normalizedPath === file || normalizedPath.endsWith(file) || file.endsWith(normalizedPath),
    );
    if (matches) seeds.push({ nodeId: node.id, refinedScore: 1 });
    if (seeds.length >= maxChangedSymbols) break;
  }
  return seeds;
}

export function buildChangeContext(
  graph: KnowledgeGraph,
  options: ChangeContextOptions,
): ChangeContextResult {
  const changedFiles = normalizeChangedFiles(options.changedFiles);
  const maxHops = Math.max(1, Math.min(10, options.maxHops ?? 3));
  const maxChangedSymbols = Math.max(1, Math.min(100, options.maxChangedSymbols ?? 20));
  const impact = computePRImpact(graph, changedFiles, maxHops);
  const seeds = seedSymbolsForChangedFiles(graph, changedFiles, maxChangedSymbols);
  const context = build(seeds, graph, {
    maxTokens: options.maxTokens,
    queryIntent: 'architecture',
  });
  const testSuggestions = impact.changedSymbols
    .filter((symbol) => symbol.risk !== 'LOW' || !symbol.testCoverage)
    .slice(0, 10)
    .map((symbol) => ({ symbol: symbol.name, result: suggestTests(graph, symbol.name) }));
  const highestRisk = impact.riskSummary.HIGH > 0
    ? 'HIGH'
    : impact.riskSummary.MEDIUM > 0
      ? 'MEDIUM'
      : impact.riskSummary.LOW > 0
        ? 'LOW'
        : 'NONE';
  return {
    changedFiles,
    impact,
    context,
    testSuggestions,
    summary: {
      changedSymbolCount: impact.changedSymbols.length,
      impactedSymbolCount: impact.impactedSymbols.length,
      coverageGapCount: impact.coverageGaps.length,
      highestRisk,
    },
  };
}
