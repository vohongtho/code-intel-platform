import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import type { CodeNode } from '../../shared/graph-types.js';
import { diffApiContracts, type KnownConsumer } from './compatibility.js';
import { matchApiContracts, type ApiMatchInstrumentation, type ScopedFact } from './matcher.js';
import type {
  ApiCompatibilityFinding,
  ApiContractMatch,
  ApiCoverage,
  HttpConsumerFact,
  HttpMethodOrAny,
  HttpRequestShapeFact,
  HttpResponseShapeFact,
  HttpRouteFact,
} from './types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const EMPTY_COVERAGE: ApiCoverage = { complete: false, boundaryReasons: ['analysis-truncated'] };

/**
 * Reconstructs an HttpRouteFact from a persisted `route` node's `metadata.apiContract` (set by
 * graph-projector.ts#projectHttpRouteFacts). A `route` node from a framework that does not yet
 * emit HttpRouteFact (e.g. spring/go-http) has no `apiContract` and is not queryable here — it
 * still exists for `routes`/blast-radius/group-sync, which never depended on this field.
 */
export function routeFactFromNode(node: CodeNode): HttpRouteFact | undefined {
  const apiContract = asRecord(asRecord(node.metadata)?.['apiContract']);
  if (!apiContract) return undefined;
  return {
    factId: (apiContract['factId'] as string | undefined) ?? node.id,
    language: apiContract['language'] as HttpRouteFact['language'],
    filePath: node.filePath,
    sourceRange: { filePath: node.filePath, startLine: node.startLine ?? 0, startColumn: 0, endLine: node.endLine ?? node.startLine ?? 0, endColumn: 0 },
    routeFactKind: 'http-route',
    method: apiContract['method'] as HttpMethodOrAny,
    path: (apiContract['path'] as string | undefined) ?? node.name,
    normalizedPath: apiContract['normalizedPath'] as string,
    handlerRef: undefined,
    middlewareRefs: (apiContract['middlewareRefs'] as string[] | undefined) ?? [],
    authEvidence: apiContract['authEvidence'] as string[] | undefined,
    requestShapeRef: apiContract['requestShapeRef'] as string | undefined,
    responses: (apiContract['responses'] as HttpRouteFact['responses'] | undefined) ?? [],
    framework: (apiContract['framework'] as string | undefined) ?? '',
    coverage: (apiContract['coverage'] as ApiCoverage | undefined) ?? EMPTY_COVERAGE,
  };
}

export function consumerFactFromNode(node: CodeNode): HttpConsumerFact | undefined {
  const semantic = asRecord(asRecord(node.metadata)?.['semantic']);
  if (!semantic || semantic['clientLibrary'] === undefined) return undefined;
  return {
    factId: (semantic['factId'] as string | undefined) ?? node.id,
    language: semantic['language'] as HttpConsumerFact['language'],
    filePath: node.filePath,
    sourceRange: { filePath: node.filePath, startLine: node.startLine ?? 0, startColumn: 0, endLine: node.endLine ?? node.startLine ?? 0, endColumn: 0 },
    consumerFactKind: 'http-consumer',
    clientLibrary: semantic['clientLibrary'] as HttpConsumerFact['clientLibrary'],
    method: semantic['method'] as HttpMethodOrAny | undefined,
    url: semantic['url'] as HttpConsumerFact['url'],
    requestShapeRef: semantic['requestShapeRef'] as string | undefined,
    consumedKeys: (semantic['consumedKeys'] as string[] | undefined) ?? [],
    expectedResponseShapeSymbolRef: semantic['expectedResponseShapeSymbolRef'] as string | undefined,
    coverage: (semantic['coverage'] as ApiCoverage | undefined) ?? EMPTY_COVERAGE,
  };
}

