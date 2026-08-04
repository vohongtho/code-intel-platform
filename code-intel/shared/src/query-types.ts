import type { CodeNode, CodeEdge } from './graph-types.js';

export type RepoScope = { type: 'repo'; repoId: string };
export type GroupScope = { type: 'group'; name: string };
export type QueryScope = RepoScope | GroupScope;

export interface ResolvedRepoScope {
  type: 'repo';
  repoId: string;
  repoName: string;
}

export interface ResolvedGroupScope {
  type: 'group';
  name: string;
}

export type ResolvedQueryScope = ResolvedRepoScope | ResolvedGroupScope;

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
  scope?: ResolvedQueryScope;
  format?: 'json';
}
