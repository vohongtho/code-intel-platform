import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { detectDeadCode } from './dead-code.js';
import type { DeadCodeResult } from './dead-code.js';
import { detectCircularDeps } from './circular-deps.js';
import type { CycleResult } from './circular-deps.js';
import { detectGodNodes } from './god-nodes.js';
import type { GodNodeResult, GodNodeConfig } from './god-nodes.js';
import { detectOrphanFiles } from './orphan-files.js';
import type { OrphanFileResult } from './orphan-files.js';

export type { DeadCodeResult, CycleResult, GodNodeResult, GodNodeConfig, OrphanFileResult };

export interface HealthReport {
  deadCode: DeadCodeResult[];
  cycles: CycleResult[];
  godNodes: GodNodeResult[];
  orphanFiles: OrphanFileResult[];
  score: number;     // 0-100
  grade: '🟢' | '🟡' | '🔴';
  normalization: {
    basis: 'node-count' | 'file-count';
    size: number;
    weights: {
      deadCode: number;
      cycles: number;
      godNodes: number;
      orphanFiles: number;
    };
  };
}

const HEALTH_WEIGHTS = {
  deadCode: 0.5,
  cycles: 5,
  godNodes: 2,
  orphanFiles: 1,
} as const;

function getNormalizationBasis(graph: KnowledgeGraph): { basis: 'node-count' | 'file-count'; size: number } {
  const fileIds = new Set<string>();
  for (const node of graph.allNodes()) {
    if (node.kind === 'file') fileIds.add(node.id);
  }
  if (graph.size.nodes > 0) return { basis: 'node-count', size: graph.size.nodes };
  return { basis: 'file-count', size: Math.max(fileIds.size, 1) };
}

/**
 * Run all health checks and compute health score.
 * Score formula: 100 - normalized penalty percent using per-category weights over repo size.
 * Clamped to [0, 100].
 * Grade: >= 80 = 🟢, >= 60 = 🟡, < 60 = 🔴
 */
export function computeHealthReport(graph: KnowledgeGraph, godNodeConfig?: GodNodeConfig): HealthReport {
  const deadCode = detectDeadCode(graph);
  const cycles = detectCircularDeps(graph);
  const godNodes = detectGodNodes(graph, godNodeConfig);
  const orphanFiles = detectOrphanFiles(graph);

  const normalization = getNormalizationBasis(graph);
  const penaltyRatio =
    (deadCode.length * HEALTH_WEIGHTS.deadCode +
      cycles.length * HEALTH_WEIGHTS.cycles +
      godNodes.length * HEALTH_WEIGHTS.godNodes +
      orphanFiles.length * HEALTH_WEIGHTS.orphanFiles) /
    Math.max(normalization.size, 1);
  const raw = 100 - penaltyRatio * 100;

  const score = Math.max(0, Math.min(100, raw));
  const grade: '🟢' | '🟡' | '🔴' = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';

  return {
    deadCode,
    cycles,
    godNodes,
    orphanFiles,
    score,
    grade,
    normalization: {
      ...normalization,
      weights: { ...HEALTH_WEIGHTS },
    },
  };
}
