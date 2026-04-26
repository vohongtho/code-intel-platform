import { NodeKind } from '../shared/index.js';

export function generateNodeId(kind: NodeKind, filePath: string, qualifiedName: string): string {
  return `${kind}:${filePath}:${qualifiedName}`;
}

export function generateEdgeId(source: string, target: string, kind: string): string {
  return `${kind}:${source}->${target}`;
}
