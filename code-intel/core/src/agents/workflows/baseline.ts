/**
 * baseline.ts
 *
 * Captures and rehydrates the verification base for one repository of a
 * change-workflow session.
 *
 * A Generation directory can be evicted by later `analyze` runs
 * (`cleanupOldGenerations` keeps two), so a session cannot rely on its
 * baseline Generation still being on disk at verify time. Instead `start`
 * records a self-contained, hash-only projection of the baseline index:
 *
 * - the snapshot normalizer's projection (canonical node IDs, kinds, names,
 *   paths, line anchors and per-declaration *content fingerprints*; edges
 *   keyed by canonical endpoints + call site; stable flow metadata),
 * - API-contract nodes (`route`/`api_consumer`/`api_shape` metadata plus the
 *   route `handles` edge) so contract drift can reuse `getApiDrift`,
 * - structural cycle keys and security finding keys for the review lenses.
 *
 * No source text is stored — content is represented only by sha256
 * fingerprints computed from the working tree that the trusted, fresh index
 * was built from.
 */

import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import { createKnowledgeGraph } from '../../graph/knowledge-graph.js';
import type { CodeEdge, CodeNode } from '../../shared/index.js';
import { computeContentFingerprints } from '../../snapshots/content-fingerprints.js';
import {
  normalizeGraphForDiff,
  type NormalizedEdge,
  type NormalizedFlow,
  type NormalizedGraph,
  type NormalizedNode,
} from '../../snapshots/normalizer.js';
import { detectCircularDeps } from '../../health/circular-deps.js';
import { VulnerabilityDetector } from '../../security/vulnerability-detector.js';
import { WORKFLOW_BASELINE_SCHEMA_VERSION } from './session-types.js';

const API_NODE_KINDS = new Set(['route', 'api_consumer', 'api_shape']);

export interface WorkflowBaselinePayload {
  schemaVersion: typeof WORKFLOW_BASELINE_SCHEMA_VERSION;
  repositoryId: string;
  generationId?: string;
  nodes: NormalizedNode[];
  edges: NormalizedEdge[];
  flows: NormalizedFlow[];
  /** API-contract nodes only (metadata, no content) plus their handler nodes and `handles` edges. */
  apiNodes: CodeNode[];
  apiEdges: CodeEdge[];
  cycleKeys: string[];
  securityFindingKeys: string[];
  /** [nodeId, identityId] pairs where the two differ (flows reference identity IDs). */
  identityAliases: Array<[string, string]>;
}

export function cycleKeysOf(graph: KnowledgeGraph): string[] {
  return detectCircularDeps(graph).map((cycle) => [...cycle.members].sort().join('|')).sort();
}