export function shapeFactFromNode(node: CodeNode): HttpRequestShapeFact | HttpResponseShapeFact | undefined {
  const semantic = asRecord(asRecord(node.metadata)?.['semantic']);
  const shapeFactKind = semantic?.['shapeFactKind'];
  if (shapeFactKind !== 'http-request-shape' && shapeFactKind !== 'http-response-shape') return undefined;
  const base = {
    factId: (semantic!['factId'] as string | undefined) ?? node.id,
    language: semantic!['language'] as HttpRequestShapeFact['language'],
    filePath: node.filePath,
    sourceRange: { filePath: node.filePath, startLine: node.startLine ?? 0, startColumn: 0, endLine: node.endLine ?? node.startLine ?? 0, endColumn: 0 },
    shapeFingerprint: (semantic!['shapeFingerprint'] as string | undefined) ?? '',
    origin: semantic!['origin'] as HttpRequestShapeFact['origin'],
    coverage: (semantic!['coverage'] as ApiCoverage | undefined) ?? EMPTY_COVERAGE,
  };
  return shapeFactKind === 'http-request-shape'
    ? { ...base, shapeFactKind: 'http-request-shape' }
    : { ...base, shapeFactKind: 'http-response-shape', status: semantic!['status'] as number | 'default' | undefined };
}

export interface GraphFacts {
  routes: HttpRouteFact[];
  consumers: HttpConsumerFact[];
  shapesByFingerprint: Map<string, HttpRequestShapeFact | HttpResponseShapeFact>;
  /** Graph node id for each route's factId — lets a caller that only has the node id (e.g. the
   * web UI, which opens a detail view from a clicked graph node) select by it directly. */
  routeNodeIdByFactId: Map<string, string>;
  /** Handler symbol name for each route's factId, resolved via the route node's existing
   * `handles` edge (the same edge `routes`/blast-radius already rely on) rather than persisting
   * a second copy of the handler reference in `metadata.apiContract`. */
  handlerNameByFactId: Map<string, string>;
}

/** Single pass over the graph reconstructing every API-contract fact it holds. */
export function collectGraphFacts(graph: KnowledgeGraph): GraphFacts {
  const routes: HttpRouteFact[] = [];
  const consumers: HttpConsumerFact[] = [];
  const shapesByFingerprint = new Map<string, HttpRequestShapeFact | HttpResponseShapeFact>();
  const routeNodeIdByFactId = new Map<string, string>();
  const handlerNameByFactId = new Map<string, string>();

  for (const node of graph.allNodes()) {
    if (node.kind === 'route') {
      const route = routeFactFromNode(node);
      if (!route) continue;
      routes.push(route);
      routeNodeIdByFactId.set(route.factId, node.id);
      for (const edge of graph.findEdgesFrom(node.id)) {
        if (edge.kind !== 'handles') continue;
        const handlerName = graph.getNode(edge.target)?.name;
        if (handlerName) handlerNameByFactId.set(route.factId, handlerName);
        break;
      }
    } else if (node.kind === 'api_consumer') {
      const consumer = consumerFactFromNode(node);
      if (consumer) consumers.push(consumer);
    } else if (node.kind === 'api_shape') {
      const shape = shapeFactFromNode(node);
      if (shape) shapesByFingerprint.set(shape.shapeFingerprint, shape);
    }
  }

  return { routes, consumers, shapesByFingerprint, routeNodeIdByFactId, handlerNameByFactId };
}

export interface RouteSelector {
  routeFactId?: string;
  /** The route's graph node id — the natural selector for a caller (e.g. the web UI) that only
   * has the node the user clicked on, not its underlying HttpRouteFact factId. */
  routeNodeId?: string;
  method?: string;
  normalizedPath?: string;
}

export function selectRoutes(facts: Pick<GraphFacts, 'routes' | 'routeNodeIdByFactId'>, selector: RouteSelector): HttpRouteFact[] {
  return facts.routes.filter((route) => {
    if (selector.routeFactId && route.factId !== selector.routeFactId) return false;
    if (selector.routeNodeId && facts.routeNodeIdByFactId.get(route.factId) !== selector.routeNodeId) return false;
    if (selector.method && route.method !== selector.method.toUpperCase() && route.method !== 'ANY') return false;
    if (selector.normalizedPath && route.normalizedPath !== selector.normalizedPath) return false;
    return true;
  });
}

export interface ResolvedShapeView {
  origin: HttpRequestShapeFact['origin'];
  coverage: ApiCoverage;
}

