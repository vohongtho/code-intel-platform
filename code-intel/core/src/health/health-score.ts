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
}

/**
 * Run all health checks and compute health score.
 * Score formula: 100 - (deadCode.length * 0.5 + cycles.length * 5 + godNodes.length * 2 + orphanFiles.length * 1)
 * Clamped to [0, 100].
 * Grade: >= 80 = 🟢, >= 60 = 🟡, < 60 = 🔴
 */
export function computeHealthReport(graph: KnowledgeGraph, godNodeConfig?: GodNodeConfig): HealthReport {
  const deadCode = detectDeadCode(graph);
  const cycles = detectCircularDeps(graph);
  const godNodes = detectGodNodes(graph, godNodeConfig);
  const orphanFiles = detectOrphanFiles(graph);

  const raw =
    100 -
    (deadCode.length * 0.5 +
      cycles.length * 5 +
      godNodes.length * 2 +
      orphanFiles.length * 1);

  const score = Math.max(0, Math.min(100, raw));
  const grade: '🟢' | '🟡' | '🔴' = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';

  return {
    deadCode,
    cycles,
    godNodes,
    orphanFiles,
    score,
    grade,
  };
}
