/**
 * explore.ts — transport-independent task-oriented exploration.
 *
 * Composes existing services behind one call:
 *   task → intent → scoped retrieval → graph-aware rerank → seed resolution →
 *   bounded intent expansion → render policy → context builder → coverage/trust.
 *
 * MCP, CLI and HTTP all call `runExplore`; none re-implement any step.
 * Intent changes allocation/orchestration only, never semantic truth: absent
 * evidence is reported as a coverage boundary, never as "nothing there".
 */

import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisBoundary, AnalysisCertainty, AnalysisCoverage, CodeNode } from '../shared/index.js';
import { build, type ContextDocument, type QueryIntent } from '../context/builder.js';
import { normalizeContextTokenBudget } from '../context/budget.js';
import { planRender, renderModeDistribution, type CompressionPolicy, type ContextRenderMode } from '../context/render-policy.js';
import type { ContextDeliverySession } from '../context/session.js';
import { SKELETON_CAPABILITIES } from '../context/skeletonizer.js';
import { hydrateNodeSource, type HydrationBoundary } from '../context/source-hydration.js';
import {
  GRAPH_RERANK_VERSION,
  rerankCandidates,
  topContributions,
  type GraphRerankContribution,
  type RerankCandidate,
  type RerankedCandidate,
  type RerankIntent,
} from '../search/graph-reranker.js';
import { executeSearchRequest, type ExecuteScopedSearchDeps, type SearchRequest } from '../search/execute-scoped-search.js';
import { computePRImpact } from './pr-impact.js';
import { suggestTests } from './suggest-tests.js';
import { getApiImpact } from '../semantic/api-contracts/service.js';
import { mergeBoundaries, mergeCoverage } from './trust.js';

export const EXPLORE_INTENTS = ['understand', 'debug', 'change', 'review', 'security', 'api'] as const;
export type ExploreIntent = (typeof EXPLORE_INTENTS)[number];
export type ExploreCompression = CompressionPolicy;

/** Hard work limits — Explore never does unbounded graph work. */
export const EXPLORE_LIMITS = Object.freeze({
  candidatePool: 20,
  maxSeeds: 8,
  defaultSeeds: 5,
  maxExpandedNodes: 12,
  maxGraphLookups: 600,
  maxImpactFiles: 3,
  maxTestSymbols: 3,
  maxListItems: 10,
});

export interface ExploreRequest {
  task: string;
  intent?: ExploreIntent | 'auto';
  maxTokens?: number;
  compression?: ExploreCompression;
  explainRanking?: boolean;
  /** Number of seed symbols (1–8, default 5). */
  seeds?: number;
}

export interface ExploreSearchOutcome {
  hits: RerankCandidate[];
  actualMode: string;
  vectorReady: boolean;
  fallbackReason?: string;
}

