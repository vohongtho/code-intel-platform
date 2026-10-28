/**
 * session-service.ts
 *
 * Change-workflow session orchestration: `start`, `status`, `checkpoint`,
 * `verify`, `complete`. One transport-independent service that the MCP
 * `change_workflow` tool and the `code-intel workflow` CLI both call.
 *
 * Planning composes existing owners only — adaptive Explore (falling back to
 * lexical search), graph impact, API contracts, stable flows, test selection
 * and group contract consumers — into `required` (exact) / `candidate`
 * (heuristic or ambiguous) / `optional` / `blocked` plan steps. Missing
 * optional capabilities are recorded with the guarantee they cost; they
 * never block a session that lower-level evidence can still serve.
 *
 * The service never edits source and never mutates Git: the external
 * user/agent edits files, runs `code-intel analyze`, then calls `verify`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import type { AnalysisCertainty, CodeNode } from '../../shared/index.js';
import { FLOW_IDENTITY_VERSION } from '../../flow-detection/identity.js';
import { loadGroup, loadSyncResult } from '../../multi-repo/group-registry.js';
import type { GroupSyncResult, RepoGroup } from '../../multi-repo/types.js';
import { runExplore } from '../../query/explore.js';
import { selectTestsForImpact } from '../../query/test-selection.js';
import { routeFactFromNode } from '../../semantic/api-contracts/service.js';
import { textSearch } from '../../search/text-search.js';
import { findRepoById } from '../../storage/repo-registry.js';
import type { NormalizedGraph } from '../../snapshots/normalizer.js';
import { captureBaseline, normalizeCurrentGraph, type WorkflowBaselinePayload } from './baseline.js';
import { buildCommitPlan } from './commit-plan.js';
import { conditionId, isPositionOnlyDelta, type ConsumerObservation } from './conditions.js';
import { assessIndexReadiness, defaultRepoRuntime, type WorkflowRepoRuntime } from './repo-runtime.js';
import {
  createSessionStore,
  newSessionId,
  resolveGroupSessionRoot,
  resolveRepoSessionRoot,
  SESSION_ID_PATTERN,
  WorkflowSessionError,
  type SessionStore,
} from './session-store.js';
import {
  canTransition,
  CHANGE_WORKFLOW_SCHEMA_VERSION,
  EXPECTED_CONDITION_KINDS,
  REVIEW_LENS_IDS,
  type ChangeWorkflowCapabilities,
  type ChangeWorkflowPhase,
  type ChangeWorkflowSession,
  type CheckpointKind,
  type ExpectedSemanticCondition,
  type ExpectedSemanticConditionInput,
  type GroupBaseline,
  type PlannedTestEvidence,
  type RepositoryBaseline,
  type RepositoryFreshness,
  type ReviewLensId,
  type TaskRetention,
  type UnavailableWorkflowCapability,
  type UnexpectedChange,
  type WorkflowBoundary,
  type WorkflowCapabilityId,
  type WorkflowPlan,
  type WorkflowPlanCategory,
  type WorkflowPlanStep,
  type WorkflowScope,
  type WorkflowTargetRef,
} from './session-types.js';
import { assessRepository, computeVerification, type GroupVerificationContext } from './verification.js';
import { getGroupSystemFlows, systemFlowsTouching } from '../../multi-repo/system-flows/service.js';
import type { StitchResult } from '../../multi-repo/system-flows/types.js';
import { recordWorkflowTransition, recordWorkflowVerification } from './telemetry.js';

export const PLANNING_LIMITS = Object.freeze({
  maxTaskChars: 4000,
  taskSummaryChars: 280,
  maxUserTargets: 20,
  discoveredSeeds: 5,
  maxCallersPerTarget: 20,
  maxConsumerRefs: 50,
  maxTestsPerPlan: 25,
});

const SYMBOL_KINDS = new Set(['function', 'method', 'class', 'interface', 'type_alias', 'constant', 'enum', 'struct', 'trait', 'variable', 'property', 'route', 'module']);

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface WorkflowGroupRuntime {
  loadGroup(name: string): RepoGroup | null;
  loadSyncResult(name: string): GroupSyncResult | null;
  resolveRepoPath(repositoryId: string, registryName: string): { id: string; name: string; path: string } | null;
}

export const defaultGroupRuntime: WorkflowGroupRuntime = {
  loadGroup,
  loadSyncResult,
  resolveRepoPath(repositoryId, registryName) {
    const repo = findRepoById(repositoryId);
    return repo ? { id: repo.id, name: repo.name ?? registryName, path: repo.path } : null;
  },
};

export type DiscoverTargets = (input: { graph: KnowledgeGraph; repoDir: string; repoName: string; task: string; limit: number }) => Promise<{ nodeIds: string[]; via: 'explore' | 'search'; fallbackReason?: string }>;

export interface ChangeWorkflowServiceDeps {
  runtime?: WorkflowRepoRuntime;
  groups?: WorkflowGroupRuntime;
  now?: () => Date;
  newId?: () => string;
  homeDir?: string;
  discover?: DiscoverTargets;
  /**
   * Group system flows (stitched over members' published indexes). Defaults to the cached
   * `getGroupSystemFlows`; pass `null` to disable. Returns null when unavailable.
   */
  systemFlows?: ((groupName: string) => Promise<StitchResult | null>) | null;
}

interface ResolvedDeps {
  runtime: WorkflowRepoRuntime;
  groups: WorkflowGroupRuntime;
  now: () => Date;
  newId: () => string;
  homeDir: string;
  discover: DiscoverTargets;
  systemFlows: ((groupName: string) => Promise<StitchResult | null>) | null;
}

