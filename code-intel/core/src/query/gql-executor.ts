/**
 * GQL Executor — executes a QueryAST against a KnowledgeGraph
 */

import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode, CodeEdge, EdgeKind } from '../shared/index.js';
import type {
  QueryAST,
  FindStatement,
  TraverseStatement,
  PathStatement,
  CountStatement,
  WhereClause,
  WhereExpr,
} from './gql-parser.js';

// ── Result types ──────────────────────────────────────────────────────────────

export interface CountGroup {
  key: string;
  count: number;
}

export interface GQLResult {
  nodes?: CodeNode[];
  edges?: CodeEdge[];
  groups?: CountGroup[];
  path?: CodeNode[] | null;
  executionTimeMs: number;
  truncated: boolean;
  totalCount: number;
}

// ── Timeout helper ────────────────────────────────────────────────────────────

const EXECUTION_TIMEOUT_MS = 10_000;

function withTimeout<T>(fn: () => T, timeoutMs: number): { result: T; truncated: boolean } {
  const start = Date.now();
  const result = fn();
  const elapsed = Date.now() - start;
  return { result, truncated: elapsed >= timeoutMs };
}

// ── WHERE clause evaluation ───────────────────────────────────────────────────

function getNodeProperty(node: CodeNode, property: string): string | boolean | undefined {
  switch (property) {
    case 'name':     return node.name;
    case 'kind':     return node.kind;
    case 'filepath':
    case 'filePath': return node.filePath;
    case 'exported': return node.exported;
    case 'language': return (node.metadata?.language as string | undefined) ?? undefined;
    case 'cluster':  return (node.metadata?.cluster as string | undefined) ?? undefined;
    default:         return (node.metadata?.[property] as string | undefined) ?? undefined;
  }
}

function evaluateExpr(node: CodeNode, expr: WhereExpr): boolean {
  const val = getNodeProperty(node, expr.property);
  if (val === undefined) return false;
  const strVal = String(val).toLowerCase();

  switch (expr.operator) {
    case '=':
      if (typeof expr.value === 'string') {
        return strVal === expr.value.toLowerCase();
      }
      return false;
    case '!=':
      if (typeof expr.value === 'string') {
        return strVal !== expr.value.toLowerCase();
      }
      return true;
    case 'CONTAINS':
      if (typeof expr.value === 'string') {
        return strVal.includes(expr.value.toLowerCase());
      }
      return false;
    case 'STARTS_WITH':
      if (typeof expr.value === 'string') {
        return strVal.startsWith(expr.value.toLowerCase());
      }
      return false;
    case 'IN':
      if (Array.isArray(expr.value)) {
        return expr.value.some((v) => strVal === v.toLowerCase());
      }
      return false;
    default:
      return false;
  }
}

function evaluateWhere(node: CodeNode, where: WhereClause): boolean {
  return where.exprs.every((expr) => evaluateExpr(node, expr));
}

// ── FIND executor ─────────────────────────────────────────────────────────────

function executeFIND(stmt: FindStatement, graph: KnowledgeGraph): GQLResult {
  const start = Date.now();
  const limit = stmt.limit ?? 1000;
  const offset = stmt.offset ?? 0;
  let totalCount = 0;
  let truncated = false;

  const allMatching: CodeNode[] = [];
  const deadline = start + EXECUTION_TIMEOUT_MS;

  for (const node of graph.allNodes()) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    // Kind filter
    if (stmt.target !== '*' && node.kind !== stmt.target) continue;
    // WHERE filter
    if (stmt.where && !evaluateWhere(node, stmt.where)) continue;
    allMatching.push(node);
  }

  totalCount = allMatching.length;
  const paginated = allMatching.slice(offset, offset + limit);

  return {
    nodes: paginated,
    executionTimeMs: Date.now() - start,
    truncated,
    totalCount,
  };
}