export interface RouteContractView {
  factId: string;
  method: HttpMethodOrAny;
  path: string;
  normalizedPath: string;
  filePath: string;
  startLine?: number;
  framework: string;
  handlerName?: string;
  middlewareRefs: readonly string[];
  authEvidence?: readonly string[];
  requestShape?: ResolvedShapeView;
  responses: ReadonlyArray<{ status?: number | 'default'; shape?: ResolvedShapeView; evidence: string }>;
  coverage: ApiCoverage;
}

function resolveShapeView(ref: string | undefined, shapes: ReadonlyMap<string, HttpRequestShapeFact | HttpResponseShapeFact>): ResolvedShapeView | undefined {
  if (!ref) return undefined;
  const shape = shapes.get(ref);
  return shape ? { origin: shape.origin, coverage: shape.coverage } : undefined;
}

export function buildRouteContractView(
  route: HttpRouteFact,
  shapes: ReadonlyMap<string, HttpRequestShapeFact | HttpResponseShapeFact>,
  handlerName?: string,
): RouteContractView {
  return {
    factId: route.factId,
    method: route.method,
    path: route.path,
    normalizedPath: route.normalizedPath,
    filePath: route.filePath,
    startLine: route.sourceRange.startLine,
    framework: route.framework,
    handlerName,
    middlewareRefs: route.middlewareRefs,
    authEvidence: route.authEvidence,
    requestShape: resolveShapeView(route.requestShapeRef, shapes),
    responses: route.responses.map((variant) => ({
      status: variant.status,
      shape: resolveShapeView(variant.responseShapeRef, shapes),
      evidence: variant.evidence,
    })),
    coverage: route.coverage,
  };
}

export interface ConsumerMatchView {
  consumerFactId: string;
  filePath: string;
  startLine?: number;
  clientLibrary: HttpConsumerFact['clientLibrary'];
  consumedKeys: readonly string[];
  match: ApiContractMatch;
}

/** repoId is a caller-controlled scope label (e.g. repo name); a single-repo caller may pass
 * any constant string consistently for both routes and consumers. */
export function matchConsumersToRoutes(
  routes: readonly HttpRouteFact[],
  consumers: readonly HttpConsumerFact[],
  repoId: string,
  candidateCap?: number,
  instrumentation?: ApiMatchInstrumentation,
): ApiContractMatch[] {
  const scopedRoutes: ScopedFact<HttpRouteFact>[] = routes.map((fact) => ({ repoId, fact }));
  const scopedConsumers: ScopedFact<HttpConsumerFact>[] = consumers.map((fact) => ({ repoId, fact }));
  return instrumentation
    ? matchApiContracts(scopedRoutes, scopedConsumers, { candidateCap }, instrumentation)
    : matchApiContracts(scopedRoutes, scopedConsumers, { candidateCap });
}

function toConsumerMatchView(match: ApiContractMatch, consumerByFactId: ReadonlyMap<string, HttpConsumerFact>): ConsumerMatchView {
  const consumer = consumerByFactId.get(match.referenceId);
  return {
    consumerFactId: match.referenceId,
    filePath: consumer?.filePath ?? 'unknown',
    startLine: consumer?.sourceRange.startLine,
    clientLibrary: consumer?.clientLibrary ?? 'fetch',
    consumedKeys: consumer?.consumedKeys ?? [],
    match,
  };
}

export interface ApiContractResult {
  route: RouteContractView;
  consumers: ConsumerMatchView[];
  /**
   * True only when every match considered for this route's consumers had complete coverage
   * (no candidate-cap truncation) — an empty `consumers` array alongside `true` here means
   * "proven no consumer", while `false` means "no known consumer" (unresolved/truncated
   * matching), which must never be displayed the same way. See compatibility.ts's identical
   * `consumerCoverageComplete` doc comment for the same distinction on the drift path.
   */
  consumerCoverageComplete: boolean;
}

