import crypto from 'node:crypto';
import type { CodeEdge, CodeNode, EdgeKind, NodeKind } from '../shared/index.js';
import type { RelationshipCertainty } from '../shared/evidence-types.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { normalizeRepoRelativePath } from '../identity/normalization.js';

/**
 * Diff-relevant projection of a CodeNode. Deliberately excludes anything
 * volatile or storage-specific (no row order, no machine-local absolute
 * paths, no raw source text — only a content fingerprint of it) so that two
 * independently-built snapshots of semantically identical code normalize to
 * byte-identical records.
 */
export interface NormalizedNodeProperties {
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  exported?: boolean;
  contentFingerprint?: string;
}

export interface NormalizedNode {
  id: string;
  kind: NodeKind;
  properties: NormalizedNodeProperties;
}

export const NODE_PROPERTY_KEYS = ['name', 'filePath', 'startLine', 'endLine', 'exported', 'contentFingerprint'] as const;
export type NodePropertyKey = (typeof NODE_PROPERTY_KEYS)[number];

/**
 * Diff-relevant projection of a CodeEdge, keyed by (source, kind, target,
 * call-site) rather than the edge's storage row ID — the same logical edge
 * rebuilt in an independent analysis run gets a different storage ID but must
 * key to the same normalized identity here.
 */
export interface NormalizedEdge {
  key: string;
  source: string;
  target: string;
  kind: EdgeKind;
  callSiteId?: string;
  certainty?: RelationshipCertainty;
  strategy?: string;
  evidenceRef?: string;
  confidence?: number;
  ambiguous?: boolean;
}

export const EDGE_FIELD_KEYS = ['certainty', 'strategy', 'evidenceRef', 'confidence', 'ambiguous'] as const;
export type EdgeFieldKey = (typeof EDGE_FIELD_KEYS)[number];

export interface NormalizedGraph {
  nodesById: Map<string, NormalizedNode>;
  edgesByKey: Map<string, NormalizedEdge>;
}

function fingerprintContent(content: string | undefined): string | undefined {
  if (!content) return undefined;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * `declarationFingerprint` should be the corresponding entry from a
 * snapshot's content-fingerprints.json sidecar (see content-fingerprints.ts)
 * when available — it is computed from the node's real declaration source
 * text and is what change/rename/move detection actually relies on. Falling
 * back to hashing `node.content` is a last resort: that field is `undefined`
 * for virtually every symbol node kind (function/method/class/...) and
 * truncated to 2000 characters for `file` nodes, so it mainly still applies
 * to file-level nodes when no sidecar is present.
 */
export function normalizeNode(node: CodeNode, declarationFingerprint?: string): NormalizedNode {
  return {
    id: node.id,
    kind: node.kind,
    properties: {
      name: node.name,
      filePath: normalizeRepoRelativePath(node.filePath),
      startLine: node.startLine,
      endLine: node.endLine,
      exported: node.exported,
      contentFingerprint: declarationFingerprint ?? fingerprintContent(node.content),
    },
  };
}

export function edgeKey(edge: Pick<CodeEdge, 'source' | 'target' | 'kind' | 'callSiteId'>): string {
  return `${edge.source}::${edge.kind}::${edge.target}::${edge.callSiteId ?? ''}`;
}

export function normalizeEdge(edge: CodeEdge): NormalizedEdge {
  return {
    key: edgeKey(edge),
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    callSiteId: edge.callSiteId,
    certainty: edge.certainty,
    strategy: edge.strategy,
    evidenceRef: edge.evidenceRef,
    confidence: edge.confidence,
    ambiguous: edge.ambiguous,
  };
}

/**
 * `flow` and `cluster` nodes (and their `step_of` / `belongs_to` membership
 * edges) are excluded here, not just from the top-level diff sections. Their
 * IDs are generated from an accumulating per-run enumeration index
 * (pipeline/phases/flow-phase.ts, cluster-phase.ts), not a content
 * fingerprint, so they are not guaranteed to match across two independent
 * analysis runs even when nothing semantically changed — including them in
 * the generic node/edge diff would fabricate spurious added/removed deltas.
 * See types.ts `UnsupportedDiffSection`.
 */
const UNSTABLE_IDENTITY_NODE_KINDS: ReadonlySet<NodeKind> = new Set(['flow', 'cluster']);
const UNSTABLE_IDENTITY_EDGE_KINDS: ReadonlySet<EdgeKind> = new Set(['step_of', 'belongs_to']);

/**
 * Reduces a reopened KnowledgeGraph to maps keyed by canonical node ID and
 * normalized edge key. Multiple call sites between the same (source, kind,
 * target) produce distinct entries here because `callSiteId` is part of the
 * key — they are never collapsed into one edge. `contentFingerprints` is a
 * snapshot's content-fingerprints.json sidecar (node ID -> declaration
 * fingerprint); pass it whenever available so change/rename/move detection
 * has real per-symbol content to compare, not just `node.content` (see
 * normalizeNode's doc comment for why that alone is insufficient).
 */
export function normalizeGraphForDiff(graph: KnowledgeGraph, contentFingerprints?: Record<string, string>): NormalizedGraph {
  const nodesById = new Map<string, NormalizedNode>();
  for (const node of graph.allNodes()) {
    if (!node.id || UNSTABLE_IDENTITY_NODE_KINDS.has(node.kind)) continue;
    nodesById.set(node.id, normalizeNode(node, contentFingerprints?.[node.id]));
  }
  const edgesByKey = new Map<string, NormalizedEdge>();
  for (const edge of graph.allEdges()) {
    if (UNSTABLE_IDENTITY_EDGE_KINDS.has(edge.kind)) continue;
    const normalized = normalizeEdge(edge);
    edgesByKey.set(normalized.key, normalized);
  }
  return { nodesById, edgesByKey };
}
