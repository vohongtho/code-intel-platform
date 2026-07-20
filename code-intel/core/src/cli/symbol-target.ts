import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode } from '../shared/index.js';

export const AMBIGUOUS_SYMBOL_EXIT_CODE = 2;

export interface QualifiedSymbolTarget {
  kind: string;
  name: string;
  filePath: string;
  startLine?: number;
}

export type SymbolResolution =
  | { status: 'found'; node: CodeNode }
  | { status: 'ambiguous'; candidates: CodeNode[] }
  | { status: 'not-found'; candidates: [] };

export function formatSymbolTarget(node: CodeNode): string {
  const line = node.startLine === undefined ? '' : `:${node.startLine}`;
  const filePath = encodeURIComponent(node.filePath).replaceAll('%2F', '/').replaceAll('%5C', '/');
  return `${encodeURIComponent(node.kind)}:${encodeURIComponent(node.name)}@${filePath}${line}`;
}

export function parseSymbolTarget(value: string): QualifiedSymbolTarget | null {
  const match = /^([^:]+):([^@]+)@(.+?)(?::(\d+))?$/.exec(value);
  if (!match) return null;
  try {
    return {
      kind: decodeURIComponent(match[1]),
      name: decodeURIComponent(match[2]),
      filePath: decodeURIComponent(match[3]),
      startLine: match[4] === undefined ? undefined : Number(match[4]),
    };
  } catch {
    return null;
  }
}

function compareCandidates(a: CodeNode, b: CodeNode): number {
  const testPenalty = (node: CodeNode) => /(^|[/\\])(?:test|tests|spec|__tests__)([/\\]|$)|\.(?:test|spec)\./i.test(node.filePath) ? 1 : 0;
  return testPenalty(a) - testPenalty(b)
    || a.filePath.localeCompare(b.filePath)
    || (a.startLine ?? 0) - (b.startLine ?? 0)
    || a.kind.localeCompare(b.kind)
    || a.id.localeCompare(b.id);
}

export function resolveSymbolTarget(graph: KnowledgeGraph, value: string): SymbolResolution {
  const qualified = parseSymbolTarget(value);
  const candidates = [...graph.allNodes()].filter((node) => qualified
    ? node.kind === qualified.kind
      && node.name === qualified.name
      && node.filePath === qualified.filePath
      && (qualified.startLine === undefined || node.startLine === qualified.startLine)
    : node.name === value,
  ).sort(compareCandidates);

  if (candidates.length === 0) return { status: 'not-found', candidates: [] };
  if (candidates.length === 1 || qualified) return { status: 'found', node: candidates[0] };
  return { status: 'ambiguous', candidates };
}
