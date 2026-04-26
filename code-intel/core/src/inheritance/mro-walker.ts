export type MroStrategy = 'depth-first' | 'c3' | 'mixin-aware' | 'none';

export function computeMRO(
  classId: string,
  parentMap: Map<string, string[]>,
  strategy: MroStrategy,
): string[] {
  switch (strategy) {
    case 'depth-first':
      return depthFirstMRO(classId, parentMap);
    case 'c3':
      return c3Linearize(classId, parentMap);
    case 'mixin-aware':
      return mixinAwareMRO(classId, parentMap);
    case 'none':
      return [classId];
  }
}

function depthFirstMRO(classId: string, parentMap: Map<string, string[]>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const stack = [classId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    const parents = parentMap.get(current) ?? [];
    for (let i = parents.length - 1; i >= 0; i--) {
      stack.push(parents[i]);
    }
  }

  return result;
}

function c3Linearize(classId: string, parentMap: Map<string, string[]>): string[] {
  const cache = new Map<string, string[]>();
  const inProgress = new Set<string>();

  function linearize(cls: string): string[] {
    if (cache.has(cls)) return cache.get(cls)!;
    if (inProgress.has(cls)) return [cls]; // cycle detected

    inProgress.add(cls);
    const parents = parentMap.get(cls) ?? [];

    if (parents.length === 0) {
      const result = [cls];
      cache.set(cls, result);
      inProgress.delete(cls);
      return result;
    }

    const parentLinearizations = parents.map((p) => linearize(p));
    const sequences = [...parentLinearizations, parents];
    const result = [cls];

    while (sequences.some((s) => s.length > 0)) {
      let found = false;
      for (const seq of sequences) {
        if (seq.length === 0) continue;
        const head = seq[0];
        const inTail = sequences.some((s) => s.indexOf(head) > 0);
        if (!inTail) {
          result.push(head);
          for (const s of sequences) {
            const idx = s.indexOf(head);
            if (idx >= 0) s.splice(idx, 1);
          }
          found = true;
          break;
        }
      }
      if (!found) break; // inconsistent hierarchy
    }

    cache.set(cls, result);
    inProgress.delete(cls);
    return result;
  }

  return linearize(classId);
}

function mixinAwareMRO(classId: string, parentMap: Map<string, string[]>): string[] {
  // Simplified: prepend → direct → included
  return depthFirstMRO(classId, parentMap);
}
