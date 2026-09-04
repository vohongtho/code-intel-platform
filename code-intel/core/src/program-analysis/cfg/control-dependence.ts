/**
 * cfg/control-dependence.ts
 *
 * Standard post-dominance-frontier construction (Ferrante/Ottenstein/Warren):
 * for every CFG edge (A -> B) where A has more than one successor, walk up
 * B's post-dominator-tree ancestors, marking each visited block (including
 * B) as control-dependent on A, stopping at (excluding) A's own post-idom —
 * the point past which control no longer depends on A's outcome. Edges
 * from a single-successor block never add a dependence: B is necessarily
 * A's immediate post-dominator there, so the walk is empty.
 */
import type { FunctionCfg } from './contracts.js';
import { computePostDominators, type DominanceResult } from './dominance.js';

export interface ControlDependence {
  /** blockId -> the block ids whose branch outcome controls whether it executes, sorted for determinism. */
  dependsOn: Readonly<Record<string, readonly string[]>>;
}

export function computeControlDependence(cfg: FunctionCfg, postDominators?: DominanceResult): ControlDependence {
  const postDom = postDominators ?? computePostDominators(cfg);
  const dependsOn = new Map<string, Set<string>>();

  for (const [blockId, block] of Object.entries(cfg.blocks)) {
    if (block.successors.length < 2) continue;
    const idomOfA = postDom.immediateDominator[blockId];

    for (const edge of block.successors) {
      let cursor: string | undefined = edge.targetBlockId;
      while (cursor !== undefined && cursor !== idomOfA) {
        if (!dependsOn.has(cursor)) dependsOn.set(cursor, new Set());
        dependsOn.get(cursor)!.add(blockId);
        const parent: string | undefined = postDom.immediateDominator[cursor];
        if (parent === undefined || parent === cursor) break;
        cursor = parent;
      }
    }
  }

  const result: Record<string, readonly string[]> = {};
  for (const [id, deps] of dependsOn) result[id] = [...deps].sort((a, b) => a.localeCompare(b));
  return { dependsOn: result };
}
