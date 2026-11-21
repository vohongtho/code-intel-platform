/**
 * service.ts
 *
 * Builds, caches and queries a group's system flows from:
 * - each member's *published* index (stable local flows, route/consumer
 *   facts) — system flows describe the indexed state, not unanalyzed edits;
 * - the group's persisted sync result (contract links + consumer index).
 *
 * Boundary derivation:
 * - `route-match` links (method + normalized-path evidence from
 *   `matchApiContracts`) become consumer -> provider edges: the consumer
 *   fact's enclosing function/method (only when a real line span contains
 *   the call site) to the route's `handles` target. Unresolvable endpoints
 *   keep the edge but make it non-exact.
 * - `name-match` links (export/event/schema names) become `name-match`
 *   edges, which the stitcher only ever reports as candidates.
 *
 * Cache: one file per group under `~/.code-intel/system-flows/`, keyed by
 * group schema version, member snapshot (Generation) IDs + trust,
 * consumer-index/link fingerprint, local flow identity versions, stitcher
 * version and limits. Any input change is a cache miss; a persisted entry is
 * never served when its key does not match the current inputs.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import type { CodeNode } from '../../shared/index.js';
import { FLOW_IDENTITY_VERSION } from '../../flow-detection/identity.js';
import { systemFlowStitchTotal } from '../../observability/metrics.js';
import { loadGraphSnapshotFromDbPath } from '../graph-from-db.js';
import { loadGroup, loadSyncResult } from '../group-registry.js';
import { findRepoById } from '../../storage/repo-registry.js';
import { resolveIndexSnapshot } from '../../storage/index-snapshot.js';
import { verifyIndexTrust } from '../../storage/index-trust.js';
import type { Contract, ContractLink, GroupSyncResult, RepoGroup } from '../types.js';
import { stitchSystemFlows } from './stitcher.js';
import {
  DEFAULT_STITCH_LIMITS,
  STITCHER_VERSION,
  SYSTEM_FLOW_CACHE_SCHEMA_VERSION,
  SYSTEM_FLOW_VERSION,
  type ContractBoundaryEdge,
  type LocalFlowRecord,
  type StitchLimits,
  type StitchRepositoryInput,
  type StitchResult,
  type SystemFlow,
} from './types.js';

const GROUP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROTOCOL_LINKS: Partial<Record<ContractLink['matchKind'], { kind: 'event' | 'graphql' | 'grpc'; evidence: ContractBoundaryEdge['evidence'] }>> = {
  'event-topic-match': { kind: 'event', evidence: 'event-topic' },
  'graphql-operation-match': { kind: 'graphql', evidence: 'graphql-operation' },
  'grpc-method-match': { kind: 'grpc', evidence: 'grpc-method' },
};
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const SYMBOL_CONTAINER_KINDS = new Set(['function', 'method']);

export interface MemberDescriptor {
  repositoryId: string;
  repositoryName: string;
  repoPath: string;
  snapshotId?: string;
  trusted: boolean;
  fresh: boolean;
  flowIdentityVersion?: string;
}

export interface SystemFlowServiceDeps {
  homeDir?: string;
  loadGroup?: (name: string) => RepoGroup | null;
  loadSyncResult?: (name: string) => GroupSyncResult | null;
  describeMember?: (repositoryId: string, registryName: string) => MemberDescriptor | null;
  loadGraph?: (member: MemberDescriptor) => Promise<KnowledgeGraph>;
}

function defaultDescribeMember(repositoryId: string, registryName: string): MemberDescriptor | null {
  const repo = findRepoById(repositoryId);
  if (!repo) return null;
  const snapshot = resolveIndexSnapshot(repo.path);
  const trust = verifyIndexTrust(repo.path);
  return {
    repositoryId: repo.id,
    repositoryName: repo.name ?? registryName,
    repoPath: repo.path,
    snapshotId: snapshot?.generationId,
    trusted: trust.trusted,
    fresh: trust.fresh,
    flowIdentityVersion: trust.metadata?.compatibilityReceipt?.flowIdentityFingerprint,
  };
}

async function defaultLoadGraph(member: MemberDescriptor): Promise<KnowledgeGraph> {
  const snapshot = resolveIndexSnapshot(member.repoPath);
  if (!snapshot) throw new Error(`no published index for ${member.repositoryName}`);
  return loadGraphSnapshotFromDbPath(snapshot.graphDbPath);
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function canonicalOf(node: CodeNode): string {
  return node.identityId ?? node.id;
}

// ─── Local flows / endpoint resolution ───────────────────────────────────────

export function localFlowsFromGraph(graph: KnowledgeGraph, repositoryId: string): LocalFlowRecord[] {
  const flows: LocalFlowRecord[] = [];
  for (const node of graph.allNodes()) {
    if (node.kind !== 'flow') continue;
    const metadata = node.metadata ?? {};
    const entry = metadata['entryPointCanonicalId'];
    const steps = metadata['stepCanonicalIds'];
    if (metadata['algorithmVersion'] !== FLOW_IDENTITY_VERSION || typeof entry !== 'string' || !Array.isArray(steps) || !steps.every((s) => typeof s === 'string')) continue;
    flows.push({
      repositoryId,
      flowId: node.id,
      flowFingerprint: typeof metadata['flowFingerprint'] === 'string' ? metadata['flowFingerprint'] : undefined,
      entrySymbolId: entry,
      stepSymbolIds: steps as string[],
    });
  }
  return flows.sort((a, b) => a.flowId.localeCompare(b.flowId));
}

interface GraphEndpointIndex {
  consumerNodeByFactId: Map<string, CodeNode>;
  routeNodeByFactId: Map<string, CodeNode>;
  containersByFile: Map<string, CodeNode[]>;
}

function indexGraph(graph: KnowledgeGraph): GraphEndpointIndex {
  const consumerNodeByFactId = new Map<string, CodeNode>();
  const routeNodeByFactId = new Map<string, CodeNode>();
  const containersByFile = new Map<string, CodeNode[]>();
  for (const node of graph.allNodes()) {
    const metadata = node.metadata as Record<string, unknown> | undefined;
    if (node.kind === 'api_consumer') {
      const factId = (metadata?.['semantic'] as Record<string, unknown> | undefined)?.['factId'];
      if (typeof factId === 'string') consumerNodeByFactId.set(factId, node);
    } else if (node.kind === 'route') {
      const factId = (metadata?.['apiContract'] as Record<string, unknown> | undefined)?.['factId'];
      if (typeof factId === 'string') routeNodeByFactId.set(factId, node);
    } else if (SYMBOL_CONTAINER_KINDS.has(node.kind) && node.startLine !== undefined && node.endLine !== undefined && node.endLine > node.startLine) {
      const list = containersByFile.get(node.filePath) ?? [];
      list.push(node);
      containersByFile.set(node.filePath, list);
    }
  }
  return { consumerNodeByFactId, routeNodeByFactId, containersByFile };
}

/** Innermost function/method whose *real* line span contains the call site; never a nearest-preceding guess. */
function enclosingSymbol(index: GraphEndpointIndex, filePath: string, line: number): CodeNode | undefined {
  let best: CodeNode | undefined;
  for (const candidate of index.containersByFile.get(filePath) ?? []) {
    if (candidate.startLine! > line || candidate.endLine! < line) continue;
    if (!best || candidate.startLine! > best.startLine! || (candidate.startLine === best.startLine && candidate.endLine! < best.endLine!)) best = candidate;
  }
  return best;
}