/** Adaptive Explore first; lexical search when Explore is unavailable or yields nothing. */
export const defaultDiscoverTargets: DiscoverTargets = async ({ graph, repoDir, repoName, task, limit }) => {
  let fallbackReason: string | undefined;
  try {
    const result = await runExplore(
      { task, intent: 'change', explainRanking: true, seeds: Math.min(8, Math.max(1, limit)), maxTokens: 512 },
      {
        graph,
        search: async (query, searchLimit) => ({
          hits: textSearch(graph, query, searchLimit).map((hit) => ({ nodeId: hit.nodeId, name: hit.name, kind: hit.kind, filePath: hit.filePath, score: hit.score })),
          actualMode: 'bm25',
          vectorReady: false,
        }),
        repoDir,
        repoName,
      },
    );
    const nodeIds = result.seeds.map((seed) => seed.nodeId).filter((id): id is string => Boolean(id));
    if (nodeIds.length > 0) return { nodeIds: nodeIds.slice(0, limit), via: 'explore' };
    fallbackReason = 'explore returned no seeds';
  } catch (err) {
    fallbackReason = `explore unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { nodeIds: textSearch(graph, task, limit).map((hit) => hit.nodeId), via: 'search', fallbackReason };
};

async function defaultSystemFlows(groupName: string): Promise<StitchResult | null> {
  try {
    return (await getGroupSystemFlows(groupName, { allowCache: true })).result;
  } catch {
    return null;
  }
}

function resolveDeps(deps: ChangeWorkflowServiceDeps): ResolvedDeps {
  return {
    runtime: deps.runtime ?? defaultRepoRuntime,
    groups: deps.groups ?? defaultGroupRuntime,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? newSessionId,
    homeDir: deps.homeDir ?? os.homedir(),
    discover: deps.discover ?? defaultDiscoverTargets,
    systemFlows: deps.systemFlows === undefined ? defaultSystemFlows : deps.systemFlows,
  };
}

// ─── Requests ────────────────────────────────────────────────────────────────

export type StartScope = { type: 'repo'; repoDir: string } | { type: 'group'; groupName: string };

export interface StartWorkflowRequest {
  task: string;
  scope: StartScope;
  /** Symbol names or canonical node IDs the user/agent already knows must change. */
  targets?: string[];
  taskRetention?: TaskRetention;
  /** Authenticated creator (multi-user transports). */
  owner?: { userId: string; username: string };
}

export interface SessionLocator {
  sessionId: string;
  /** Repository the session belongs to (repo scope). */
  repoDir?: string;
  /** Group the session belongs to (group scope). */
  groupName?: string;
  /** Only look in the explicitly given repo/group stores. */
  strict?: boolean;
}

export interface CheckpointRequest extends SessionLocator {
  expectedRevision?: number;
  note?: string;
  /** Add expected conditions to an existing step (or a new user step when `stepId` is omitted). */
  conditions?: Array<Record<string, unknown>>;
  /** Remove expected conditions (by ID) from every step — e.g. to restate a target after a signature change. */
  removeConditionIds?: string[];
  stepId?: string;
  /** Additional review lenses for the step (or every step when `stepId` is omitted). */
  lenses?: string[];
  /** The external edit happened; move to `reindex-required`. */
  edited?: boolean;
}

export interface VerifyRequest extends SessionLocator {
  expectedRevision?: number;
}

export interface CompleteRequest extends SessionLocator {
  expectedRevision?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normalizeTask(task: string): string {
  return task.replace(/\s+/g, ' ').trim();
}

function stepId(category: WorkflowPlanCategory, title: string, targets: readonly WorkflowTargetRef[]): string {
  return `step-${sha256(JSON.stringify([category, title, targets.map((t) => `${t.repositoryId}\u0000${t.id}`).sort()])).slice(0, 12)}`;
}

function withId(condition: ExpectedSemanticConditionInput): ExpectedSemanticCondition {
  return { ...condition, id: conditionId(condition) } as ExpectedSemanticCondition;
}

function targetFromNode(node: CodeNode, repositoryId: string, certainty: AnalysisCertainty, source: WorkflowTargetRef['source']): WorkflowTargetRef {
  return {
    kind: 'symbol',
    id: node.id,
    repositoryId,
    name: node.name,
    filePath: node.filePath,
    nodeKind: node.kind,
    certainty,
    source,
  };
}

const CATEGORY_ORDER: Record<WorkflowPlanCategory, number> = { required: 0, candidate: 1, optional: 2, blocked: 3 };

function sortSteps(steps: WorkflowPlanStep[]): WorkflowPlanStep[] {
  return steps.sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
    || a.repositories.join(',').localeCompare(b.repositories.join(','))
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id));
}

function makeStep(input: Omit<WorkflowPlanStep, 'id' | 'dependsOn' | 'boundaries' | 'tests' | 'reviewLenses'> & Partial<Pick<WorkflowPlanStep, 'dependsOn' | 'boundaries' | 'tests' | 'reviewLenses'>>): WorkflowPlanStep {
  return {
    id: stepId(input.category, input.title, input.targets),
    dependsOn: [],
    boundaries: [],
    tests: [],
    reviewLenses: [],
    ...input,
    expected: [...input.expected].sort((a, b) => a.id.localeCompare(b.id)),
    targets: [...input.targets].sort((a, b) => a.repositoryId.localeCompare(b.repositoryId) || a.id.localeCompare(b.id)),
  };
}

// ─── Per-repository planning ─────────────────────────────────────────────────

interface RepoPlanInput {
  repositoryId: string;
  repositoryName: string;
  repoDir: string;
  graph: KnowledgeGraph;
  normalized: NormalizedGraph;
  task: string;
  userTargets: string[];
  stableFlows: boolean;
  deps: ResolvedDeps;
}

interface RepoPlanOutput {
  steps: WorkflowPlanStep[];
  boundaries: WorkflowBoundary[];
  targets: WorkflowTargetRef[];
  requiredNodeIds: string[];
  discoveryVia: 'explore' | 'search';
  discoveryFallbackReason?: string;
}

function resolveUserTarget(graph: KnowledgeGraph, spec: string): CodeNode[] {
  const direct = graph.getNode(spec);
  if (direct) return [direct];
  const matches: CodeNode[] = [];
  for (const node of graph.allNodes()) {
    if (node.name === spec && SYMBOL_KINDS.has(node.kind)) matches.push(node);
  }
  return matches.sort((a, b) => a.id.localeCompare(b.id));
}

function flowsContaining(graph: KnowledgeGraph, node: CodeNode): string[] {
  const canonical = node.identityId ?? node.id;
  const flowIds: string[] = [];
  for (const candidate of graph.allNodes()) {
    if (candidate.kind !== 'flow') continue;
    const steps = candidate.metadata?.['stepCanonicalIds'];
    if (Array.isArray(steps) && steps.includes(canonical)) flowIds.push(candidate.id);
  }
  return flowIds.sort();
}

function exactCallers(graph: KnowledgeGraph, nodeId: string): Array<{ node: CodeNode; certainty: AnalysisCertainty }> {
  const out = new Map<string, { node: CodeNode; certainty: AnalysisCertainty }>();
  for (const edge of graph.findEdgesTo(nodeId)) {
    if (edge.kind !== 'calls') continue;
    const caller = graph.getNode(edge.source);
    if (!caller) continue;
    const certainty: AnalysisCertainty = edge.certainty === undefined || edge.certainty === 'exact' ? 'exact' : 'heuristic';
    const prior = out.get(caller.id);
    if (!prior || (prior.certainty !== 'exact' && certainty === 'exact')) out.set(caller.id, { node: caller, certainty });
  }
  return [...out.values()].sort((a, b) => a.node.id.localeCompare(b.node.id));
}

async function planRepository(input: RepoPlanInput): Promise<RepoPlanOutput> {
  const { graph, repositoryId } = input;
  const steps: WorkflowPlanStep[] = [];
  const boundaries: WorkflowBoundary[] = [];
  const targets: WorkflowTargetRef[] = [];
  const requiredNodes: CodeNode[] = [];

  // 1. User-named targets: a unique resolution is exact evidence -> required.
  for (const spec of input.userTargets) {
    const matches = resolveUserTarget(graph, spec);
    if (matches.length === 1) {
      requiredNodes.push(matches[0]!);
    } else if (matches.length > 1) {
      const candidates = matches.slice(0, 5).map((node) => targetFromNode(node, repositoryId, 'heuristic', 'user'));
      targets.push(...candidates);
      boundaries.push({ kind: 'ambiguous-target', repositoryId, message: `target ${JSON.stringify(spec)} matches ${matches.length} symbols; pass a canonical node ID to make it exact` });
      steps.push(makeStep({
        title: `Disambiguate ${spec}`,
        category: 'candidate',
        repositories: [repositoryId],
        targets: candidates,
        expected: [],
        certainty: 'heuristic',
        boundaries: [{ kind: 'ambiguous-target', repositoryId, message: `${matches.length} symbols named ${spec}` }],
      }));
    } else {
      boundaries.push({ kind: 'unresolved-target', repositoryId, message: `target ${JSON.stringify(spec)} was not found in ${input.repositoryName}` });
    }
  }

  for (const node of requiredNodes.sort((a, b) => a.id.localeCompare(b.id))) {
    const target = targetFromNode(node, repositoryId, 'exact', 'user');
    targets.push(target);
    const expected: ExpectedSemanticCondition[] = [withId({ kind: 'node-modified', repositoryId, nodeId: node.id })];
    const lenses: ReviewLensId[] = ['change-risk', 'scope', 'tests'];
    const route = node.kind === 'route' ? routeFactFromNode(node) : undefined;
    if (route) {
      expected.push(withId({ kind: 'contract-compatible', repositoryId, contractId: route.factId }));
      lenses.push('api');
    }
    steps.push(makeStep({
      title: `Change ${node.name}`,
      category: 'required',
      repositories: [repositoryId],
      targets: [target],
      expected,
      certainty: 'exact',
      reviewLenses: lenses.sort(),
    }));

    const callers = exactCallers(graph, node.id);
    if (callers.length > 0) {
      const capped = callers.slice(0, PLANNING_LIMITS.maxCallersPerTarget);
      const callerTargets = capped.map(({ node: caller, certainty }) => targetFromNode(caller, repositoryId, certainty, 'impact'));
      targets.push(...callerTargets);
      steps.push(makeStep({
        title: `Check callers of ${node.name}`,
        category: 'candidate',
        repositories: [repositoryId],
        targets: callerTargets,
        expected: [],
        certainty: capped.every((c) => c.certainty === 'exact') && callers.length === capped.length ? 'exact' : 'lower-bound',
        reviewLenses: ['change-risk'],
        boundaries: callers.length > capped.length
          ? [{ kind: 'analysis-limit', repositoryId, message: `${callers.length - capped.length} more caller(s) omitted` }]
          : [],
      }));
    }

    if (input.stableFlows) {
      const flowIds = flowsContaining(graph, node);
      if (flowIds.length > 0) {
        steps.push(makeStep({
          title: `Confirm flows through ${node.name}`,
          category: 'candidate',
          repositories: [repositoryId],
          targets: flowIds.slice(0, 10).map((flowId) => ({ kind: 'flow' as const, id: flowId, repositoryId, certainty: 'exact' as const, source: 'flow' as const })),
          expected: flowIds.slice(0, 10).map((flowId) => withId({ kind: 'flow-preserved', repositoryId, flowId })),
          certainty: 'exact',
          reviewLenses: ['tests'],
        }));
      }
    }
  }

  // 2. Discovery: Explore (or lexical search) seeds are heuristic -> candidate.
  const discovery = await input.deps.discover({
    graph,
    repoDir: input.repoDir,
    repoName: input.repositoryName,
    task: input.task,
    limit: PLANNING_LIMITS.discoveredSeeds,
  });
  const requiredIds = new Set(requiredNodes.map((node) => node.id));
  const seen = new Set(targets.map((t) => t.id));
  for (const nodeId of discovery.nodeIds) {
    const node = graph.getNode(nodeId);
    if (!node || requiredIds.has(nodeId) || seen.has(nodeId)) continue;
    seen.add(nodeId);
    const target = targetFromNode(node, repositoryId, 'heuristic', discovery.via);
    targets.push(target);
    steps.push(makeStep({
      title: `Review ${node.name}`,
      category: 'candidate',
      repositories: [repositoryId],
      targets: [target],
      expected: [withId({ kind: 'node-modified', repositoryId, nodeId: node.id })],
      certainty: 'heuristic',
      reviewLenses: ['scope'],
    }));
  }

  // 3. Tests for required + discovered targets; guardrails for the repository.
  const testSubjects = [...requiredIds, ...targets.filter((t) => t.source === discovery.via).map((t) => t.id)];
  if (testSubjects.length > 0) {
    const selection = selectTestsForImpact(graph, testSubjects, { repoDir: input.repoDir });
    const tests: PlannedTestEvidence[] = selection.evidence.slice(0, PLANNING_LIMITS.maxTestsPerPlan)
      .map((evidence) => ({ testId: evidence.testId, filePath: evidence.filePath, kind: evidence.kind, certainty: evidence.certainty }));
    steps.push(makeStep({
      title: 'Cover changed behaviour with tests',
      category: 'optional',
      repositories: [repositoryId],
      targets: [],
      expected: [...requiredIds].sort().map((nodeId) => withId({ kind: 'test-evidence-present', repositoryId, nodeId })),
      tests,
      certainty: selection.coverage.complete ? 'exact' : 'lower-bound',
      reviewLenses: ['tests'],
      boundaries: selection.coverage.complete ? [] : [{ kind: 'coverage-incomplete', repositoryId, message: 'test selection coverage is incomplete; missing tests are not proven missing' }],
    }));
  }
  steps.push(makeStep({
    title: `Keep ${input.repositoryName} guardrails`,
    category: 'optional',
    repositories: [repositoryId],
    targets: [],
    expected: [
      withId({ kind: 'structural-rule-no-new-violation', repositoryId, rule: 'no-new-cycles' }),
      withId({ kind: 'security-no-new-finding', repositoryId, nodeIds: [] }),
    ],
    certainty: 'exact',
    reviewLenses: ['architecture', 'security'],
  }));

  return { steps, boundaries, targets, requiredNodeIds: [...requiredIds].sort(), discoveryVia: discovery.via, discoveryFallbackReason: discovery.fallbackReason };
}

// ─── Capabilities ────────────────────────────────────────────────────────────

const REDUCED_GUARANTEES: Record<WorkflowCapabilityId, string> = {
  explore: 'targets come from lexical search only, without graph-aware rerank or intent expansion',
  'stable-flows': 'flow preservation/changes are not verified; symbols and contracts still are',
  'api-contracts': 'HTTP contract compatibility is not verified',
  'test-intelligence': 'test evidence is not verified',
  pdg: 'impact is graph-level; statement-level PDG precision is not applied',
  'structural-review': 'new structural violations are not checked',
  'security-review': 'new security findings are not checked',
  'group-contracts': 'cross-repository consumers are not planned or verified',
  'system-flows': 'cross-repository system flows are not planned or verified',
  'ref-aware-views': 'verification compares against the pinned baseline and the current working index only, not arbitrary refs',
};

function capabilities(available: Iterable<WorkflowCapabilityId>, unavailable: Array<{ capability: WorkflowCapabilityId; reason: string }>): ChangeWorkflowCapabilities {
  const availableSet = new Set(available);
  const missing: UnavailableWorkflowCapability[] = unavailable
    .filter((entry) => !availableSet.has(entry.capability))
    .map((entry) => ({ ...entry, reducedGuarantee: REDUCED_GUARANTEES[entry.capability] }));
  const deduped = [...new Map(missing.map((entry) => [entry.capability, entry])).values()];
  return {
    available: [...availableSet].sort(),
    unavailable: deduped.sort((a, b) => a.capability.localeCompare(b.capability)),
  };
}

function capabilityBoundaries(caps: ChangeWorkflowCapabilities): WorkflowBoundary[] {
  return caps.unavailable.map((entry) => ({ kind: 'capability-unavailable', capability: entry.capability, message: `${entry.capability} unavailable (${entry.reason}): ${entry.reducedGuarantee}` }));
}

// ─── Stores ──────────────────────────────────────────────────────────────────

function storeForScope(scope: WorkflowScope, deps: ResolvedDeps): SessionStore {
  return scope.type === 'repo'
    ? createSessionStore(resolveRepoSessionRoot(scope.repoPath))
    : createSessionStore(resolveGroupSessionRoot(scope.groupName, deps.homeDir));
}

/**
 * Finds the store holding `sessionId`: the named group, the given repo, then
 * (unless `locator.strict`) every group root. Transports with a scope policy
 * (MCP) use `strict` so a session is only reachable through the repository
 * or group the caller explicitly selected.
 */
export function locateSession(locator: SessionLocator, deps: ChangeWorkflowServiceDeps = {}): { store: SessionStore; session: ChangeWorkflowSession } {
  const resolved = resolveDeps(deps);
  if (!SESSION_ID_PATTERN.test(locator.sessionId)) throw new WorkflowSessionError('INVALID_ID', 'Session IDs have the form wf_<32 hex chars>.');
  const candidates: SessionStore[] = [];
  if (locator.groupName) candidates.push(createSessionStore(resolveGroupSessionRoot(locator.groupName, resolved.homeDir)));
  if (locator.repoDir) candidates.push(createSessionStore(resolveRepoSessionRoot(locator.repoDir)));
  if (!locator.groupName && !locator.strict) {
    const groupsRoot = path.join(resolved.homeDir, '.code-intel', 'workflows', 'groups');
    try {
      for (const name of fs.readdirSync(groupsRoot).sort()) {
        try {
          candidates.push(createSessionStore(resolveGroupSessionRoot(name, resolved.homeDir)));
        } catch {
          // Not a valid group directory name.
        }
      }
    } catch {
      // No group sessions yet.
    }
  }
  for (const store of candidates) {
    try {
      return { store, session: store.read(locator.sessionId) };
    } catch (err) {
      if (err instanceof WorkflowSessionError && err.code === 'NOT_FOUND') continue;
      throw err;
    }
  }
  throw new WorkflowSessionError('NOT_FOUND', `workflow session ${locator.sessionId} not found`);
}

// ─── Baselines ───────────────────────────────────────────────────────────────

interface PreparedRepo {
  baseline: RepositoryBaseline;
  graph: KnowledgeGraph;
  normalized: NormalizedGraph;
  payload: WorkflowBaselinePayload;
}

async function prepareRepository(repo: { id: string; name: string; path: string }, deps: ResolvedDeps): Promise<PreparedRepo> {
  const readiness = assessIndexReadiness(repo.path, deps.runtime);
  if (!readiness.ready) {
    throw new WorkflowSessionError('INDEX_NOT_READY', `The index for ${repo.name} is not trusted and current; run \`code-intel analyze\` before starting a workflow so the baseline is pinned.`, {
      repository: repo.name,
      reasons: readiness.reasons,
    });
  }
  const { graph, generationId } = await deps.runtime.loadGraph(repo.path);
  const normalized = normalizeCurrentGraph(graph, repo.path);
  const payload = captureBaseline({ repositoryId: repo.id, generationId, graph, repoDir: repo.path, normalized });
  const metadata = readiness.trust.metadata;
  const baseline: RepositoryBaseline = {
    repositoryId: repo.id,
    repositoryName: repo.name,
    repoPath: path.resolve(repo.path),
    generationId: readiness.trust.generationId ?? generationId,
    indexVersion: metadata?.indexVersion,
    commit: deps.runtime.gitHead(repo.path),
    branch: deps.runtime.gitBranch(repo.path),
    dirty: deps.runtime.gitDirty(repo.path),
    analyzer: {
      schemaVersion: metadata?.schemaVersion,
      identityFingerprint: metadata?.identityFingerprint,
      resolverFingerprint: metadata?.resolverFingerprint,
      factSchemaFingerprint: metadata?.factSchemaFingerprint,
      apiContractFingerprint: metadata?.apiContractFingerprint,
      flowIdentityFingerprint: metadata?.compatibilityReceipt?.flowIdentityFingerprint,
    },
  };
  return { baseline, graph, normalized, payload };
}

