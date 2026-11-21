/**
 * graph-reranker.ts — deterministic, local second-stage reranker.
 *
 * Re-scores first-stage (BM25/vector/RRF) candidates with evidence already in
 * the graph: lexical rank, exact identity, graph/flow proximity between
 * candidates, API relevance, relationship certainty and path category.
 *
 * Invariants:
 *  - No network, model or randomness: identical input → identical order.
 *  - Graph evidence is additive only; a candidate with no graph evidence keeps
 *    its lexical score, so missing evidence never erases a candidate.
 *  - Only `exact` relationships count as exact ranking evidence. `candidate`,
 *    `heuristic` and legacy (uncertified) edges contribute at a bounded weight
 *    and never set `exactPathEvidence`.
 */

import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode, RelationshipCertainty } from '../shared/index.js';

export const GRAPH_RERANK_VERSION = 'graph-rerank-v1';

export type RerankIntent = 'understand' | 'debug' | 'change' | 'review' | 'security' | 'api';

export interface RerankCandidate {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  /** Fused first-stage retrieval score. */
  score: number;
}

export type GraphRerankFeature =
  | 'lexical'
  | 'exact-identity'
  | 'graph-proximity'
  | 'flow'
  | 'api'
  | 'certainty'
  | 'path-category';

export interface GraphRerankContribution {
  feature: GraphRerankFeature;
  value: number;
  detail?: string;
}

export type GraphEvidenceStrength = 'none' | 'bounded' | 'exact';

export interface RerankedCandidate extends RerankCandidate {
  rerankScore: number;
  /** 1-based first-stage rank. */
  baseRank: number;
  graphEvidence: GraphEvidenceStrength;
  /** True only when at least one `exact` relationship supports the candidate. */
  exactPathEvidence: boolean;
  contributions: GraphRerankContribution[];
}

export interface GraphRerankOptions {
  intent?: RerankIntent;
}

export interface GraphRerankFeatureSet {
  version: typeof GRAPH_RERANK_VERSION;
  weights: Readonly<Record<GraphRerankFeature, number>>;
  /** Cap on total graph-proximity contribution so graph evidence re-orders but cannot dominate. */
  graphCap: number;
  certaintyWeights: Readonly<Record<'exact' | 'candidate' | 'heuristic' | 'legacy', number>>;
}

export const GRAPH_RERANK_FEATURE_SET: GraphRerankFeatureSet = Object.freeze({
  version: GRAPH_RERANK_VERSION,
  weights: Object.freeze({
    lexical: 1,
    'exact-identity': 0.5,
    'graph-proximity': 0.12,
    flow: 0.08,
    api: 0.15,
    certainty: 0.05,
    'path-category': 0.3,
  }),
  graphCap: 0.4,
  certaintyWeights: Object.freeze({ exact: 1, candidate: 0.4, heuristic: 0.2, legacy: 0.2 }),
});

const GENERATED_PATH = /(^|\/)(dist|build|out|generated|__generated__|vendor|node_modules|coverage)\/|\.min\.[jt]s$|\.d\.ts$|\.generated\./i;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|fixtures?)\/|\.(test|spec)\.[a-z0-9]+$/i;
const CONFIG_PATH = /(^|\/)(config|configs|\.github|\.vscode)\/|(^|\/)[^/]*\.(json|ya?ml|toml|ini|lock)$|\.config\.[jt]s$/i;

export type PathCategory = 'generated' | 'test' | 'config' | 'source';

export function classifyPath(filePath: string): PathCategory {
  const normalized = filePath.replace(/\\/g, '/');
  if (GENERATED_PATH.test(normalized)) return 'generated';
  if (TEST_PATH.test(normalized)) return 'test';
  if (CONFIG_PATH.test(normalized)) return 'config';
  return 'source';
}

function certaintyWeight(certainty: RelationshipCertainty | undefined): { weight: number; exact: boolean } {
  const weights = GRAPH_RERANK_FEATURE_SET.certaintyWeights;
  switch (certainty) {
    case 'exact': return { weight: weights.exact, exact: true };
    case 'candidate': return { weight: weights.candidate, exact: false };
    case 'heuristic': return { weight: weights.heuristic, exact: false };
    default: return { weight: weights.legacy, exact: false };
  }
}

function queryTokens(task: string): Set<string> {
  return new Set(task.toLowerCase().split(/[^\p{L}\p{N}_$]+/u).filter((token) => token.length > 1));
}

function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function compareReranked(a: RerankedCandidate, b: RerankedCandidate): number {
  return b.rerankScore - a.rerankScore
    || a.baseRank - b.baseRank
    || a.name.localeCompare(b.name)
    || a.filePath.localeCompare(b.filePath)
    || a.nodeId.localeCompare(b.nodeId);
}