/**
 * The route's handler declaration. Some framework adapters record the handler *reference* as an
 * anchor-only node on the registration line (e.g. `app.post('/x', capture)`); that reference is
 * bound lexically to the single function/method of the same name with a real body span in the
 * same file. Zero or several such declarations leave the handler unresolved.
 */
function routeHandler(graph: KnowledgeGraph, route: CodeNode, index: GraphEndpointIndex): CodeNode | undefined {
  const handlers = [...graph.findEdgesFrom(route.id)].filter((edge) => edge.kind === 'handles').map((edge) => graph.getNode(edge.target)).filter((n): n is CodeNode => Boolean(n));
  if (handlers.length !== 1) return undefined;
  const handler = handlers[0]!;
  if (handler.startLine !== undefined && handler.endLine !== undefined && handler.endLine > handler.startLine) return handler;
  const declared = (index.containersByFile.get(handler.filePath) ?? []).filter((node) => node.name === handler.name && node.id !== handler.id);
  return declared.length === 1 ? declared[0] : undefined;
}

export function boundariesFromLinks(input: {
  links: readonly ContractLink[];
  graphs: ReadonlyMap<string, KnowledgeGraph>;
  contracts?: readonly Contract[];
}): ContractBoundaryEdge[] {
  const kindByContractId = new Map((input.contracts ?? []).filter((c) => c.contractId).map((c) => [c.contractId!, c.kind]));
  const indexes = new Map<string, GraphEndpointIndex>();
  const indexFor = (repositoryId: string) => {
    let index = indexes.get(repositoryId);
    const graph = input.graphs.get(repositoryId);
    if (!index && graph) {
      index = indexGraph(graph);
      indexes.set(repositoryId, index);
    }
    return index;
  };
  const edges: ContractBoundaryEdge[] = [];
  for (const link of input.links) {
    const contractId = link.providerContractId ?? `${link.providerRepo}:${link.providerContract}`;
    const certainty = link.certainty ?? 'legacy';
    if (link.matchKind === 'route-match') {
      const consumerGraph = input.graphs.get(link.consumerRepo);
      const providerGraph = input.graphs.get(link.providerRepo);
      const consumerIndex = indexFor(link.consumerRepo);
      const providerIndex = indexFor(link.providerRepo);
      let fromSymbolId: string | undefined;
      let toSymbolId: string | undefined;
      const reasons: string[] = [];
      const consumerNode = link.consumerSourceCanonicalId ? consumerIndex?.consumerNodeByFactId.get(link.consumerSourceCanonicalId) : undefined;
      if (!consumerGraph) reasons.push(`consumer repository ${link.consumerRepo} not loaded`);
      else if (!consumerNode) reasons.push('consumer fact not found in the consumer index');
      else {
        const container = enclosingSymbol(consumerIndex!, consumerNode.filePath, consumerNode.startLine ?? -1);
        if (container) fromSymbolId = canonicalOf(container);
        else reasons.push('no function/method span encloses the consumer call site');
      }
      const routeNode = link.providerSourceCanonicalId ? providerIndex?.routeNodeByFactId.get(link.providerSourceCanonicalId) : undefined;
      if (!providerGraph) reasons.push(`provider repository ${link.providerRepo} not loaded`);
      else if (!routeNode) reasons.push('route fact not found in the provider index');
      else {
        const handler = routeHandler(providerGraph, routeNode, providerIndex!);
        if (handler) toSymbolId = canonicalOf(handler);
        else reasons.push('route has no unique handler');
      }
      edges.push({
        contractId,
        kind: 'route',
        providerRepositoryId: link.providerRepo,
        consumerRepositoryId: link.consumerRepo,
        consumerId: link.consumerSourceCanonicalId ?? link.consumerContract,
        fromRepositoryId: link.consumerRepo,
        fromSymbolId,
        toRepositoryId: link.providerRepo,
        toSymbolId,
        certainty,
        evidence: 'http-route-fact',
        ...(reasons.length > 0 ? { unresolvedReason: reasons.join('; ') } : {}),
      });
      continue;
    }
    const protocol = PROTOCOL_LINKS[link.matchKind];
    if (protocol) {
      // Protocol links already carry resolved canonical endpoint symbols (see protocol-facts.ts).
      // Events flow publisher -> subscriber; GraphQL/gRPC flow client call -> resolver/implementation.
      const providerToConsumer = protocol.kind === 'event';
      const providerSymbol = link.providerSourceCanonicalId;
      const consumerSymbol = link.consumerSourceCanonicalId;
      edges.push({
        contractId,
        kind: protocol.kind,
        providerRepositoryId: link.providerRepo,
        consumerRepositoryId: link.consumerRepo,
        consumerId: link.consumerContractId ?? `${link.consumerRepo}:${link.consumerContract}`,
        fromRepositoryId: providerToConsumer ? link.providerRepo : link.consumerRepo,
        fromSymbolId: providerToConsumer ? providerSymbol : consumerSymbol,
        toRepositoryId: providerToConsumer ? link.consumerRepo : link.providerRepo,
        toSymbolId: providerToConsumer ? consumerSymbol : providerSymbol,
        certainty,
        evidence: protocol.evidence,
        ...(providerSymbol && consumerSymbol ? {} : { unresolvedReason: link.coverage?.incompleteReasons?.[0] ?? 'protocol endpoint symbol unresolved' }),
      });
      continue;
    }
    edges.push({
      contractId,
      kind: kindByContractId.get(contractId) ?? 'export',
      providerRepositoryId: link.providerRepo,
      consumerRepositoryId: link.consumerRepo,
      consumerId: link.consumerContractId ?? link.consumerSourceCanonicalId ?? link.consumerContract,
      fromRepositoryId: link.providerRepo,
      fromSymbolId: link.providerSourceCanonicalId,
      toRepositoryId: link.consumerRepo,
      toSymbolId: link.consumerSourceCanonicalId,
      certainty,
      evidence: 'name-match',
    });
  }
  return edges.sort((a, b) => a.contractId.localeCompare(b.contractId) || a.consumerId.localeCompare(b.consumerId) || a.fromRepositoryId.localeCompare(b.fromRepositoryId));
}

