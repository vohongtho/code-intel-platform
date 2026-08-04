import type { CodeNode, CodeEdge } from './graph-types.js';

export interface CountGroup {
  key: string;
  count: number;
}

export type GQLResultKind = 'nodes' | 'traversal' | 'path' | 'aggregate';

export interface GQLResult {
  kind: GQLResultKind;
  nodes: CodeNode[];
  edges: CodeEdge[];
  groups: CountGroup[];
  path: CodeNode[] | null;
  executionTimeMs: number;
  truncated: boolean;
  totalCount: number;
  format?: 'json';
}
