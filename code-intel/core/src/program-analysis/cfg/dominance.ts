/**
 * cfg/dominance.ts
 *
 * Dominator and post-dominator trees over a `FunctionCfg`, via the
 * Cooper-Harvey-Kennedy iterative algorithm (reverse-postorder + intersect
 * until fixed point) — run once forward from entry (dominators) and once
 * backward from exit over reversed edges (post-dominators). Blocks not
 * reachable from the root are reported separately rather than silently
 * omitted, and never crash the computation.
 */
import type { FunctionCfg } from './contracts.js';

export interface DominanceResult {
  /** blockId -> its immediate dominator; `immediateDominator[root] === root` (standard convention). Absent for unreachable blocks. */
  immediateDominator: Readonly<Record<string, string>>;
  /** Blocks not reachable from `root` along the traversal direction used — excluded from `immediateDominator`. */
  unreachable: readonly string[];
  root: string;
}

/** Iterative (non-recursive) post-order DFS, reversed to yield reverse-postorder. */
function reversePostOrder(root: string, next: (id: string) => readonly string[]): string[] {
  const visited = new Set<string>([root]);
  const postOrder: string[] = [];
  const stack: Array<{ id: string; iter: Iterator<string> }> = [{ id: root, iter: next(root)[Symbol.iterator]() }];

  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const { value, done } = top.iter.next();
    if (done) {
      postOrder.push(top.id);
      stack.pop();
      continue;
    }
    if (!visited.has(value)) {
      visited.add(value);
      stack.push({ id: value, iter: next(value)[Symbol.iterator]() });
    }
  }
  postOrder.reverse();
  return postOrder;
}

function computeDominance(
  root: string,
  allNodes: readonly string[],
  successors: (id: string) => readonly string[],
  predecessors: (id: string) => readonly string[],
): DominanceResult {
  const rpo = reversePostOrder(root, successors);
  const reachable = new Set(rpo);
  const rpoIndex = new Map(rpo.map((id, index) => [id, index]));

  const idom = new Map<string, string>([[root, root]]);

  function intersect(nodeA: string, nodeB: string): string {
    let a = nodeA;
    let b = nodeB;
    while (a !== b) {
      while (rpoIndex.get(a)! > rpoIndex.get(b)!) a = idom.get(a)!;
      while (rpoIndex.get(b)! > rpoIndex.get(a)!) b = idom.get(b)!;
    }
    return a;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of rpo) {
      if (node === root) continue;
      const processedPreds = predecessors(node).filter((p) => reachable.has(p) && idom.has(p));
      if (processedPreds.length === 0) continue;
      let newIdom = processedPreds[0]!;
      for (const pred of processedPreds.slice(1)) newIdom = intersect(newIdom, pred);
      if (idom.get(node) !== newIdom) {
        idom.set(node, newIdom);
        changed = true;
      }
    }
  }

  const immediateDominator: Record<string, string> = {};
  for (const [node, dom] of idom) immediateDominator[node] = dom;

  return { immediateDominator, unreachable: allNodes.filter((id) => !reachable.has(id)), root };
}

export function computeDominators(cfg: FunctionCfg): DominanceResult {
  const allNodes = Object.keys(cfg.blocks);
  return computeDominance(
    cfg.entryBlockId,
    allNodes,
    (id) => cfg.blocks[id]?.successors.map((edge) => edge.targetBlockId) ?? [],
    (id) => cfg.blocks[id]?.predecessors ?? [],
  );
}

export function computePostDominators(cfg: FunctionCfg): DominanceResult {
  const allNodes = Object.keys(cfg.blocks);
  return computeDominance(
    cfg.exitBlockId,
    allNodes,
    (id) => cfg.blocks[id]?.predecessors ?? [],
    (id) => cfg.blocks[id]?.successors.map((edge) => edge.targetBlockId) ?? [],
  );
}

/** Whether `a` (strictly or reflexively) dominates `b` in the given (post-)dominance result. */
export function dominates(dominance: DominanceResult, a: string, b: string): boolean {
  if (a === b) return true;
  let cursor = dominance.immediateDominator[b];
  if (cursor === undefined) return false;
  while (cursor !== a) {
    const parent = dominance.immediateDominator[cursor];
    if (parent === undefined || parent === cursor) return false;
    cursor = parent;
  }
  return true;
}