function contextFingerprints(targets: readonly WorkflowTargetRef[], normalizedByRepo: ReadonlyMap<string, NormalizedGraph>): WorkflowPlan['contextFingerprints'] {
  const out: WorkflowPlan['contextFingerprints'] = [];
  for (const target of targets) {
    if (target.kind !== 'symbol') continue;
    const fingerprint = normalizedByRepo.get(target.repositoryId)?.nodesById.get(target.id)?.properties.contentFingerprint;
    if (fingerprint) out.push({ targetId: target.id, repositoryId: target.repositoryId, contentFingerprint: fingerprint });
  }
  return [...new Map(out.map((entry) => [`${entry.repositoryId}\u0000${entry.targetId}`, entry])).values()]
    .sort((a, b) => a.repositoryId.localeCompare(b.repositoryId) || a.targetId.localeCompare(b.targetId));
}

// ─── Group helpers ───────────────────────────────────────────────────────────

function membershipFingerprint(repositoryIds: readonly string[]): string {
  return sha256(JSON.stringify([...repositoryIds].sort()));
}

function consumerIndexFingerprint(sync: GroupSyncResult | null): string | undefined {
  return sync?.consumerIndex ? sha256(JSON.stringify(sync.consumerIndex)) : undefined;
}

function groupMemberRepositories(group: RepoGroup, deps: ResolvedDeps): Array<{ id: string; name: string; path: string }> {
  const members: Array<{ id: string; name: string; path: string }> = [];
  for (const member of group.members) {
    const repo = member.repoId ? deps.groups.resolveRepoPath(member.repoId, member.registryName) : null;
    if (!repo) throw new WorkflowSessionError('INVALID_REQUEST', `Group member ${member.registryName} has no registered repository; run \`code-intel analyze\` in it and re-add it to the group.`);
    members.push(repo);
  }
  return members.sort((a, b) => a.id.localeCompare(b.id));
}