// ─── Cache ───────────────────────────────────────────────────────────────────

export interface SystemFlowCacheInputs {
  systemFlowVersion: string;
  stitcherVersion: string;
  groupName: string;
  groupSchemaVersion?: string;
  members: Array<{ repositoryId: string; snapshotId?: string; trusted: boolean; fresh: boolean; flowIdentityVersion?: string }>;
  contractLinksFingerprint: string;
  limits: StitchLimits;
}

export function systemFlowCacheKey(inputs: SystemFlowCacheInputs): string {
  return sha256(JSON.stringify(inputs));
}

export function resolveSystemFlowCachePath(groupName: string, homeDir: string = os.homedir()): string {
  if (!GROUP_NAME_PATTERN.test(groupName)) throw new Error(`Invalid group name: ${JSON.stringify(groupName)}`);
  return path.join(homeDir, '.code-intel', 'system-flows', `${groupName}.json`);
}

interface CacheFile {
  schemaVersion: number;
  cacheKey: string;
  inputs: SystemFlowCacheInputs;
  result: StitchResult;
}

function readCache(filePath: string, cacheKey: string): StitchResult | null {
  try {
    if (fs.statSync(filePath).size > MAX_CACHE_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CacheFile;
    if (parsed?.schemaVersion !== SYSTEM_FLOW_CACHE_SCHEMA_VERSION || parsed.cacheKey !== cacheKey) return null;
    if (parsed.result?.stitcherVersion !== STITCHER_VERSION || !Array.isArray(parsed.result.flows) || !Array.isArray(parsed.result.candidates)) return null;
    return parsed.result;
  } catch {
    return null;
  }
}

function writeCache(filePath: string, file: CacheFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(file), { mode: 0o600 });
    fs.renameSync(temp, filePath);
  } catch {
    fs.rmSync(temp, { force: true });
  }
}