// ─── Shared helper: find the best matching node for a name ───────────────────
// For TRAVERSE/PATH: if multiple nodes share a name, pick the one whose
// filePath is least likely to be a framework stub (prefer source files).
function findBestNode(graph: KnowledgeGraph, name: string): CodeNode | undefined {
  const matches: CodeNode[] = [];
  for (const node of graph.allNodes()) {
    if (node.name === name) matches.push(node);
  }
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  // Prefer nodes with more connections (callers+callees) — they're more likely
  // to be the "real" implementation rather than a stub or alternate class.
  return matches.sort((a, b) => {
    const aEdges = [...graph.findEdgesFrom(a.id)].length + [...graph.findEdgesTo(a.id)].length;
    const bEdges = [...graph.findEdgesFrom(b.id)].length + [...graph.findEdgesTo(b.id)].length;
    return bEdges - aEdges;
  })[0];
}

// ── TRAVERSE executor ─────────────────────────────────────────────────────────

function executeTRAVERSE(stmt: TraverseStatement, graph: KnowledgeGraph): GQLResult {
  const start = Date.now();
  const maxDepth = stmt.depth ?? 5;
  const edgeKind = stmt.edgeKind as EdgeKind;
  const direction = stmt.direction ?? 'OUTGOING';
  const deadline = start + EXECUTION_TIMEOUT_MS;

  // Find starting node by name — use best-match heuristic when ambiguous
  const startNode = findBestNode(graph, stmt.from);

  if (!startNode) {
    return {
      nodes: [],
      edges: [],
      executionTimeMs: Date.now() - start,
      truncated: false,
      totalCount: 0,
    };
  }

  // BFS
  const visitedNodes = new Set<string>();
  const visitedEdges = new Set<string>();
  const resultNodes: CodeNode[] = [];
  const resultEdges: CodeEdge[] = [];
  const queue: { id: string; depth: number }[] = [{ id: startNode.id, depth: 0 }];
  visitedNodes.add(startNode.id);
  resultNodes.push(startNode);

  let truncated = false;

  while (queue.length > 0) {
    if (Date.now() > deadline) { truncated = true; break; }

    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const nextEdges: CodeEdge[] = [];

    if (direction === 'OUTGOING' || direction === 'BOTH') {
      for (const edge of graph.findEdgesFrom(id)) {
        if (!edgeKind || edge.kind === edgeKind) nextEdges.push(edge);
      }
    }
    if (direction === 'INCOMING' || direction === 'BOTH') {
      for (const edge of graph.findEdgesTo(id)) {
        if (!edgeKind || edge.kind === edgeKind) nextEdges.push(edge);
      }
    }

    for (const edge of nextEdges) {
      if (!visitedEdges.has(edge.id)) {
        visitedEdges.add(edge.id);
        resultEdges.push(edge);
      }
      const neighborId = direction === 'INCOMING' ? edge.source : edge.target;
      const effectiveNeighborId = direction === 'BOTH'
        ? (edge.source === id ? edge.target : edge.source)
        : neighborId;

      if (!visitedNodes.has(effectiveNeighborId)) {
        visitedNodes.add(effectiveNeighborId);
        const neighborNode = graph.getNode(effectiveNeighborId);
        if (neighborNode) {
          resultNodes.push(neighborNode);
          queue.push({ id: effectiveNeighborId, depth: depth + 1 });
        }
      }
    }
  }

  return {
    nodes: resultNodes,
    edges: resultEdges,
    executionTimeMs: Date.now() - start,
    truncated,
    totalCount: resultNodes.length,
  };
}

// ── PATH executor ─────────────────────────────────────────────────────────────