/** Plans consumer-update steps for contracts whose provider symbol is a required/candidate target. */
function planConsumerSteps(sync: GroupSyncResult, targets: readonly WorkflowTargetRef[], repoNames: ReadonlyMap<string, string>): { steps: WorkflowPlanStep[]; boundaries: WorkflowBoundary[]; contractConsumers: NonNullable<GroupBaseline['contractConsumers']> } {
  const steps: WorkflowPlanStep[] = [];
  const boundaries: WorkflowBoundary[] = [];
  const contractConsumers: NonNullable<GroupBaseline['contractConsumers']> = [];
  const index = sync.consumerIndex;
  if (!index) return { steps, contractConsumers, boundaries: [{ kind: 'capability-unavailable', capability: 'group-contracts', message: 'group sync has no consumer index; run `code-intel group sync`' }] };
  const symbolTargets = targets.filter((target) => target.kind === 'symbol' && target.certainty === 'exact');
  for (const target of symbolTargets) {
    const contracts = sync.contracts.filter((contract) => contract.contractId
      && (contract.repositoryId ?? contract.repoName) === target.repositoryId
      && (contract.nodeId === target.id || contract.sourceCanonicalId === target.id));
    for (const contract of contracts) {
      const refs = index.byContractId[contract.contractId!] ?? [];
      const byRepo = new Map<string, typeof refs[number][]>();
      for (const ref of refs.slice(0, PLANNING_LIMITS.maxConsumerRefs)) {
        if (ref.repositoryId === target.repositoryId) continue;
        byRepo.set(ref.repositoryId, [...(byRepo.get(ref.repositoryId) ?? []), ref]);
      }
      if (byRepo.size > 0) {
        contractConsumers.push({
          contractId: contract.contractId!,
          routeFactId: contract.kind === 'route' ? contract.sourceCanonicalId : undefined,
          providerRepositoryId: target.repositoryId,
          consumers: [...byRepo.values()].flat().map((ref) => ({
            repositoryId: ref.repositoryId,
            consumerId: ref.consumerId,
            certainty: ref.certainty,
            consumedFields: [...(ref.consumedFields ?? [])].sort(),
          })).sort((a, b) => a.repositoryId.localeCompare(b.repositoryId) || a.consumerId.localeCompare(b.consumerId)),
        });
      }
      for (const [consumerRepo, consumerRefs] of [...byRepo.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const exact = consumerRefs.filter((ref) => ref.certainty === 'exact');
        const other = consumerRefs.filter((ref) => ref.certainty !== 'exact');
        const incomplete = consumerRefs.some((ref) => ref.coverage && !ref.coverage.complete) || refs.length > PLANNING_LIMITS.maxConsumerRefs;
        const stepBoundaries: WorkflowBoundary[] = [];
        if (incomplete) stepBoundaries.push({ kind: 'coverage-incomplete', repositoryId: consumerRepo, message: `consumer coverage for ${contract.name} is incomplete` });
        if (other.length > 0) stepBoundaries.push({ kind: 'ambiguous-target', repositoryId: consumerRepo, message: `${other.length} non-exact consumer(s) of ${contract.name} are candidates only` });
        const consumerTargets = consumerRefs.map((ref): WorkflowTargetRef => ({
          kind: 'symbol',
          id: ref.sourceCanonicalId ?? ref.consumerId,
          repositoryId: consumerRepo,
          name: ref.sourceAnchor,
          certainty: ref.certainty === 'legacy' ? 'heuristic' : ref.certainty,
          source: 'contract-consumer',
        }));
        steps.push(makeStep({
          title: `Update ${repoNames.get(consumerRepo) ?? consumerRepo} consumers of ${contract.name}`,
          category: 'candidate',
          repositories: [consumerRepo],
          targets: consumerTargets,
          expected: exact.length > 0
            ? [withId({ kind: 'consumer-updated', repositoryId: consumerRepo, contractId: contract.contractId!, consumerIds: exact.map((ref) => ref.consumerId).sort() })]
            : [],
          certainty: exact.length === consumerRefs.length && !incomplete ? 'exact' : 'lower-bound',
          reviewLenses: ['api', 'scope'],
          boundaries: stepBoundaries,
        }));
      }
    }
  }
  return { steps, boundaries, contractConsumers };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export interface WorkflowActionResult {
  session: ChangeWorkflowSession;
  repositories?: RepositoryFreshness[];
  next: string;
}

function nextAction(session: ChangeWorkflowSession): string {
  switch (session.phase) {
    case 'ready-for-change': return 'Edit the planned targets outside Code Intel, run `code-intel analyze`, then verify.';
    case 'reindex-required': return 'Run `code-intel analyze` in each changed repository (and `code-intel group sync` for groups), then verify.';
    case 'needs-revision': return session.latestVerification?.outcome === 'blocked'
      ? 'Verification is blocked (scope/compatibility changed). Resolve the boundary or start a new session; do not claim completion.'
      : 'Address failing/unknown conditions and unexpected changes, re-analyze, then verify again. Do not claim completion.';
    case 'review': return 'Review lens findings; call complete to record completion and get a suggested commit plan.';
    case 'complete': return 'Session complete. Commit plan is a suggestion only.';
    default: return 'Continue planning.';
  }
}

function transition(session: ChangeWorkflowSession, to: ChangeWorkflowPhase, at: string, kind: CheckpointKind, extras: { note?: string; outcome?: ChangeWorkflowSession['checkpoints'][number]['outcome'] } = {}): void {
  const from = session.phase;
  if (from !== to && !canTransition(from, to)) {
    throw new WorkflowSessionError('INVALID_TRANSITION', `cannot move a session from ${from} to ${to}`, { from, to });
  }
  if (from !== to) {
    session.phaseHistory.push({ phase: to, enteredAt: at });
    recordWorkflowTransition(from, to);
  }
  session.phase = to;
  session.updatedAt = at;
  session.checkpoints.push({
    id: `cp-${sha256(`${session.id}\u0000${session.revision + 1}\u0000${kind}`).slice(0, 12)}`,
    kind,
    createdAt: at,
    fromPhase: from,
    toPhase: to,
    revision: session.revision + 1,
    ...(extras.note ? { note: extras.note.slice(0, 500) } : {}),
    ...(extras.outcome ? { outcome: extras.outcome } : {}),
  });
}

function validateTask(task: unknown): string {
  if (typeof task !== 'string' || normalizeTask(task).length < 3) throw new WorkflowSessionError('INVALID_REQUEST', 'task must be a non-empty description (at least 3 characters).');
  const normalized = normalizeTask(task);
  if (normalized.length > PLANNING_LIMITS.maxTaskChars) throw new WorkflowSessionError('INVALID_REQUEST', `task must be at most ${PLANNING_LIMITS.maxTaskChars} characters.`);
  return normalized;
}

export async function startWorkflow(request: StartWorkflowRequest, deps: ChangeWorkflowServiceDeps = {}): Promise<WorkflowActionResult> {
  const resolved = resolveDeps(deps);
  const task = validateTask(request.task);
  const userTargets = (request.targets ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (userTargets.length > PLANNING_LIMITS.maxUserTargets) throw new WorkflowSessionError('INVALID_REQUEST', `at most ${PLANNING_LIMITS.maxUserTargets} targets may be named.`);
  const taskRetention: TaskRetention = request.taskRetention ?? 'summary';

  let scope: WorkflowScope;
  let repos: Array<{ id: string; name: string; path: string }>;
  let group: RepoGroup | null = null;
  let sync: GroupSyncResult | null = null;
  if (request.scope.type === 'repo') {
    const repoDir = path.resolve(request.scope.repoDir);
    const trust = resolved.runtime.verifyTrust(repoDir);
    const repositoryId = trust.metadata?.repoId ?? `path:${sha256(repoDir).slice(0, 16)}`;
    const repositoryName = path.basename(repoDir);
    scope = { type: 'repo', repositoryId, repositoryName, repoPath: repoDir };
    repos = [{ id: repositoryId, name: repositoryName, path: repoDir }];
  } else {
    group = resolved.groups.loadGroup(request.scope.groupName);
    if (!group) throw new WorkflowSessionError('INVALID_REQUEST', `Group ${JSON.stringify(request.scope.groupName)} not found.`);
    repos = groupMemberRepositories(group, resolved);
    if (repos.length === 0) throw new WorkflowSessionError('INVALID_REQUEST', `Group ${group.name} has no members.`);
    sync = resolved.groups.loadSyncResult(group.name);
    scope = { type: 'group', groupName: group.name, repositoryIds: repos.map((repo) => repo.id) };
  }

  const prepared: PreparedRepo[] = [];
  for (const repo of repos) prepared.push(await prepareRepository(repo, resolved));

  const steps: WorkflowPlanStep[] = [];
  const boundaries: WorkflowBoundary[] = [];
  const targets: WorkflowTargetRef[] = [];
  const available = new Set<WorkflowCapabilityId>(['api-contracts', 'test-intelligence', 'structural-review', 'security-review']);
  const unavailable: Array<{ capability: WorkflowCapabilityId; reason: string }> = [
    { capability: 'pdg', reason: 'workflow verification uses graph-level impact' },
    { capability: 'ref-aware-views', reason: 'verification uses the pinned baseline and the current published index' },
  ];
  for (const repo of prepared) {
    const stableFlows = repo.baseline.analyzer.flowIdentityFingerprint === FLOW_IDENTITY_VERSION;
    if (stableFlows) available.add('stable-flows');
    else unavailable.push({ capability: 'stable-flows', reason: `${repo.baseline.repositoryName} index lacks stable flow identity ${FLOW_IDENTITY_VERSION}` });
    const output = await planRepository({
      repositoryId: repo.baseline.repositoryId,
      repositoryName: repo.baseline.repositoryName,
      repoDir: repo.baseline.repoPath,
      graph: repo.graph,
      normalized: repo.normalized,
      task,
      userTargets,
      stableFlows,
      deps: resolved,
    });
    steps.push(...output.steps);
    boundaries.push(...output.boundaries);
    targets.push(...output.targets);
    if (output.discoveryVia === 'explore') available.add('explore');
    else unavailable.push({ capability: 'explore', reason: output.discoveryFallbackReason ?? 'explore unavailable' });
  }
  if (userTargets.length > 0 && scope.type === 'group') {
    // A name resolved in one member but not another is expected in a group; keep only targets unresolved everywhere.
    const resolvedSpecs = new Set(targets.filter((t) => t.source === 'user').flatMap((t) => [t.id, t.name]));
    for (let i = boundaries.length - 1; i >= 0; i -= 1) {
      const boundary = boundaries[i]!;
      if (boundary.kind !== 'unresolved-target') continue;
      const spec = /target "(.+)" was not found/.exec(boundary.message)?.[1];
      if (spec && resolvedSpecs.has(spec)) boundaries.splice(i, 1);
    }
  }

  let groupBaseline: GroupBaseline | undefined;
  if (scope.type === 'group' && group) {
    let contractConsumers: GroupBaseline['contractConsumers'];
    if (sync) {
      available.add('group-contracts');
      const names = new Map(prepared.map((repo) => [repo.baseline.repositoryId, repo.baseline.repositoryName]));
      const consumerPlan = planConsumerSteps(sync, targets, names);
      steps.push(...consumerPlan.steps);
      boundaries.push(...consumerPlan.boundaries);
      targets.push(...consumerPlan.steps.flatMap((step) => step.targets));
      contractConsumers = consumerPlan.contractConsumers;
    } else {
      unavailable.push({ capability: 'group-contracts', reason: `group ${group.name} has not been synced` });
    }
    let systemFlows: GroupBaseline['systemFlows'];
    if (resolved.systemFlows) {
      const stitched = await resolved.systemFlows(group.name);
      if (stitched) {
        available.add('system-flows');
        // Local flows reference canonical identity IDs; targets carry node IDs — match on both.
        const ids = new Set<string>();
        for (const target of targets) {
          ids.add(target.id);
          const node = prepared.find((repo) => repo.baseline.repositoryId === target.repositoryId)?.graph.getNode(target.id);
          if (node?.identityId) ids.add(node.identityId);
        }
        systemFlows = systemFlowsTouching(stitched, ids);
        if (!stitched.coverage.complete) boundaries.push({ kind: 'coverage-incomplete', capability: 'system-flows', message: `system-flow coverage is incomplete: ${stitched.coverage.incompleteReasons.slice(0, 3).join('; ')}` });
      } else {
        unavailable.push({ capability: 'system-flows', reason: 'system flows unavailable for this group' });
      }
    } else {
      unavailable.push({ capability: 'system-flows', reason: 'system-flow stitching was not requested' });
    }
    groupBaseline = {
      groupName: group.name,
      syncedAt: sync?.syncedAt,
      schemaVersion: sync?.schemaVersion,
      membershipFingerprint: membershipFingerprint(scope.repositoryIds),
      consumerIndexFingerprint: consumerIndexFingerprint(sync),
      ...(systemFlows ? { systemFlows } : {}),
      ...(contractConsumers && contractConsumers.length > 0 ? { contractConsumers } : {}),
    };
  }

  const caps = capabilities(available, unavailable);
  for (const step of steps) {
    if (step.expected.some((c) => c.kind === 'flow-preserved' || c.kind === 'flow-changed') && !caps.available.includes('stable-flows')) {
      step.boundaries.push({ kind: 'capability-unavailable', capability: 'stable-flows', message: REDUCED_GUARANTEES['stable-flows'] });
    }
  }
  const uniqueTargets = [...new Map(targets.map((t) => [`${t.repositoryId}\u0000${t.kind}\u0000${t.id}`, t])).values()]
    .sort((a, b) => a.repositoryId.localeCompare(b.repositoryId) || a.id.localeCompare(b.id));
  const plan: WorkflowPlan = {
    steps: sortSteps(steps),
    boundaries: [...boundaries, ...capabilityBoundaries(caps)],
    contextFingerprints: contextFingerprints(uniqueTargets, new Map(prepared.map((repo) => [repo.baseline.repositoryId, repo.normalized]))),
    truncated: boundaries.some((b) => b.kind === 'analysis-limit'),
  };

  const at = resolved.now().toISOString();
  const id = resolved.newId();
  const store = storeForScope(scope, resolved);
  store.prune(resolved.now());
  store.assertCapacity(request.owner?.userId);
  const baselines: RepositoryBaseline[] = [];
  for (const repo of prepared) {
    const written = store.writeBaseline(id, repo.baseline.repositoryId, repo.payload);
    baselines.push({
      ...repo.baseline,
      artifact: {
        sha256: written.sha256,
        sizeBytes: written.sizeBytes,
        nodeCount: repo.payload.nodes.length,
        edgeCount: repo.payload.edges.length,
        flowCount: repo.payload.flows.length,
      },
    });
  }

  const session: ChangeWorkflowSession = {
    schemaVersion: CHANGE_WORKFLOW_SCHEMA_VERSION,
    id,
    revision: 1,
    phase: 'ready-for-change',
    createdAt: at,
    updatedAt: at,
    scope,
    taskFingerprint: sha256(task),
    taskRetention,
    ...(taskRetention === 'summary' ? { taskSummary: task.slice(0, PLANNING_LIMITS.taskSummaryChars) } : {}),
    baselines,
    ...(groupBaseline ? { groupBaseline } : {}),
    selectedTargets: uniqueTargets,
    plan,
    checkpoints: [{ id: `cp-${sha256(`${id}\u00001\u0000start`).slice(0, 12)}`, kind: 'start', createdAt: at, fromPhase: 'discover', toPhase: 'ready-for-change', revision: 1 }],
    capabilities: caps,
    ...(request.owner ? { owner: { userId: request.owner.userId, username: request.owner.username } } : {}),
    phaseHistory: [
      { phase: 'discover', enteredAt: at },
      { phase: 'plan', enteredAt: at },
      { phase: 'ready-for-change', enteredAt: at },
    ],
  };
  recordWorkflowTransition('discover', 'plan');
  recordWorkflowTransition('plan', 'ready-for-change');
  store.create(session);
  store.prune(resolved.now());
  return { session, next: nextAction(session) };
}

function revisionFor(session: ChangeWorkflowSession, expected?: number): number {
  return expected ?? session.revision;
}

export async function workflowStatus(locator: SessionLocator, deps: ChangeWorkflowServiceDeps = {}): Promise<WorkflowActionResult> {
  const resolved = resolveDeps(deps);
  const { store, session } = locateSession(locator, deps);
  const repositories = session.baselines.map((baseline) => assessRepository(baseline, resolved.runtime).freshness);
  const editable: ChangeWorkflowPhase[] = ['ready-for-change', 'needs-revision', 'review'];
  if (editable.includes(session.phase) && repositories.some((repo) => repo.state === 'reindex-required')) {
    const updated = store.update(session.id, session.revision, (next) => {
      transition(next, 'reindex-required', resolved.now().toISOString(), 'status', { note: 'source changed since the index was published' });
      return next;
    });
    return { session: updated, repositories, next: nextAction(updated) };
  }
  return { session, repositories, next: nextAction(session) };
}

function parseCondition(raw: Record<string, unknown>, fallbackRepositoryId: string): ExpectedSemanticCondition {
  const kind = raw['kind'];
  if (typeof kind !== 'string' || !EXPECTED_CONDITION_KINDS.includes(kind as ExpectedSemanticCondition['kind'])) {
    throw new WorkflowSessionError('INVALID_REQUEST', `unknown condition kind ${JSON.stringify(kind)}; expected one of ${EXPECTED_CONDITION_KINDS.join(', ')}`);
  }
  const str = (field: string): string => {
    const value = raw[field];
    if (typeof value !== 'string' || value.length === 0 || value.length > 1024) throw new WorkflowSessionError('INVALID_REQUEST', `condition ${kind} requires a string '${field}'`);
    return value;
  };
  const strList = (field: string): string[] => {
    const value = raw[field] ?? [];
    if (!Array.isArray(value) || value.length > 200 || value.some((v) => typeof v !== 'string')) throw new WorkflowSessionError('INVALID_REQUEST', `condition ${kind} requires a string array '${field}'`);
    return [...value as string[]].sort();
  };
  const repositoryId = typeof raw['repositoryId'] === 'string' ? raw['repositoryId'] : fallbackRepositoryId;
  const description = typeof raw['description'] === 'string' ? raw['description'].slice(0, 280) : undefined;
  let condition: ExpectedSemanticConditionInput;
  switch (kind as ExpectedSemanticCondition['kind']) {
    case 'node-exists':
    case 'node-absent':
    case 'node-modified':
      condition = { kind: kind as 'node-exists', repositoryId, nodeId: str('nodeId') };
      break;
    case 'identity-change': {
      const change = raw['change'] ?? 'renamed-or-moved';
      if (change !== 'renamed' && change !== 'moved' && change !== 'renamed-or-moved') throw new WorkflowSessionError('INVALID_REQUEST', 'identity-change.change must be renamed, moved or renamed-or-moved');
      condition = { kind: 'identity-change', repositoryId, nodeId: str('nodeId'), change, ...(typeof raw['expectedHeadId'] === 'string' ? { expectedHeadId: raw['expectedHeadId'] } : {}) };
      break;
    }
    case 'relationship-exists':
    case 'relationship-absent':
      condition = { kind: kind as 'relationship-exists', repositoryId, sourceId: str('sourceId'), targetId: str('targetId'), edgeKind: str('edgeKind') as never };
      break;
    case 'contract-compatible':
    case 'contract-expected-breaking':
      condition = { kind: kind as 'contract-compatible', repositoryId, contractId: str('contractId') };
      break;
    case 'consumer-updated':
      condition = { kind: 'consumer-updated', repositoryId, contractId: str('contractId'), consumerIds: strList('consumerIds') };
      break;
    case 'flow-preserved':
    case 'flow-changed':
      condition = { kind: kind as 'flow-preserved', repositoryId, flowId: str('flowId') };
      break;
    case 'test-evidence-present': {
      const minimumKind = raw['minimumKind'];
      if (minimumKind !== undefined && minimumKind !== 'direct' && minimumKind !== 'affected-flow' && minimumKind !== 'transitive') {
        throw new WorkflowSessionError('INVALID_REQUEST', 'test-evidence-present.minimumKind must be direct, affected-flow or transitive');
      }
      condition = { kind: 'test-evidence-present', repositoryId, nodeId: str('nodeId'), ...(minimumKind ? { minimumKind } : {}) };
      break;
    }
    case 'structural-rule-no-new-violation':
      condition = { kind: 'structural-rule-no-new-violation', repositoryId, rule: 'no-new-cycles' };
      break;
    case 'security-no-new-finding':
      condition = { kind: 'security-no-new-finding', repositoryId, nodeIds: strList('nodeIds') };
      break;
  }
  return { ...withId(condition), ...(description ? { description } : {}) };
}

export async function workflowCheckpoint(request: CheckpointRequest, deps: ChangeWorkflowServiceDeps = {}): Promise<WorkflowActionResult> {
  const resolved = resolveDeps(deps);
  const { store, session } = locateSession(request, deps);
  if (session.phase === 'complete') throw new WorkflowSessionError('INVALID_TRANSITION', 'session is complete');
  const defaultRepo = session.baselines[0]?.repositoryId ?? '';
  const repositoryIds = new Set(session.baselines.map((baseline) => baseline.repositoryId));
  const conditions = (request.conditions ?? []).map((raw) => parseCondition(raw, defaultRepo));
  for (const condition of conditions) {
    if (!repositoryIds.has(condition.repositoryId)) throw new WorkflowSessionError('INVALID_REQUEST', `condition repositoryId ${condition.repositoryId} is not part of this session`);
  }
  const lenses = (request.lenses ?? []).map((lens) => {
    if (!REVIEW_LENS_IDS.includes(lens as ReviewLensId)) throw new WorkflowSessionError('INVALID_REQUEST', `unknown review lens ${JSON.stringify(lens)}`);
    return lens as ReviewLensId;
  });
  const updated = store.update(session.id, revisionFor(session, request.expectedRevision), (next) => {
    const at = resolved.now().toISOString();
    if (request.removeConditionIds?.length) {
      const remove = new Set(request.removeConditionIds);
      const known = new Set(next.plan.steps.flatMap((step) => step.expected.map((c) => c.id)));
      const unknown = [...remove].filter((id) => !known.has(id));
      if (unknown.length > 0) throw new WorkflowSessionError('INVALID_REQUEST', `unknown condition id(s): ${unknown.join(', ')}`);
      for (const step of next.plan.steps) step.expected = step.expected.filter((c) => !remove.has(c.id));
    }
    if (conditions.length > 0) {
      let step = request.stepId ? next.plan.steps.find((s) => s.id === request.stepId) : undefined;
      if (request.stepId && !step) throw new WorkflowSessionError('INVALID_REQUEST', `unknown plan step ${request.stepId}`);
      if (!step) {
        step = makeStep({
          title: 'User-declared expectations',
          category: 'required',
          repositories: [...new Set(conditions.map((c) => c.repositoryId))].sort(),
          targets: [],
          expected: [],
          certainty: 'exact',
          reviewLenses: ['scope'],
        });
        const existing = next.plan.steps.find((s) => s.id === step!.id);
        if (existing) step = existing;
        else next.plan.steps.push(step);
      }
      const byId = new Map(step.expected.map((c) => [c.id, c]));
      for (const condition of conditions) byId.set(condition.id, condition);
      step.expected = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
      for (const repo of conditions.map((c) => c.repositoryId)) if (!step.repositories.includes(repo)) step.repositories = [...step.repositories, repo].sort();
      next.plan.steps = sortSteps(next.plan.steps);
    }
    if (lenses.length > 0) {
      for (const step of next.plan.steps) {
        if (request.stepId && step.id !== request.stepId) continue;
        step.reviewLenses = [...new Set([...step.reviewLenses, ...lenses])].sort();
      }
    }
    const to: ChangeWorkflowPhase = request.edited && next.phase !== 'reindex-required' ? 'reindex-required' : next.phase;
    transition(next, to, at, 'checkpoint', { note: request.note });
    return next;
  });
  return { session: updated, next: nextAction(updated) };
}

function groupVerificationContext(session: ChangeWorkflowSession, deps: ResolvedDeps): GroupVerificationContext | undefined {
  if (session.scope.type !== 'group' || !session.groupBaseline) return undefined;
  const boundaries: WorkflowBoundary[] = [];
  const group = deps.groups.loadGroup(session.scope.groupName);
  const currentIds = group ? group.members.map((member) => member.repoId ?? member.registryName) : [];
  if (!group || membershipFingerprint(currentIds) !== session.groupBaseline.membershipFingerprint) {
    boundaries.push({ kind: 'group-membership-changed', message: `group ${session.scope.groupName} membership changed since the session started` });
  }
  const sync = deps.groups.loadSyncResult(session.scope.groupName);
  const newestIndex = session.baselines
    .map((baseline) => deps.runtime.verifyTrust(baseline.repoPath).metadata?.indexedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();
  const syncStale = !sync || (newestIndex !== undefined && sync.syncedAt < newestIndex);
  const hasConsumerConditions = session.plan.steps.some((step) => step.expected.some((c) => c.kind === 'consumer-updated'));
  if (syncStale && hasConsumerConditions) {
    boundaries.push({ kind: 'group-sync-stale', message: `group sync predates the latest analysis; run \`code-intel group sync ${session.scope.groupName}\`` });
  }
  // Only consumer-update steps carry consumer-coverage boundaries (other steps' boundaries are unrelated, e.g. tests).
  const incompleteRepos = new Set(session.plan.steps
    .filter((step) => step.expected.some((c) => c.kind === 'consumer-updated') && step.boundaries.some((b) => b.kind === 'coverage-incomplete'))
    .flatMap((step) => step.repositories));

  return {
    boundaries,
    contractConsumers: session.groupBaseline.contractConsumers,
    consumersFor(repositoryId, _headGraph, payload, nodes): ConsumerObservation | undefined {
      const consumerIds = session.plan.steps.flatMap((step) => step.expected)
        .filter((c): c is Extract<ExpectedSemanticCondition, { kind: 'consumer-updated' }> => c.kind === 'consumer-updated' && c.repositoryId === repositoryId)
        .flatMap((c) => c.consumerIds);
      if (consumerIds.length === 0) return undefined;
      const nodeIdsFor = (consumerId: string): string[] => {
        const ids = payload.apiNodes
          .filter((node) => node.id === consumerId || (node.metadata?.['semantic'] as Record<string, unknown> | undefined)?.['factId'] === consumerId)
          .map((node) => node.id);
        const contract = sync?.contracts.find((c) => c.contractId === consumerId);
        if (contract) ids.push(contract.nodeId);
        if (payload.nodes.some((node) => node.id === consumerId)) ids.push(consumerId);
        return [...new Set(ids)];
      };
      const states = new Map<string, 'updated' | 'unchanged' | 'unknown'>();
      for (const consumerId of consumerIds) {
        const ids = nodeIdsFor(consumerId);
        if (ids.length === 0) {
          states.set(consumerId, 'unknown');
          continue;
        }
        const touched = nodes.some((delta) => delta.baseId && ids.includes(delta.baseId) && !isPositionOnlyDelta(delta));
        states.set(consumerId, touched ? 'updated' : 'unchanged');
      }
      return { states, coverageComplete: !syncStale && !incompleteRepos.has(repositoryId) };
    },
  };
}

async function systemFlowDelta(session: ChangeWorkflowSession, deps: ResolvedDeps): Promise<{ unexpected: UnexpectedChange[]; changed: number } | undefined> {
  const baseline = session.groupBaseline?.systemFlows;
  if (!baseline || baseline.length === 0 || !deps.systemFlows || session.scope.type !== 'group') return undefined;
  const current = await deps.systemFlows(session.scope.groupName);
  if (!current) return undefined;
  const currentIds = new Set(current.flows.map((flow) => flow.id));
  const changed = baseline.filter((flow) => !currentIds.has(flow.id));
  const groupKey = `group:${session.scope.groupName}`;
  return {
    changed: changed.length,
    unexpected: changed.map((flow) => ({ repositoryId: groupKey, category: 'flow' as const, key: flow.id, change: 'system-flow-changed' })),
  };
}

export async function workflowVerify(request: VerifyRequest, deps: ChangeWorkflowServiceDeps = {}): Promise<WorkflowActionResult> {
  const resolved = resolveDeps(deps);
  const { store, session } = locateSession(request, deps);
  if (!canTransition(session.phase, 'verify')) {
    throw new WorkflowSessionError('INVALID_TRANSITION', `cannot verify a session in phase ${session.phase}`, { phase: session.phase });
  }
  const startedAt = Date.now();
  const group = groupVerificationContext(session, resolved);
  const flows = await systemFlowDelta(session, resolved);
  if (group && flows) {
    group.extraUnexpected = flows.unexpected;
    group.systemFlowsChanged = flows.changed;
  }
  const { result, phase } = await computeVerification(session, { store, runtime: resolved.runtime, now: resolved.now, group });
  recordWorkflowVerification(result.outcome, (Date.now() - startedAt) / 1000, result.counts);
  const updated = store.update(session.id, revisionFor(session, request.expectedRevision), (next) => {
    const at = result.verifiedAt;
    transition(next, 'verify', at, 'verify');
    next.checkpoints.pop();
    transition(next, phase, at, 'verify', { outcome: result.outcome });
    next.latestVerification = result;
    return next;
  });
  return { session: updated, repositories: result.repositories, next: nextAction(updated) };
}

export async function workflowComplete(request: CompleteRequest, deps: ChangeWorkflowServiceDeps = {}): Promise<WorkflowActionResult> {
  const resolved = resolveDeps(deps);
  const { store, session } = locateSession(request, deps);
  if (session.phase !== 'review' || session.latestVerification?.outcome !== 'passed') {
    throw new WorkflowSessionError('INVALID_TRANSITION', `only a verified session in review can complete (phase ${session.phase}, last outcome ${session.latestVerification?.outcome ?? 'none'})`);
  }
  // The verified index must still be the current one; otherwise verification is out of date.
  const verifiedGenerations = new Map(session.latestVerification.repositories.map((repo) => [repo.repositoryId, repo.generationId]));
  for (const baseline of session.baselines) {
    const freshness = assessRepository(baseline, resolved.runtime).freshness;
    if (freshness.state === 'reindex-required' || freshness.state === 'blocked' || freshness.generationId !== verifiedGenerations.get(baseline.repositoryId)) {
      throw new WorkflowSessionError('INVALID_TRANSITION', `${baseline.repositoryName} changed after verification; re-analyze and verify again before completing`);
    }
  }
  const updated = store.update(session.id, revisionFor(session, request.expectedRevision), (next) => {
    const at = resolved.now().toISOString();
    next.commitPlan = buildCommitPlan(next, at);
    transition(next, 'complete', at, 'complete');
    return next;
  });
  return { session: updated, next: nextAction(updated) };
}

export function listWorkflowSessions(scope: { repoDir?: string; groupName?: string }, deps: ChangeWorkflowServiceDeps = {}) {
  const resolved = resolveDeps(deps);
  if (scope.groupName) return createSessionStore(resolveGroupSessionRoot(scope.groupName, resolved.homeDir)).list();
  if (scope.repoDir) return createSessionStore(resolveRepoSessionRoot(scope.repoDir)).list();
  return [];
}

// ─── Compact views ───────────────────────────────────────────────────────────

/**
 * Bounded agent-facing projection: phase, plan step headlines, verification
 * summary and capability boundaries, with explicit truncation. Full session
 * JSON stays available to the CLI with `--json --full`.
 */
export function compactSessionView(result: WorkflowActionResult, options: { maxSteps?: number; maxConditions?: number } = {}) {
  const { session } = result;
  const maxSteps = options.maxSteps ?? 20;
  const maxConditions = options.maxConditions ?? 40;
  const verification = session.latestVerification;
  return {
    sessionId: session.id,
    revision: session.revision,
    phase: session.phase,
    scope: session.scope.type === 'repo'
      ? { type: 'repo', repositoryId: session.scope.repositoryId, repositoryName: session.scope.repositoryName }
      : { type: 'group', groupName: session.scope.groupName, repositoryIds: session.scope.repositoryIds },
    next: result.next,
    plan: {
      steps: session.plan.steps.slice(0, maxSteps).map((step) => ({
        id: step.id,
        title: step.title,
        category: step.category,
        certainty: step.certainty,
        repositories: step.repositories,
        targets: step.targets.slice(0, 10).map((t) => ({ kind: t.kind, id: t.id, name: t.name, filePath: t.filePath, certainty: t.certainty })),
        expected: step.expected.map((c) => ({ id: c.id, kind: c.kind })),
        tests: step.tests.length,
        reviewLenses: step.reviewLenses,
        boundaries: step.boundaries.map((b) => b.message),
      })),
      totalSteps: session.plan.steps.length,
      truncated: session.plan.truncated || session.plan.steps.length > maxSteps,
      boundaries: session.plan.boundaries.map((b) => `${b.kind}: ${b.message}`),
      contextFingerprints: session.plan.contextFingerprints.length,
    },
    capabilities: session.capabilities,
    ...(result.repositories ? { repositories: result.repositories } : {}),
    ...(verification ? {
      verification: {
        outcome: verification.outcome,
        verifiedAt: verification.verifiedAt,
        counts: verification.counts,
        conditions: verification.conditions.slice(0, maxConditions),
        conditionsTruncated: verification.conditions.length > maxConditions,
        unexpected: verification.unexpected.slice(0, 20),
        lenses: verification.lenses.map((lens) => ({ lensId: lens.lensId, repositoryId: lens.repositoryId, status: lens.status, findings: lens.findings.slice(0, 5), reducedGuarantee: lens.reducedGuarantee })),
        coverage: verification.coverage,
        boundaries: verification.boundaries.map((b) => `${b.kind}: ${b.message}`),
        truncated: verification.truncated || verification.unexpected.length > 20,
      },
    } : {}),
    ...(session.commitPlan ? { commitPlan: session.commitPlan } : {}),
  };
}

// ─── Transport dispatcher ────────────────────────────────────────────────────

export const CHANGE_WORKFLOW_ACTIONS = ['start', 'status', 'checkpoint', 'verify', 'complete', 'list'] as const;
export type ChangeWorkflowAction = (typeof CHANGE_WORKFLOW_ACTIONS)[number];

export interface ChangeWorkflowActionInput {
  action: string;
  sessionId?: string;
  task?: string;
  /** `repo` uses `repoDir`; `group` requires `groupName`. */
  scope?: 'repo' | 'group';
  repoDir?: string;
  groupName?: string;
  targets?: string[];
  taskRetention?: TaskRetention;
  expectedRevision?: number;
  note?: string;
  conditions?: Array<Record<string, unknown>>;
  removeConditionIds?: string[];
  stepId?: string;
  lenses?: string[];
  edited?: boolean;
  /** Return the full session JSON instead of the bounded compact view. */
  full?: boolean;
  /** start: authenticated creator (multi-user transports). */
  owner?: { userId: string; username: string };
}

/**
 * The single orchestrator every transport (MCP `change_workflow`, CLI
 * `code-intel workflow`) calls. Returns the bounded compact view unless
 * `full` is requested.
 */
export async function runChangeWorkflowAction(input: ChangeWorkflowActionInput, deps: ChangeWorkflowServiceDeps = {}, options: { strict?: boolean } = {}): Promise<unknown> {
  const action = input.action as ChangeWorkflowAction;
  if (!CHANGE_WORKFLOW_ACTIONS.includes(action)) {
    throw new WorkflowSessionError('INVALID_REQUEST', `unknown action ${JSON.stringify(input.action)}; expected ${CHANGE_WORKFLOW_ACTIONS.join('|')}`);
  }
  if (input.scope === 'group' && !input.groupName) throw new WorkflowSessionError('INVALID_REQUEST', 'group scope requires a group name');
  const groupName = input.scope === 'group' || (input.scope === undefined && input.groupName) ? input.groupName : undefined;
  const view = (result: WorkflowActionResult) => (input.full ? { ...result, next: result.next } : compactSessionView(result));
  if (action === 'list') {
    return { sessions: listWorkflowSessions({ repoDir: groupName ? undefined : input.repoDir, groupName }, deps).slice(0, 50) };
  }
  if (action === 'start') {
    if (!input.task) throw new WorkflowSessionError('INVALID_REQUEST', 'start requires a task');
    const scope: StartScope = groupName ? { type: 'group', groupName } : { type: 'repo', repoDir: input.repoDir ?? process.cwd() };
    return view(await startWorkflow({ task: input.task, scope, targets: input.targets, taskRetention: input.taskRetention, owner: input.owner }, deps));
  }
  if (!input.sessionId) throw new WorkflowSessionError('INVALID_REQUEST', `${action} requires a session id`);
  const locator: SessionLocator = { sessionId: input.sessionId, repoDir: groupName ? undefined : input.repoDir, groupName, strict: options.strict };
  switch (action) {
    case 'status':
      return view(await workflowStatus(locator, deps));
    case 'checkpoint':
      return view(await workflowCheckpoint({
        ...locator,
        expectedRevision: input.expectedRevision,
        note: input.note,
        conditions: input.conditions,
        removeConditionIds: input.removeConditionIds,
        stepId: input.stepId,
        lenses: input.lenses,
        edited: input.edited,
      }, deps));
    case 'verify':
      return view(await workflowVerify({ ...locator, expectedRevision: input.expectedRevision }, deps));
    case 'complete':
      return view(await workflowComplete({ ...locator, expectedRevision: input.expectedRevision }, deps));
  }
}

/** Error payload shared by transports. */
export function workflowErrorPayload(err: unknown): { error: string; code?: string; details?: Record<string, unknown> } {
  if (err instanceof WorkflowSessionError) return { error: err.message, code: err.code, ...(Object.keys(err.details).length > 0 ? { details: err.details } : {}) };
  return { error: err instanceof Error ? err.message : String(err) };
}