export interface ExploreDeps {
  graph: KnowledgeGraph;
  /** First-stage retrieval. Transports bind this to the existing scoped search path. */
  search: (query: string, limit: number) => Promise<ExploreSearchOutcome>;
  repoDir?: string;
  repoName?: string;
  /** Delivered-source memory; absent → no session references. */
  session?: ContextDeliverySession;
  /** Selected index/snapshot identity for session freshness. */
  indexIdentity?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export class ExploreRequestError extends Error {
  constructor(message: string, readonly status = 400, readonly hint?: string) {
    super(message);
    this.name = 'ExploreRequestError';
  }
}

/** Compact by default; `nodeId`, `rank` and `score` appear only with `explainRanking`. */
export interface ExploreSeed {
  symbol: string;
  kind: string;
  filePath: string;
  startLine?: number;
  graphEvidence: RerankedCandidate['graphEvidence'];
  /** Present (true) only when an exact relationship supports the candidate. */
  exactPathEvidence?: true;
  nodeId?: string;
  rank?: number;
  score?: number;
}

/** Compact by default (`name`, `mode`, `boundary`); reasons and token detail only with `explainRanking`. */
export interface ExploreRenderDecision {
  name: string;
  mode: ContextRenderMode;
  /** Capability boundary when a requested mode degraded. */
  boundary?: string;
  artifactId?: string;
  reason?: string;
  deliveredTokens?: number;
  bodyOmitted?: boolean;
}

export interface ExploreEvidence {
  callers: string[];
  callees: string[];
  impactedSymbols: string[];
  highestRisk?: string;
  tests: { symbol: string; existingTests: string[]; untestedCallers: string[] }[];
  api: { routes: string[]; consumers: number; consumerCoverageComplete: boolean } | null;
  security: { symbol: string; type: string; sink: string; line: number; tier: string }[];
}

export interface ExploreCounters {
  candidates: number;
  seeds: number;
  expandedNodes: number;
  graphLookups: number;
  renderModes: Record<ContextRenderMode, number>;
  skeletonFallbacks: number;
  hydratedNodes: number;
  omissions: number;
  tokensRequested: number;
  tokensDelivered: number;
  tokensSaved: number;
}

export interface ExploreResult {
  task: string;
  intent: ExploreIntent;
  intentSource: 'requested' | 'detected';
  maxTokens: number;
  seeds: ExploreSeed[];
  evidence: ExploreEvidence;
  context: {
    summary: string;
    logic: string;
    relation: string;
    focusCode: string;
    truncated: boolean;
    blockTokens?: ContextDocument['blockTokens'];
    renderDecisions: ExploreRenderDecision[];
    omitted: NonNullable<ContextDocument['omitted']>;
  };
  certainty: AnalysisCertainty;
  coverage?: AnalysisCoverage;
  boundaries: readonly AnalysisBoundary[];
  capabilities: {
    search: { actualMode: string; vectorReady: boolean; fallbackReason?: string };
    rerank: string;
    alternateRef: 'unavailable';
    /** Only with `explainRanking`. */
    skeletonLanguages?: string[];
    degraded: string[];
  };
  counters: ExploreCounters;
  durationsMs: { search: number; rerank: number; expand: number; render: number; build: number; total: number };
  /** Present only when `explainRanking` was requested. */
  ranking?: { symbol: string; baseRank: number; rerankScore: number; top: GraphRerankContribution[] }[];
}

const INTENT_PATTERNS: ReadonlyArray<readonly [ExploreIntent, RegExp]> = [
  ['security', /\b(vulnerab\w*|inject\w*|xss|ssrf|csrf|secur\w*|sanitiz\w*|taint\w*|authoriz\w*|authenticat\w*)\b/i],
  ['api', /\b(api|endpoints?|routes?|http|rest|contracts?|payloads?|requests?|responses?)\b/i],
  ['review', /\b(review|pull request|diff|regression|pr)\b/i],
  ['debug', /\b(bug|fails?|failing|error|crash\w*|broken|exception|wrong|why (does|is|did)|not working)\b/i],
  ['change', /\b(add|change|modify|implement|refactor|migrate|rename|support|extend|update|what must)\b/i],
];

export function detectExploreIntent(task: string): ExploreIntent {
  for (const [intent, pattern] of INTENT_PATTERNS) if (pattern.test(task)) return intent;
  return 'understand';
}

const CONTEXT_INTENT: Record<ExploreIntent, QueryIntent> = {
  understand: 'architecture',
  debug: 'code',
  change: 'auto',
  review: 'callers',
  security: 'code',
  api: 'auto',
};

function emptyEvidence(): ExploreEvidence {
  return { callers: [], callees: [], impactedSymbols: [], tests: [], api: null, security: [] };
}

export function normalizeExploreRequest(request: ExploreRequest): {
  task: string;
  intent: ExploreIntent;
  intentSource: 'requested' | 'detected';
  maxTokens: number;
  compression: ExploreCompression;
  explainRanking: boolean;
  seeds: number;
} {
  const task = typeof request.task === 'string' ? request.task.trim() : '';
  if (!task) throw new ExploreRequestError('Missing task', 400, 'Provide { "task": "..." }');
  const requested = request.intent;
  if (requested !== undefined && requested !== 'auto' && !(EXPLORE_INTENTS as readonly string[]).includes(requested)) {
    throw new ExploreRequestError(`Invalid intent '${String(requested)}'`, 400, `intent must be one of ${EXPLORE_INTENTS.join(', ')} or auto`);
  }
  const compression = request.compression ?? 'auto';
  if (!['auto', 'none', 'aggressive'].includes(compression)) {
    throw new ExploreRequestError(`Invalid compression '${String(compression)}'`, 400, 'compression must be auto, none or aggressive');
  }
  const intentSource = requested && requested !== 'auto' ? 'requested' : 'detected';
  const seeds = Math.max(1, Math.min(EXPLORE_LIMITS.maxSeeds, Math.trunc(request.seeds ?? EXPLORE_LIMITS.defaultSeeds) || EXPLORE_LIMITS.defaultSeeds));
  return {
    task,
    intent: requested && requested !== 'auto' ? requested : detectExploreIntent(task),
    intentSource,
    maxTokens: normalizeContextTokenBudget(request.maxTokens),
    compression,
    explainRanking: request.explainRanking === true,
    seeds,
  };
}

/** Bind first-stage retrieval to the existing scoped search path (BM25/vector/RRF with fallbacks). */
export function createScopedExploreSearch(
  base: Pick<SearchRequest, 'scope' | 'repoId' | 'repo' | 'group'>,
  deps: ExecuteScopedSearchDeps,
): ExploreDeps['search'] {
  return async (query, limit) => {
    const result = await executeSearchRequest({ ...base, query, limit, mode: 'auto' }, deps);
    if ('error' in result && result.error) {
      throw new ExploreRequestError(result.error.message, result.error.status, result.error.hint);
    }
    if (!('body' in result)) throw new ExploreRequestError('Invalid search result', 500);
    const body = result.body;
    const hits = (body.results as Array<Partial<RerankCandidate> & { nodeId?: string }>)
      .filter((hit): hit is RerankCandidate => typeof hit.nodeId === 'string' && typeof hit.name === 'string')
      .map((hit) => ({ nodeId: hit.nodeId, name: hit.name, kind: String(hit.kind ?? ''), filePath: String(hit.filePath ?? ''), score: Number(hit.score ?? 0) }));
    return { hits, actualMode: body.actualMode, vectorReady: body.vectorReady, fallbackReason: body.fallbackReason };
  };
}

interface ExpansionResult {
  evidence: ExploreEvidence;
  extraNodeIds: string[];
  coverages: Array<AnalysisCoverage | undefined>;
  boundaries: Array<readonly AnalysisBoundary[] | undefined>;
  degraded: string[];
  graphLookups: number;
}

class LookupBudget {
  count = 0;
  exhausted = false;
  take(): boolean {
    if (this.count >= EXPLORE_LIMITS.maxGraphLookups) {
      this.exhausted = true;
      return false;
    }
    this.count += 1;
    return true;
  }
}

function neighbors(
  graph: KnowledgeGraph,
  nodeId: string,
  direction: 'in' | 'out',
  budget: LookupBudget,
): CodeNode[] {
  if (!budget.take()) return [];
  const edges = direction === 'out' ? graph.findEdgesFrom(nodeId) : graph.findEdgesTo(nodeId);
  const found = new Map<string, CodeNode>();
  for (const edge of edges) {
    if (edge.kind !== 'calls') continue;
    const other = graph.getNode(direction === 'out' ? edge.target : edge.source);
    if (other && other.id !== nodeId && !found.has(other.id)) found.set(other.id, other);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function names(nodes: readonly CodeNode[]): string[] {
  return [...new Set(nodes.map((node) => node.name))].sort().slice(0, EXPLORE_LIMITS.maxListItems);
}

function expandIntent(
  intent: ExploreIntent,
  graph: KnowledgeGraph,
  seedNodes: readonly CodeNode[],
  deps: ExploreDeps,
): ExpansionResult {
  const budget = new LookupBudget();
  const evidence = emptyEvidence();
  const extra = new Map<string, CodeNode>();
  const coverages: Array<AnalysisCoverage | undefined> = [];
  const boundaries: Array<readonly AnalysisBoundary[] | undefined> = [];
  const degraded: string[] = [];
  const addExtra = (nodes: readonly CodeNode[]): void => {
    for (const node of nodes) if (!seedNodes.some((seed) => seed.id === node.id)) extra.set(node.id, node);
  };

  const callGraphEvidence = (limit: number): void => {
    const callers: CodeNode[] = [];
    const callees: CodeNode[] = [];
    for (const seed of seedNodes.slice(0, limit)) {
      callers.push(...neighbors(graph, seed.id, 'in', budget));
      callees.push(...neighbors(graph, seed.id, 'out', budget));
    }
    evidence.callers = names(callers);
    evidence.callees = names(callees);
    addExtra(callees);
    addExtra(callers);
  };

  switch (intent) {
    case 'understand':
      callGraphEvidence(2);
      break;
    case 'debug':
      callGraphEvidence(3);
      break;
    case 'change':
    case 'review': {
      callGraphEvidence(2);
      const files = [...new Set(seedNodes.map((node) => node.filePath).filter(Boolean))].slice(0, EXPLORE_LIMITS.maxImpactFiles);
      if (files.length > 0) {
        const impact = computePRImpact(graph, files, 2, deps.repoDir);
        evidence.impactedSymbols = [...new Set(impact.impactedSymbols.map((s) => s.name))].sort().slice(0, EXPLORE_LIMITS.maxListItems);
        evidence.highestRisk = impact.riskSummary.HIGH > 0 ? 'HIGH' : impact.riskSummary.MEDIUM > 0 ? 'MEDIUM' : (impact.riskSummary.UNKNOWN ?? 0) > 0 ? 'UNKNOWN' : impact.riskSummary.LOW > 0 ? 'LOW' : 'NONE';
        coverages.push(impact.coverage);
        boundaries.push(impact.boundaries);
        if (impact.apiImpact) {
          evidence.api = {
            routes: impact.apiImpact.routes.map((route) => `${route.method} ${route.normalizedPath}`).slice(0, EXPLORE_LIMITS.maxListItems),
            consumers: impact.apiImpact.consumers.length,
            consumerCoverageComplete: impact.apiImpact.consumerCoverageComplete,
          };
        }
      }
      for (const seed of seedNodes.filter((node) => node.kind === 'function' || node.kind === 'method').slice(0, EXPLORE_LIMITS.maxTestSymbols)) {
        const tests = suggestTests(graph, seed.name, deps.repoDir);
        if ('error' in tests) continue;
        evidence.tests.push({ symbol: seed.name, existingTests: tests.existingTests.slice(0, EXPLORE_LIMITS.maxListItems), untestedCallers: tests.untestedCallers.slice(0, EXPLORE_LIMITS.maxListItems) });
        coverages.push(tests.coverage);
        boundaries.push(tests.boundaries);
      }
      break;
    }
    case 'security': {
      callGraphEvidence(2);
      // Read recorded signals only: VulnerabilityDetector.detect() tags the graph, which Explore must not mutate.
      for (const seed of seedNodes) {
        for (const signal of seed.metadata?.securitySignals ?? []) {
          evidence.security.push({ symbol: seed.name, type: signal.type, sink: signal.sink, line: signal.line, tier: signal.tier });
        }
      }
      evidence.security.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.line - b.line || a.type.localeCompare(b.type));
      evidence.security = evidence.security.slice(0, EXPLORE_LIMITS.maxListItems);
      degraded.push('security: recorded signals and guard-adjacent call evidence only; no end-to-end taint proof');
      boundaries.push([{ kind: 'unsupported-semantics', evidenceRefs: [] }]);
      break;
    }
    case 'api': {
      callGraphEvidence(1);
      const routeSeeds = seedNodes.filter((node) => node.kind === 'route');
      if (routeSeeds.length === 0) {
        degraded.push('api: no route seed among top candidates');
        break;
      }
      const impacts = routeSeeds.slice(0, 3).map((route) => getApiImpact(graph, { routeNodeId: route.id }, deps.repoName ?? 'local'));
      const routes = impacts.flatMap((impact) => impact.routes.map((route) => `${route.method} ${route.normalizedPath}`));
      evidence.api = {
        routes: [...new Set(routes)].sort().slice(0, EXPLORE_LIMITS.maxListItems),
        consumers: impacts.reduce((sum, impact) => sum + impact.consumers.length, 0),
        consumerCoverageComplete: impacts.every((impact) => impact.coverage.consumerCoverageComplete),
      };
      if (!evidence.api.consumerCoverageComplete) degraded.push('api: consumer matching incomplete — no-consumer is not proof');
      break;
    }
  }

  if (budget.exhausted) {
    degraded.push('expansion: graph lookup budget exhausted');
    coverages.push({ complete: false, examinedCount: budget.count, incompleteReasons: ['analysis-limit'] });
    boundaries.push([{ kind: 'analysis-limit', evidenceRefs: [] }]);
  }
  return { evidence, extraNodeIds: [...extra.keys()].slice(0, EXPLORE_LIMITS.maxExpandedNodes), coverages, boundaries, degraded, graphLookups: budget.count };
}

const CERTAINTY_ORDER: readonly AnalysisCertainty[] = ['exact', 'heuristic', 'lower-bound', 'truncated', 'unavailable'];

function weakestCertainty(values: ReadonlyArray<AnalysisCertainty | undefined>): AnalysisCertainty {
  let worst = 0;
  for (const value of values) if (value) worst = Math.max(worst, CERTAINTY_ORDER.indexOf(value));
  return CERTAINTY_ORDER[worst]!;
}

function ms(clock: () => number, since: number): number {
  return Math.max(0, Math.round(clock() - since));
}

export async function runExplore(request: ExploreRequest, deps: ExploreDeps): Promise<ExploreResult> {
  const clock = deps.now ?? (() => performance.now());
  const startedAt = clock();
  const normalized = normalizeExploreRequest(request);
  const { graph } = deps;
  const degraded: string[] = [];

  // 1. scoped retrieval
  const searchStart = clock();
  const outcome = await deps.search(normalized.task, EXPLORE_LIMITS.candidatePool);
  const searchMs = ms(clock, searchStart);
  if (outcome.fallbackReason) degraded.push(`search: ${outcome.fallbackReason} — ${outcome.actualMode} used`);
  degraded.push('ref: alternate-ref views unavailable — using current index');

  // 2. graph-aware rerank
  const rerankStart = clock();
  const reranked = rerankCandidates(graph, normalized.task, outcome.hits, { intent: normalized.intent as RerankIntent });
  const rerankMs = ms(clock, rerankStart);

  // 3. seeds
  const seedCandidates = reranked.filter((candidate) => graph.getNode(candidate.nodeId)).slice(0, normalized.seeds);
  const seedNodes = seedCandidates.map((candidate) => graph.getNode(candidate.nodeId)!);
  const seeds: ExploreSeed[] = seedCandidates.map((candidate, index) => ({
    symbol: candidate.name,
    kind: candidate.kind,
    filePath: candidate.filePath,
    startLine: seedNodes[index]!.startLine,
    graphEvidence: candidate.graphEvidence,
    ...(candidate.exactPathEvidence ? { exactPathEvidence: true as const } : {}),
    ...(normalized.explainRanking ? { nodeId: candidate.nodeId, rank: index + 1, score: candidate.rerankScore } : {}),
  }));

  // 4. bounded intent expansion
  const expandStart = clock();
  const expansion = seedNodes.length > 0
    ? expandIntent(normalized.intent, graph, seedNodes, deps)
    : { evidence: emptyEvidence(), extraNodeIds: [], coverages: [], boundaries: [], degraded: [], graphLookups: 0 } satisfies ExpansionResult;
  const expandMs = ms(clock, expandStart);
  degraded.push(...expansion.degraded);

  // 5. render policy
  const renderStart = clock();
  const topScore = seedCandidates[0]?.rerankScore ?? 1;
  const normalizedScore = (score: number): number => (topScore > 0 ? Math.max(0, score) / topScore : 1);
  const contextNodes: Array<{ node: CodeNode; relevance: number }> = [
    ...seedNodes.map((node, index) => ({ node, relevance: normalizedScore(seedCandidates[index]!.rerankScore) })),
    ...expansion.extraNodeIds
      .map((id) => graph.getNode(id))
      .filter((node): node is CodeNode => node !== undefined)
      .map((node) => ({ node, relevance: 0.2 })),
  ];
  // The store keeps only a prefix of each body; recover full source (read-only, drift-checked) for rendering.
  const contentOverrides = new Map<string, string>();
  const hydrationBoundaries = new Set<HydrationBoundary>();
  const hydratedCandidates = contextNodes.map(({ node, relevance }) => {
    const hydration = hydrateNodeSource(node, deps.repoDir);
    if (hydration.boundary) hydrationBoundaries.add(hydration.boundary);
    if (hydration.status === 'hydrated' && hydration.content !== undefined) {
      contentOverrides.set(node.id, hydration.content);
      return { node: { ...node, content: hydration.content }, relevance };
    }
    return { node, relevance };
  });
  for (const boundary of [...hydrationBoundaries].sort()) {
    degraded.push(`source: ${boundary} — indexed (possibly truncated) content used for some symbols`);
  }
  if (hydrationBoundaries.has('source-drift')) expansion.boundaries.push([{ kind: 'stale-index', evidenceRefs: [] }]);
  const plan = await planRender({
    candidates: hydratedCandidates,
    maxTokens: normalized.maxTokens,
    compression: normalized.compression,
    session: deps.session,
    indexIdentity: deps.indexIdentity,
  });
  const renderMs = ms(clock, renderStart);

  // 6. existing context builder (owns the hard budget, trust and omission receipts)
  const buildStart = clock();
  const doc = build(
    contextNodes.map(({ node, relevance }) => ({ nodeId: node.id, refinedScore: relevance })),
    graph,
    {
      maxTokens: normalized.maxTokens,
      queryIntent: CONTEXT_INTENT[normalized.intent],
      repoDir: deps.repoDir,
      session: deps.session,
      renderPlan: plan,
      indexIdentity: deps.indexIdentity,
      contentOverrides,
    },
  );
  const buildMs = ms(clock, buildStart);

  // 7. coverage / trust aggregation
  const coverage = mergeCoverage([doc.coverage, ...expansion.coverages]);
  const boundaries = mergeBoundaries([doc.trust?.boundaries, ...expansion.boundaries]);
  const certainty = seeds.length === 0
    ? 'unavailable'
    : weakestCertainty([doc.trust?.certainty, coverage && !coverage.complete ? 'lower-bound' : undefined, doc.truncated ? 'truncated' : undefined]);
  if (seeds.length === 0) degraded.push('search: no candidates — absence is not proof that nothing relevant exists');

  const renderDecisions: ExploreRenderDecision[] = (doc.renderDecisions ?? []).map((decision) => ({
    name: decision.name,
    mode: decision.mode,
    ...(decision.boundary ? { boundary: decision.boundary } : {}),
    ...(normalized.explainRanking
      ? { artifactId: decision.artifactId, reason: decision.reason, deliveredTokens: decision.deliveredTokens, bodyOmitted: decision.bodyOmitted }
      : {}),
  }));
  const delivered = doc.blockTokens?.total ?? 0;
  const fullSourceTokens = seedNodes.reduce((sum, node) => sum + Math.ceil((node.content ?? '').length / 4), 0);
  const counters: ExploreCounters = {
    candidates: outcome.hits.length,
    seeds: seeds.length,
    expandedNodes: expansion.extraNodeIds.length,
    graphLookups: expansion.graphLookups,
    renderModes: renderModeDistribution(plan),
    skeletonFallbacks: [...plan.decisions.values()].filter((decision) => decision.requestedMode === 'skeleton' && decision.mode !== 'skeleton').length,
    hydratedNodes: contentOverrides.size,
    omissions: doc.omitted?.length ?? 0,
    tokensRequested: normalized.maxTokens,
    tokensDelivered: delivered,
    tokensSaved: Math.max(0, fullSourceTokens - delivered),
  };

  return {
    task: normalized.task,
    intent: normalized.intent,
    intentSource: normalized.intentSource,
    maxTokens: doc.maxTokens ?? normalized.maxTokens,
    seeds,
    evidence: expansion.evidence,
    context: {
      summary: doc.summary,
      logic: doc.logic,
      relation: doc.relation,
      focusCode: doc.focusCode,
      truncated: doc.truncated,
      blockTokens: doc.blockTokens,
      renderDecisions,
      omitted: doc.omitted ?? [],
    },
    certainty,
    coverage,
    boundaries,
    capabilities: {
      search: { actualMode: outcome.actualMode, vectorReady: outcome.vectorReady, fallbackReason: outcome.fallbackReason },
      rerank: GRAPH_RERANK_VERSION,
      alternateRef: 'unavailable',
      ...(normalized.explainRanking ? { skeletonLanguages: SKELETON_CAPABILITIES.filter((row) => row.enabled).map((row) => row.language).sort() } : {}),
      degraded,
    },
    counters,
    durationsMs: { search: searchMs, rerank: rerankMs, expand: expandMs, render: renderMs, build: buildMs, total: ms(clock, startedAt) },
    ...(normalized.explainRanking
      ? {
        ranking: seedCandidates.map((candidate) => ({
          symbol: candidate.name,
          baseRank: candidate.baseRank,
          rerankScore: candidate.rerankScore,
          top: topContributions(candidate, 3),
        })),
      }
      : {}),
  };
}