export function identityAliasesOf(graph: KnowledgeGraph): Array<[string, string]> {
  const aliases: Array<[string, string]> = [];
  for (const node of graph.allNodes()) {
    if (node.identityId && node.identityId !== node.id) aliases.push([node.id, node.identityId]);
  }
  return aliases.sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Security finding keys. `VulnerabilityDetector.detect` tags the graph it
 * scans with `vulnerability` nodes; those are removed again afterwards so
 * the shared graph is left as it was.
 */
export function securityFindingKeysOf(graph: KnowledgeGraph): { keys: string[]; nodeIdsByKey: Map<string, string> } {
  const before = new Set<string>();
  for (const node of graph.allNodes()) before.add(node.id);
  const findings = new VulnerabilityDetector().detect(graph);
  for (const node of [...graph.allNodes()]) {
    if (!before.has(node.id)) graph.removeNodeCascade(node.id);
  }
  const nodeIdsByKey = new Map<string, string>();
  // detect() reports file/line/symbol; map back to the declaring node for scoping.
  const byLocation = new Map<string, string>();
  for (const node of graph.allNodes()) {
    if (node.kind === 'vulnerability') continue;
    byLocation.set(`${node.filePath}\u0000${node.name}`, node.id);
  }
  for (const finding of findings) {
    const key = `${finding.type}\u0000${finding.file}\u0000${finding.symbol}`;
    nodeIdsByKey.set(key, byLocation.get(`${finding.file}\u0000${finding.symbol}`) ?? '');
  }
  return { keys: [...nodeIdsByKey.keys()].sort(), nodeIdsByKey };
}

function stripContent(node: CodeNode): CodeNode {
  const { content: _content, ...rest } = node;
  return rest;
}

function apiProjection(graph: KnowledgeGraph): { apiNodes: CodeNode[]; apiEdges: CodeEdge[] } {
  const apiNodes = new Map<string, CodeNode>();
  const apiEdges: CodeEdge[] = [];
  for (const node of graph.allNodes()) {
    if (!API_NODE_KINDS.has(node.kind)) continue;
    apiNodes.set(node.id, stripContent(node));
    if (node.kind !== 'route') continue;
    for (const edge of graph.findEdgesFrom(node.id)) {
      if (edge.kind !== 'handles') continue;
      const handler = graph.getNode(edge.target);
      if (handler) apiNodes.set(handler.id, stripContent(handler));
      apiEdges.push(edge);
    }
  }
  return {
    apiNodes: [...apiNodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    apiEdges: apiEdges.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Normalized projection of the *current* index, with content fingerprints from `repoDir`'s working tree. */
export function normalizeCurrentGraph(graph: KnowledgeGraph, repoDir: string): NormalizedGraph {
  return normalizeGraphForDiff(graph, computeContentFingerprints(repoDir, graph));
}

export function captureBaseline(input: {
  repositoryId: string;
  generationId?: string;
  graph: KnowledgeGraph;
  repoDir: string;
  /** Pre-computed normalized graph (avoids fingerprinting twice). */
  normalized?: NormalizedGraph;
}): WorkflowBaselinePayload {
  const normalized = input.normalized ?? normalizeCurrentGraph(input.graph, input.repoDir);
  const { apiNodes, apiEdges } = apiProjection(input.graph);
  const cycleKeys = cycleKeysOf(input.graph);
  const securityFindingKeys = securityFindingKeysOf(input.graph).keys;
  return {
    schemaVersion: WORKFLOW_BASELINE_SCHEMA_VERSION,
    repositoryId: input.repositoryId,
    generationId: input.generationId,
    nodes: [...normalized.nodesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...normalized.edgesByKey.values()].sort((a, b) => a.key.localeCompare(b.key)),
    flows: [...(normalized.flowsById?.values() ?? [])].sort((a, b) => a.flowId.localeCompare(b.flowId)),
    apiNodes,
    apiEdges,
    cycleKeys,
    securityFindingKeys,
    identityAliases: identityAliasesOf(input.graph),
  };
}

export function isBaselinePayload(value: unknown): value is WorkflowBaselinePayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['schemaVersion'] === WORKFLOW_BASELINE_SCHEMA_VERSION
    && typeof record['repositoryId'] === 'string'
    && Array.isArray(record['nodes'])
    && Array.isArray(record['edges'])
    && Array.isArray(record['flows'])
    && Array.isArray(record['apiNodes'])
    && Array.isArray(record['apiEdges'])
    && Array.isArray(record['cycleKeys'])
    && Array.isArray(record['securityFindingKeys'])
    && Array.isArray(record['identityAliases']);
}

export function rehydrateNormalizedGraph(payload: WorkflowBaselinePayload): NormalizedGraph {
  return {
    nodesById: new Map(payload.nodes.map((node) => [node.id, node])),
    edgesByKey: new Map(payload.edges.map((edge) => [edge.key, edge])),
    flowsById: new Map(payload.flows.map((flow) => [flow.flowId, flow])),
  };
}

/** Minimal KnowledgeGraph holding only API-contract facts — enough for `getApiDrift`'s base side. */
export function rehydrateApiGraph(payload: WorkflowBaselinePayload): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  for (const node of payload.apiNodes) graph.addNode(node);
  for (const edge of payload.apiEdges) {
    if (graph.getNode(edge.source) && graph.getNode(edge.target)) graph.addEdge(edge);
  }
  return graph;
}
