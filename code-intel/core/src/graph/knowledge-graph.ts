import type { CodeNode, CodeEdge, EdgeKind } from '../shared/index.js';

export interface KnowledgeGraph {
  addNode(node: CodeNode): void;
  addEdge(edge: CodeEdge): void;
  getNode(id: string): CodeNode | undefined;
  getEdge(id: string): CodeEdge | undefined;
  findEdgesByKind(kind: EdgeKind): Iterable<CodeEdge>;
  findEdgesFrom(sourceId: string): Iterable<CodeEdge>;
  findEdgesTo(targetId: string): Iterable<CodeEdge>;
  removeNodeCascade(id: string): void;
  removeEdge(id: string): void;
  allNodes(): Iterable<CodeNode>;
  allEdges(): Iterable<CodeEdge>;
  readonly size: { nodes: number; edges: number };
  clear(): void;
}

export function createKnowledgeGraph(): KnowledgeGraph {
  const nodes = new Map<string, CodeNode>();
  const edges = new Map<string, CodeEdge>();
  const edgesByKind = new Map<EdgeKind, Set<string>>();
  const edgesFromNode = new Map<string, Set<string>>();
  const edgesToNode = new Map<string, Set<string>>();

  function indexEdge(edge: CodeEdge): void {
    let kindSet = edgesByKind.get(edge.kind);
    if (!kindSet) {
      kindSet = new Set();
      edgesByKind.set(edge.kind, kindSet);
    }
    kindSet.add(edge.id);

    let fromSet = edgesFromNode.get(edge.source);
    if (!fromSet) {
      fromSet = new Set();
      edgesFromNode.set(edge.source, fromSet);
    }
    fromSet.add(edge.id);

    let toSet = edgesToNode.get(edge.target);
    if (!toSet) {
      toSet = new Set();
      edgesToNode.set(edge.target, toSet);
    }
    toSet.add(edge.id);
  }

  function unindexEdge(edge: CodeEdge): void {
    edgesByKind.get(edge.kind)?.delete(edge.id);
    edgesFromNode.get(edge.source)?.delete(edge.id);
    edgesToNode.get(edge.target)?.delete(edge.id);
  }

  return {
    addNode(node: CodeNode): void {
      nodes.set(node.id, node);
    },

    addEdge(edge: CodeEdge): void {
      edges.set(edge.id, edge);
      indexEdge(edge);
    },

    getNode(id: string): CodeNode | undefined {
      return nodes.get(id);
    },

    getEdge(id: string): CodeEdge | undefined {
      return edges.get(id);
    },

    *findEdgesByKind(kind: EdgeKind): Iterable<CodeEdge> {
      const ids = edgesByKind.get(kind);
      if (!ids) return;
      for (const id of ids) {
        const edge = edges.get(id);
        if (edge) yield edge;
      }
    },

    *findEdgesFrom(sourceId: string): Iterable<CodeEdge> {
      const ids = edgesFromNode.get(sourceId);
      if (!ids) return;
      for (const id of ids) {
        const edge = edges.get(id);
        if (edge) yield edge;
      }
    },

    *findEdgesTo(targetId: string): Iterable<CodeEdge> {
      const ids = edgesToNode.get(targetId);
      if (!ids) return;
      for (const id of ids) {
        const edge = edges.get(id);
        if (edge) yield edge;
      }
    },

    removeNodeCascade(id: string): void {
      const fromEdges = edgesFromNode.get(id);
      if (fromEdges) {
        for (const edgeId of [...fromEdges]) {
          const edge = edges.get(edgeId);
          if (edge) {
            unindexEdge(edge);
            edges.delete(edgeId);
          }
        }
      }
      const toEdges = edgesToNode.get(id);
      if (toEdges) {
        for (const edgeId of [...toEdges]) {
          const edge = edges.get(edgeId);
          if (edge) {
            unindexEdge(edge);
            edges.delete(edgeId);
          }
        }
      }
      edgesFromNode.delete(id);
      edgesToNode.delete(id);
      nodes.delete(id);
    },

    removeEdge(id: string): void {
      const edge = edges.get(id);
      if (edge) {
        unindexEdge(edge);
        edges.delete(id);
      }
    },

    *allNodes(): Iterable<CodeNode> {
      yield* nodes.values();
    },

    *allEdges(): Iterable<CodeEdge> {
      yield* edges.values();
    },

    get size() {
      return { nodes: nodes.size, edges: edges.size };
    },

    clear(): void {
      nodes.clear();
      edges.clear();
      edgesByKind.clear();
      edgesFromNode.clear();
      edgesToNode.clear();
    },
  };
}
