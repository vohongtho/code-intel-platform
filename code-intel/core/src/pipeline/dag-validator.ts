import type { Phase } from './types.js';

export interface ValidationError {
  type: 'duplicate' | 'missing-dep' | 'cycle';
  message: string;
}

export function validateDAG(phases: Phase[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const names = new Set<string>();

  // Check duplicates
  for (const phase of phases) {
    if (names.has(phase.name)) {
      errors.push({ type: 'duplicate', message: `Duplicate phase name: ${phase.name}` });
    }
    names.add(phase.name);
  }

  // Check missing deps
  for (const phase of phases) {
    for (const dep of phase.dependencies) {
      if (!names.has(dep)) {
        errors.push({
          type: 'missing-dep',
          message: `Phase "${phase.name}" depends on missing phase "${dep}"`,
        });
      }
    }
  }

  // Check cycles using DFS
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const phaseMap = new Map(phases.map((p) => [p.name, p]));

  function dfs(name: string, path: string[]): boolean {
    if (visiting.has(name)) {
      const cycleStart = path.indexOf(name);
      const cycle = path.slice(cycleStart).concat(name);
      errors.push({ type: 'cycle', message: `Cycle detected: ${cycle.join(' → ')}` });
      return true;
    }
    if (visited.has(name)) return false;

    visiting.add(name);
    path.push(name);

    const phase = phaseMap.get(name);
    if (phase) {
      for (const dep of phase.dependencies) {
        if (dfs(dep, path)) return true;
      }
    }

    visiting.delete(name);
    visited.add(name);
    path.pop();
    return false;
  }

  for (const phase of phases) {
    if (!visited.has(phase.name)) {
      dfs(phase.name, []);
    }
  }

  return errors;
}

export function topologicalSort(phases: Phase[]): Phase[] {
  const phaseMap = new Map(phases.map((p) => [p.name, p]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const phase of phases) {
    inDegree.set(phase.name, 0);
    adjList.set(phase.name, []);
  }

  for (const phase of phases) {
    for (const dep of phase.dependencies) {
      adjList.get(dep)?.push(phase.name);
      inDegree.set(phase.name, (inDegree.get(phase.name) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: Phase[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(phaseMap.get(current)!);
    for (const neighbor of adjList.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}