// ─── Build ───────────────────────────────────────────────────────────────────

export interface GroupSystemFlowsResult {
  groupName: string;
  result: StitchResult;
  cache: { hit: boolean; key: string };
  inputs: SystemFlowCacheInputs;
}

export async function getGroupSystemFlows(
  groupName: string,
  options: { allowCache?: boolean; limits?: Partial<StitchLimits> } = {},
  deps: SystemFlowServiceDeps = {},
): Promise<GroupSystemFlowsResult> {
  const group = (deps.loadGroup ?? loadGroup)(groupName);
  if (!group) throw new Error(`Group "${groupName}" not found`);
  const sync = (deps.loadSyncResult ?? loadSyncResult)(groupName);
  if (!sync) throw new Error(`Group "${groupName}" has no sync result; run \`code-intel group sync ${groupName}\``);
  const describe = deps.describeMember ?? defaultDescribeMember;
  const limits: StitchLimits = { ...DEFAULT_STITCH_LIMITS, ...(options.limits ?? {}) };

  const members: MemberDescriptor[] = [];
  const missing: string[] = [];
  for (const member of group.members) {
    const descriptor = member.repoId ? describe(member.repoId, member.registryName) : null;
    if (descriptor) members.push(descriptor);
    else missing.push(member.registryName);
  }
  members.sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));

  const inputs: SystemFlowCacheInputs = {
    systemFlowVersion: SYSTEM_FLOW_VERSION,
    stitcherVersion: STITCHER_VERSION,
    groupName,
    groupSchemaVersion: sync.schemaVersion,
    members: members.map((m) => ({ repositoryId: m.repositoryId, snapshotId: m.snapshotId, trusted: m.trusted, fresh: m.fresh, flowIdentityVersion: m.flowIdentityVersion })),
    contractLinksFingerprint: sha256(JSON.stringify({ links: sync.links, consumerIndex: sync.consumerIndex ?? null, missing: missing.sort() })),
    limits,
  };
  const key = systemFlowCacheKey(inputs);
  const cachePath = resolveSystemFlowCachePath(groupName, deps.homeDir);
  if (options.allowCache !== false) {
    const cached = readCache(cachePath, key);
    if (cached) return { groupName, result: cached, cache: { hit: true, key }, inputs };
  }

  const graphs = new Map<string, KnowledgeGraph>();
  const repositories: StitchRepositoryInput[] = [];
  for (const member of members) {
    let flows: LocalFlowRecord[] = [];
    let incompleteReason: string | undefined;
    try {
      const graph = await (deps.loadGraph ?? defaultLoadGraph)(member);
      graphs.set(member.repositoryId, graph);
      flows = localFlowsFromGraph(graph, member.repositoryId);
    } catch (err) {
      incompleteReason = `${member.repositoryName}: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (!incompleteReason && member.flowIdentityVersion !== FLOW_IDENTITY_VERSION) incompleteReason = `${member.repositoryName}: index lacks stable flow identity ${FLOW_IDENTITY_VERSION}`;
    if (!incompleteReason && (!member.trusted || !member.fresh)) incompleteReason = `${member.repositoryName}: index is not trusted/current`;
    repositories.push({
      repositoryId: member.repositoryId,
      snapshotId: member.snapshotId ?? 'unknown',
      flowIdentityVersion: member.flowIdentityVersion,
      coverageComplete: !incompleteReason,
      ...(incompleteReason ? { incompleteReason } : {}),
      flows,
    });
  }
  const boundaries = boundariesFromLinks({ links: sync.links, graphs, contracts: sync.contracts });
  const result = stitchSystemFlows({ repositories, boundaries, limits });
  for (const name of missing) {
    result.boundaries.push({ kind: 'partial-coverage', message: `group member ${name} has no registered repository` });
    result.coverage = { ...result.coverage, complete: false, incompleteReasons: [...result.coverage.incompleteReasons, `missing member ${name}`] };
  }
  systemFlowStitchTotal.inc({ kind: 'segments' }, result.counters.segments);
  systemFlowStitchTotal.inc({ kind: 'repository-hops' }, result.counters.repositoryHops);
  systemFlowStitchTotal.inc({ kind: 'candidates' }, result.counters.candidates);
  systemFlowStitchTotal.inc({ kind: 'cap-hits' }, result.counters.capHits);
  writeCache(cachePath, { schemaVersion: SYSTEM_FLOW_CACHE_SCHEMA_VERSION, cacheKey: key, inputs, result });
  return { groupName, result, cache: { hit: false, key }, inputs };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export interface SystemFlowQuery {
  /** Canonical symbol ID appearing in any segment (entry, exit or step). */
  symbolId?: string;
  contractId?: string;
  repositoryId?: string;
  limit?: number;
  offset?: number;
}

export const SYSTEM_FLOW_QUERY_LIMITS = Object.freeze({ defaultLimit: 20, maxLimit: 100 });

function flowMatches(flow: SystemFlow, query: SystemFlowQuery): boolean {
  if (query.repositoryId && !flow.segments.some((s) => s.repositoryId === query.repositoryId)) return false;
  if (query.contractId && !flow.segments.some((s) => s.boundaryToNext?.contractId === query.contractId)) return false;
  if (query.symbolId && !flow.segments.some((s) => s.entrySymbolId === query.symbolId || s.exitSymbolId === query.symbolId || s.stepSymbolIds.includes(query.symbolId!))) return false;
  return true;
}

/** Bounded, stable-ordered page of system flows plus matching candidate continuations. */
export function querySystemFlows(result: StitchResult, query: SystemFlowQuery = {}) {
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? SYSTEM_FLOW_QUERY_LIMITS.defaultLimit)), SYSTEM_FLOW_QUERY_LIMITS.maxLimit);
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const matching = result.flows.filter((flow) => flowMatches(flow, query));
  const candidates = result.candidates.filter((candidate) =>
    (!query.repositoryId || candidate.fromRepositoryId === query.repositoryId || candidate.toRepositoryId === query.repositoryId)
    && (!query.contractId || candidate.contractId === query.contractId)
    && (!query.symbolId || candidate.fromSymbolId === query.symbolId || candidate.toSymbolId === query.symbolId));
  return {
    flows: matching.slice(offset, offset + limit),
    total: matching.length,
    offset,
    limit,
    truncated: offset + limit < matching.length,
    candidates: candidates.slice(0, limit),
    candidatesTotal: candidates.length,
    coverage: result.coverage,
    boundaries: result.boundaries,
    counters: result.counters,
  };
}

/** System flows whose segments include any of the given canonical symbol / local flow IDs. */
export function systemFlowsTouching(result: StitchResult, ids: Iterable<string>): Array<{ id: string; fingerprint: string }> {
  const wanted = new Set(ids);
  return result.flows
    .filter((flow) => flow.segments.some((s) => (s.localFlowId && wanted.has(s.localFlowId)) || wanted.has(s.entrySymbolId) || (s.exitSymbolId && wanted.has(s.exitSymbolId)) || s.stepSymbolIds.some((step) => wanted.has(step))))
    .map((flow) => ({ id: flow.id, fingerprint: flow.fingerprint }));
}

export interface SystemFlowImpact {
  affected: Array<{ systemFlowId: string; contractIds: string[]; repositories: string[]; certainty: SystemFlow['certainty'] }>;
  coverage: StitchResult['coverage'];
  note: string;
}

/** System flows crossing any of the given contract IDs (additive impact for drift/PR/workflow results). */
export function systemFlowImpactForContracts(result: StitchResult, contractIds: Iterable<string>): SystemFlowImpact {
  const wanted = new Set(contractIds);
  const affected = result.flows
    .map((flow) => ({ flow, hits: flow.segments.map((s) => s.boundaryToNext?.contractId).filter((id): id is string => Boolean(id && wanted.has(id))) }))
    .filter(({ hits }) => hits.length > 0)
    .map(({ flow, hits }) => ({
      systemFlowId: flow.id,
      contractIds: [...new Set(hits)].sort(),
      repositories: [...new Set(flow.segments.map((s) => s.repositoryId))],
      certainty: flow.certainty,
    }));
  return {
    affected,
    coverage: result.coverage,
    note: 'System flows are static traces over the members\' published indexes and exact contract links; they are not runtime traces, and absence is not proof of no impact when coverage is incomplete.',
  };
}