/** Rerank first-stage candidates. Pure and deterministic. */
export function rerankCandidates(
  graph: KnowledgeGraph,
  task: string,
  candidates: readonly RerankCandidate[],
  options: GraphRerankOptions = {},
): RerankedCandidate[] {
  const { weights, graphCap } = GRAPH_RERANK_FEATURE_SET;
  const intent = options.intent ?? 'understand';
  const tokens = queryTokens(task);
  const maxScore = candidates.reduce((max, candidate) => Math.max(max, candidate.score), 0);
  const candidateIds = new Set(candidates.map((candidate) => candidate.nodeId));
  const nameCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const reranked = candidates.map((candidate, index): RerankedCandidate => {
    const contributions: GraphRerankContribution[] = [];
    const node: CodeNode | undefined = graph.getNode(candidate.nodeId);

    // Lexical/vector: always positive, so absent graph evidence cannot erase a candidate.
    const lexicalBase = maxScore > 0 ? Math.max(0, candidate.score) / maxScore : 1 / (index + 1);
    contributions.push({ feature: 'lexical', value: weights.lexical * lexicalBase, detail: `base-rank:${index + 1}` });

    const lowerName = candidate.name.toLowerCase();
    if (tokens.has(lowerName)) {
      contributions.push({ feature: 'exact-identity', value: weights['exact-identity'], detail: 'name-equals-query-token' });
    } else {
      const parts = splitIdentifier(candidate.name);
      if (parts.length > 1 && parts.every((part) => tokens.has(part))) {
        contributions.push({ feature: 'exact-identity', value: weights['exact-identity'] * 0.5, detail: 'identifier-words-in-query' });
      }
    }

    let exactPathEvidence = false;
    let graphEvidence: GraphEvidenceStrength = 'none';
    let proximity = 0;
    let flow = 0;
    let isApi = candidate.kind === 'route';
    if (node) {
      const seen = new Set<string>();
      const consider = (neighborId: string, certainty: RelationshipCertainty | undefined): void => {
        if (neighborId === candidate.nodeId || !candidateIds.has(neighborId)) return;
        const { weight, exact } = certaintyWeight(certainty);
        const key = `${neighborId}:${exact ? 'x' : 'b'}`;
        if (seen.has(key)) return;
        seen.add(key);
        proximity += weights['graph-proximity'] * weight;
        if (exact) {
          exactPathEvidence = true;
          graphEvidence = 'exact';
        } else if (graphEvidence === 'none') {
          graphEvidence = 'bounded';
        }
      };
      for (const edge of graph.findEdgesFrom(node.id)) {
        if (edge.kind === 'calls' || edge.kind === 'extends' || edge.kind === 'implements' || edge.kind === 'handles') {
          consider(edge.target, edge.certainty);
        }
        if (edge.kind === 'handles') isApi = true;
        if (edge.kind === 'step_of') flow = weights.flow;
      }
      for (const edge of graph.findEdgesTo(node.id)) {
        if (edge.kind === 'calls' || edge.kind === 'handles') consider(edge.source, edge.certainty);
      }
    }
    if (proximity > 0) {
      contributions.push({
        feature: 'graph-proximity',
        value: Math.min(proximity, graphCap),
        detail: exactPathEvidence ? 'exact-relationship' : 'bounded-certainty-only',
      });
    }
    if (flow > 0) contributions.push({ feature: 'flow', value: flow, detail: 'step-of-flow' });

    if (isApi) {
      contributions.push({
        feature: 'api',
        value: intent === 'api' ? weights.api : weights.api * 0.4,
        detail: intent === 'api' ? 'api-intent' : 'route-node',
      });
    }

    // Same display name on several candidates: name evidence cannot disambiguate.
    const duplicates = nameCounts.get(lowerName) ?? 1;
    if (duplicates > 1) {
      contributions.push({
        feature: 'certainty',
        value: -Math.min(weights.certainty * (duplicates - 1), weights.certainty * 3),
        detail: `ambiguous-name:${duplicates}`,
      });
    }

    const category = classifyPath(candidate.filePath);
    if (category === 'generated') {
      contributions.push({ feature: 'path-category', value: -weights['path-category'], detail: 'generated' });
    } else if (category === 'test' && intent !== 'review' && intent !== 'debug') {
      contributions.push({ feature: 'path-category', value: -weights['path-category'] * 0.5, detail: 'test' });
    } else if (category === 'config' && intent !== 'security') {
      contributions.push({ feature: 'path-category', value: -weights['path-category'] * 0.33, detail: 'config' });
    }

    return {
      ...candidate,
      rerankScore: round(contributions.reduce((sum, item) => sum + item.value, 0)),
      baseRank: index + 1,
      graphEvidence,
      exactPathEvidence,
      contributions: contributions.map((item) => ({ ...item, value: round(item.value) })),
    };
  });

  return reranked.sort(compareReranked);
}

/** Largest-magnitude contributions — used for optional diagnostics only. */
export function topContributions(candidate: RerankedCandidate, count = 3): GraphRerankContribution[] {
  return [...candidate.contributions]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.feature.localeCompare(b.feature))
    .slice(0, Math.max(0, count));
}