function executePATH(stmt: PathStatement, graph: KnowledgeGraph): GQLResult {
  const start = Date.now();
  const deadline = start + EXECUTION_TIMEOUT_MS;

  // Find start and end nodes — use best-match heuristic when ambiguous
  const startNode = findBestNode(graph, stmt.from);
  const endNode = findBestNode(graph, stmt.to);

  if (!startNode || !endNode) {
    return {
      path: null,
      nodes: [],
      executionTimeMs: Date.now() - start,
      truncated: false,
      totalCount: 0,
    };
  }

  // BFS to find shortest path
  const visited = new Set<string>();
  const parent = new Map<string, { nodeId: string; edgeId: string }>();
  const queue: string[] = [startNode.id];
  visited.add(startNode.id);
  let found = false;
  let truncated = false;

  outer: while (queue.length > 0) {
    if (Date.now() > deadline) { truncated = true; break; }

    const current = queue.shift()!;
    for (const edge of graph.findEdgesFrom(current)) {
      const next = edge.target;
      if (!visited.has(next)) {
        visited.add(next);
        parent.set(next, { nodeId: current, edgeId: edge.id });
        if (next === endNode.id) { found = true; break outer; }
        queue.push(next);
      }
    }
    // Also follow incoming edges for bidirectional path finding
    for (const edge of graph.findEdgesTo(current)) {
      const next = edge.source;
      if (!visited.has(next)) {
        visited.add(next);
        parent.set(next, { nodeId: current, edgeId: edge.id });
        if (next === endNode.id) { found = true; break outer; }
        queue.push(next);
      }
    }
  }

  if (!found) {
    return {
      path: null,
      nodes: [],
      executionTimeMs: Date.now() - start,
      truncated,
      totalCount: 0,
    };
  }

  // Reconstruct path
  const pathNodeIds: string[] = [];
  const pathEdgeIds: string[] = [];
  let current = endNode.id;
  while (current !== startNode.id) {
    pathNodeIds.unshift(current);
    const p = parent.get(current)!;
    pathEdgeIds.unshift(p.edgeId);
    current = p.nodeId;
  }
  pathNodeIds.unshift(startNode.id);

  const pathNodes = pathNodeIds.map((id) => graph.getNode(id)!).filter(Boolean);
  const pathEdges = pathEdgeIds.map((id) => graph.getEdge(id)!).filter(Boolean);

  return {
    path: pathNodes,
    nodes: pathNodes,
    edges: pathEdges,
    executionTimeMs: Date.now() - start,
    truncated,
    totalCount: pathNodes.length,
  };
}

// ── COUNT executor ────────────────────────────────────────────────────────────

function executeCOUNT(stmt: CountStatement, graph: KnowledgeGraph): GQLResult {
  const start = Date.now();
  const deadline = start + EXECUTION_TIMEOUT_MS;
  let truncated = false;

  const groups = new Map<string, number>();
  let total = 0;

  for (const node of graph.allNodes()) {
    if (Date.now() > deadline) { truncated = true; break; }

    if (stmt.target !== '*' && node.kind !== stmt.target) continue;
    if (stmt.where && !evaluateWhere(node, stmt.where)) continue;

    total++;

    if (stmt.groupBy) {
      const key = String(getNodeProperty(node, stmt.groupBy) ?? '(none)');
      groups.set(key, (groups.get(key) ?? 0) + 1);
    } else {
      groups.set('total', (groups.get('total') ?? 0) + 1);
    }
  }

  const groupList: CountGroup[] = [...groups.entries()].map(([key, count]) => ({ key, count }));
  groupList.sort((a, b) => b.count - a.count);

  return {
    groups: groupList,
    executionTimeMs: Date.now() - start,
    truncated,
    totalCount: total,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute a parsed GQL query against a KnowledgeGraph.
 */
export function executeGQL(ast: QueryAST, graph: KnowledgeGraph): GQLResult {
  switch (ast.type) {
    case 'FIND':
      return executeFIND(ast as FindStatement, graph);
    case 'TRAVERSE':
      return executeTRAVERSE(ast as TraverseStatement, graph);
    case 'PATH':
      return executePATH(ast as PathStatement, graph);
    case 'COUNT':
      return executeCOUNT(ast as CountStatement, graph);
    default:
      return {
        nodes: [],
        executionTimeMs: 0,
        truncated: false,
        totalCount: 0,
      };
  }
}