/** api_contract: full shape + known-consumer view for the route(s) matching `selector`. */
export function getApiContract(
  graph: KnowledgeGraph,
  selector: RouteSelector,
  repoId = 'local',
  instrumentation?: ApiMatchInstrumentation,
): ApiContractResult[] {
  const facts = collectGraphFacts(graph);
  const matched = selectRoutes(facts, selector);
  if (matched.length === 0) return [];

  const matches = matchConsumersToRoutes(facts.routes, facts.consumers, repoId, undefined, instrumentation);
  const consumerByFactId = new Map(facts.consumers.map((consumer) => [consumer.factId, consumer]));

  return matched.map((route) => {
    const relevantMatches = matches.filter((match) => match.candidates.some((candidate) => candidate.targetId === route.factId));
    const handlerName = facts.handlerNameByFactId.get(route.factId);
    return {
      route: buildRouteContractView(route, facts.shapesByFingerprint, handlerName),
      consumers: relevantMatches.map((match) => toConsumerMatchView(match, consumerByFactId)),
      consumerCoverageComplete: relevantMatches.every((match) => match.coverage.complete),
    };
  });
}

export interface ApiImpactResult {
  routes: RouteContractView[];
  consumers: ConsumerMatchView[];
  coverage: { totalRoutes: number; totalConsumers: number; consumerCoverageComplete: boolean };
}

/** api_impact: routes matching `selector` plus every consumer resolved (exactly or as a
 * candidate) to any of them — the blast radius of changing those routes. */
export function getApiImpact(
  graph: KnowledgeGraph,
  selector: RouteSelector,
  repoId = 'local',
  instrumentation?: ApiMatchInstrumentation,
): ApiImpactResult {
  const facts = collectGraphFacts(graph);
  const matched = selectRoutes(facts, selector);
  const matchedIds = new Set(matched.map((route) => route.factId));

  const matches = matchConsumersToRoutes(facts.routes, facts.consumers, repoId, undefined, instrumentation);
  const consumerByFactId = new Map(facts.consumers.map((consumer) => [consumer.factId, consumer]));
  const relevantMatches = matches.filter((match) => match.candidates.some((candidate) => matchedIds.has(candidate.targetId)));

  return {
    routes: matched.map((route) => buildRouteContractView(route, facts.shapesByFingerprint, facts.handlerNameByFactId.get(route.factId))),
    consumers: relevantMatches.map((match) => toConsumerMatchView(match, consumerByFactId)),
    coverage: {
      totalRoutes: facts.routes.length,
      totalConsumers: facts.consumers.length,
      consumerCoverageComplete: relevantMatches.every((match) => match.coverage.complete),
    },
  };
}

export interface ApiDriftResult {
  findings: ApiCompatibilityFinding[];
  coverage: { baseRoutes: number; headRoutes: number; consumerCoverageComplete: boolean };
}

/**
 * api_drift: compares every route present in `baseGraph` and/or `headGraph`. Consumer usage is
 * drawn from `headGraph` (what would actually break going forward) and matched with the same
 * matcher used elsewhere, so `consumerCoverageComplete` is only true when that match ran
 * without truncation across the full route/consumer set passed in.
 */
export function getApiDrift(
  baseGraph: KnowledgeGraph,
  headGraph: KnowledgeGraph,
  repoId = 'local',
  instrumentation?: ApiMatchInstrumentation,
): ApiDriftResult {
  const base = collectGraphFacts(baseGraph);
  const head = collectGraphFacts(headGraph);
  const shapesByFingerprint = new Map([...base.shapesByFingerprint, ...head.shapesByFingerprint]);

  const matches = matchConsumersToRoutes(head.routes, head.consumers, repoId, undefined, instrumentation);
  const consumersByRouteFactId = new Map<string, KnownConsumer[]>();
  for (const match of matches) {
    const consumer = head.consumers.find((c) => c.factId === match.referenceId);
    if (!consumer) continue;
    for (const candidate of match.candidates) {
      const list = consumersByRouteFactId.get(candidate.targetId) ?? [];
      list.push({ factId: consumer.factId, consumedKeys: consumer.consumedKeys });
      consumersByRouteFactId.set(candidate.targetId, list);
    }
  }
  const consumerCoverageComplete = matches.every((match) => match.coverage.complete);

  const findings = diffApiContracts({
    baseRoutes: base.routes,
    headRoutes: head.routes,
    shapesByFingerprint,
    consumersByRouteFactId,
    consumerCoverageComplete,
  });

  return { findings, coverage: { baseRoutes: base.routes.length, headRoutes: head.routes.length, consumerCoverageComplete } };
}
