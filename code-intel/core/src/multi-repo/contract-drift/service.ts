import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import { createKnowledgeGraph } from '../../graph/knowledge-graph.js';
import { loadGraphSnapshotFromDbPath } from '../graph-from-db.js';
import { getOrBuildSnapshot, resolveSnapshotDescriptor, type SnapshotCachePolicy } from '../../snapshots/cache.js';
import type { SnapshotBuildResult } from '../../snapshots/types.js';
import { findRepoById, loadRegistry } from '../../storage/repo-registry.js';
import { collectGraphFacts, routeFactFromNode } from '../../semantic/api-contracts/service.js';
import { contractIdentityFromContract, getStableContractId } from '../contract-identity.js';
import { contractFingerprintFromContract, computeSemanticContractFingerprint, semanticFingerprintPayloadFromNode } from '../contract-fingerprint.js';
import { compareContractVersions } from './comparator.js';
import { loadGroup, loadSyncResult } from '../group-registry.js';
import { suggestTests } from '../../query/suggest-tests.js';
import type { Contract, ContractDriftFinding, ContractDriftSummary, ContractDriftTestSuggestion, GroupContractVersion, GroupSyncResult, KnownConsumerCoverage } from '../types.js';

export interface GroupContractDriftRequest {
  groupName: string;
  baseRef?: string;
  headRef?: string;
  baseSnapshotIds?: Record<string, string>;
  headSnapshotIds?: Record<string, string>;
  allowCache?: boolean;
  cachePolicy?: SnapshotCachePolicy;
  limit?: number;
  /** Restrict analysis to one contract kind. Filters which contracts are compared — every
   * member repo's state is still loaded, since other repos may still be relevant consumers. */
  kind?: Contract['kind'];
  /** Restrict analysis to contracts produced by one member repository (by stable repo ID, not
   * the mutable registry name). */
  repositoryId?: string;
}

/** Observability counters for one `getGroupContractDrift` call (task 10.1). Every count is
 * exact for this call — none of these are estimates. */
export interface GroupContractDriftMetrics {
  /** Distinct contract IDs examined (union of base/head contract sets). */
  contractsLoaded: number;
  /** Contracts where base/head fingerprints differ, or one side is missing (added/removed). */
  fingerprintsChanged: number;
  /** Contracts the incremental skip (task 8.2) proved unchanged and did not recompare. */
  fingerprintsUnchangedSkipped: number;
  /** Known-consumer references examined across all emitted findings. */
  consumersExpanded: number;
  /** Kind-specific comparator invocations actually executed. */
  comparisonsExecuted: number;
  /** Comparisons that ran the full comparator because version/fingerprint data was missing or
   * legacy — i.e. the incremental skip could not safely apply. */
  fullFallbackCount: number;
  /** Findings carrying at least one consumer capped by the reverse-expansion bound. */
  capHits: number;
  /** Member repositories that could not produce a requested base or head state. */
  partialRepositories: number;
  elapsedMs: number;
}

export interface GroupContractDriftResult {
  groupName: string;
  findings: ContractDriftFinding[];
  totalFindings: number;
  summary: ContractDriftSummary;
  base: Record<string, SnapshotBuildResult | { status: 'provided'; snapshotId: string }>;
  head: Record<string, SnapshotBuildResult | { status: 'provided'; snapshotId: string }>;
  metrics: GroupContractDriftMetrics;
}

function fullCoverage() {
  return { complete: true, examinedCount: 1, incompleteReasons: [] as string[] };
}

function inferRole(kind: Contract['kind']): Contract['role'] {
  return kind === 'export' ? 'producer' : 'producer';
}

function extractContractsFromGraph(graph: KnowledgeGraph, repoName: string, repoPath: string, repositoryId: string, snapshotId: string): Contract[] {
  const contracts: Contract[] = [];
  for (const node of graph.allNodes()) {
    if (node.exported === true && ['function', 'class', 'interface', 'method', 'type_alias', 'constant', 'enum', 'struct', 'trait'].includes(node.kind)) {
      const contract: Contract = {
        repoName,
        repoPath,
        repositoryId,
        kind: 'export',
        name: node.name,
        nodeId: node.id,
        nodeKind: node.kind,
        filePath: node.filePath,
        signature: node.content?.split('\n')[0]?.trim(),
        sourceCanonicalId: node.identityId ?? node.id,
        snapshotId,
        role: inferRole('export'),
        certainty: 'exact',
        coverage: fullCoverage(),
      };
      contract.contractId = getStableContractId(contractIdentityFromContract(contract, repositoryId));
      contract.semanticFingerprint = computeSemanticContractFingerprint({
        ...contractFingerprintFromContract(contract),
        semantic: semanticFingerprintPayloadFromNode(node, contract.kind),
      });
      contracts.push(contract);
    }
    if (node.kind === 'route') {
      const routeFact = routeFactFromNode(node);
      const contract: Contract = {
        repoName,
        repoPath,
        repositoryId,
        kind: 'route',
        name: node.name,
        nodeId: node.id,
        nodeKind: node.kind,
        filePath: node.filePath,
        signature: node.content?.split('\n')[0]?.trim(),
        method: routeFact?.method,
        normalizedPath: routeFact?.normalizedPath,
        sourceCanonicalId: routeFact?.factId ?? node.identityId ?? node.id,
        snapshotId,
        role: inferRole('route'),
        certainty: 'exact',
        coverage: fullCoverage(),
      };
      contract.contractId = getStableContractId(contractIdentityFromContract(contract, repositoryId));
      contract.semanticFingerprint = computeSemanticContractFingerprint({
        ...contractFingerprintFromContract(contract),
        semantic: semanticFingerprintPayloadFromNode(node, contract.kind),
      });
      contracts.push(contract);
    }
    if (['interface', 'type_alias', 'enum'].includes(node.kind)) {
      const nameLower = node.name.toLowerCase();
      const kind = nameLower.includes('event') || nameLower.includes('message') ? 'event'
        : nameLower.includes('schema') || nameLower.includes('dto') || nameLower.includes('request') || nameLower.includes('response') ? 'schema'
          : undefined;
      if (!kind) continue;
      const contract: Contract = {
        repoName,
        repoPath,
        repositoryId,
        kind,
        name: node.name,
        nodeId: node.id,
        nodeKind: node.kind,
        filePath: node.filePath,
        sourceCanonicalId: node.identityId ?? node.id,
        snapshotId,
        role: inferRole(kind),
        certainty: 'exact',
        coverage: fullCoverage(),
      };
      contract.contractId = getStableContractId(contractIdentityFromContract(contract, repositoryId));
      contract.semanticFingerprint = computeSemanticContractFingerprint({
        ...contractFingerprintFromContract(contract),
        semantic: semanticFingerprintPayloadFromNode(node, contract.kind),
      });
      contracts.push(contract);
    }
  }
  return contracts;
}

function versionFromContract(contract: Contract, repositoryId: string): GroupContractVersion {
  return {
    contractId: contract.contractId!,
    kind: contract.kind,
    repositoryId,
    repositoryName: contract.repoName,
    snapshotId: contract.snapshotId!,
    semanticFingerprint: contract.semanticFingerprint!,
    sourceCanonicalId: contract.sourceCanonicalId,
    role: contract.role ?? 'unknown',
    certainty: contract.certainty ?? 'legacy',
    coverage: contract.coverage ?? fullCoverage(),
  };
}

async function loadSnapshotGraph(repoPath: string, snapshotId: string): Promise<KnowledgeGraph | null> {
  const graphDbPath = `${repoPath}/.code-intel/snapshots/${snapshotId}/graph.db`;
  try { return await loadGraphSnapshotFromDbPath(graphDbPath); } catch { return null; }
}

async function buildOrLoadRepoState(input: {
  repoId: string;
  repoName: string;
  repoPath: string;
  ref?: string;
  providedSnapshotId?: string;
  allowCache?: boolean;
  cachePolicy?: SnapshotCachePolicy;
}): Promise<{ graph: KnowledgeGraph | null; snapshotId?: string; result: SnapshotBuildResult | { status: 'provided'; snapshotId: string } }> {
  if (input.providedSnapshotId) {
    return {
      graph: await loadSnapshotGraph(input.repoPath, input.providedSnapshotId),
      snapshotId: input.providedSnapshotId,
      result: { status: 'provided', snapshotId: input.providedSnapshotId },
    };
  }
  if (!input.ref) return { graph: null, result: { status: 'failed', descriptor: null, artifactsDir: null, fromCache: false, boundaries: [{ kind: 'unknown-ref', message: 'missing ref' }], durationMs: 0, error: 'missing ref' } };
  const snapshot = await getOrBuildSnapshot({ repoDir: input.repoPath, ref: input.ref, allowCache: input.allowCache }, input.cachePolicy);
  if (!snapshot.artifactsDir) return { graph: null, result: snapshot };
  return { graph: await loadGraphSnapshotFromDbPath(`${snapshot.artifactsDir}/graph.db`), snapshotId: snapshot.descriptor?.snapshotId, result: snapshot };
}

function summarize(findings: readonly ContractDriftFinding[], extraReasons: readonly string[]): ContractDriftSummary {
  const byCompatibility: ContractDriftSummary['byCompatibility'] = { compatible: 0, 'potentially-breaking': 0, breaking: 0, unknown: 0 };
  const byKind: NonNullable<ContractDriftSummary['byKind']> = {};
  for (const finding of findings) {
    byCompatibility[finding.compatibility] += 1;
    byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
  }
  const knownConsumerCoverage: KnownConsumerCoverage = {
    complete: findings.every((finding) => finding.knownConsumerCoverage.complete),
    inScope: extraReasons.length === 0 ? 'group-sync' : 'partial-group-sync',
    certainty: findings.some((finding) => finding.knownConsumerCoverage.certainty === 'lower-bound') ? 'lower-bound' : findings.some((finding) => finding.knownConsumerCoverage.certainty === 'heuristic') ? 'heuristic' : findings.length > 0 ? 'exact' : 'legacy',
    examinedConsumerCount: findings.reduce((sum, finding) => sum + finding.knownConsumerCoverage.examinedConsumerCount, 0),
    totalKnownConsumerCount: findings.reduce((sum, finding) => sum + (finding.knownConsumerCoverage.totalKnownConsumerCount ?? 0), 0),
    incompleteReasons: [...new Set([...extraReasons, ...findings.flatMap((finding) => finding.knownConsumerCoverage.incompleteReasons)])].sort(),
  };
  return {
    totalFindings: findings.length,
    byCompatibility,
    byKind,
    coverage: {
      complete: extraReasons.length === 0 && findings.every((finding) => finding.coverage.complete),
      examinedCount: findings.length,
      totalKnownCount: findings.length,
      incompleteReasons: [...new Set([...extraReasons, ...findings.flatMap((finding) => finding.coverage.incompleteReasons)])].sort(),
    },
    knownConsumerCoverage,
  };
}

/**
 * Attach flow/test guidance to a finding, but only from exact-certainty consumer
 * evidence. Heuristic/unknown consumers stay visible in `affectedConsumers` as
 * candidates — they never gain a suggestion here, so they cannot masquerade as
 * confirmed-exact impact.
 */
function attachSuggestedTests(
  finding: ContractDriftFinding,
  graphByRepo: ReadonlyMap<string, KnowledgeGraph>,
  repoPathByRepo: ReadonlyMap<string, string>,
): ContractDriftFinding {
  if (finding.compatibility !== 'breaking' && finding.compatibility !== 'potentially-breaking') return finding;
  const suggestions: ContractDriftTestSuggestion[] = [];
  for (const consumer of finding.affectedConsumers) {
    if (consumer.certainty !== 'exact') continue;
    const consumerGraph = graphByRepo.get(consumer.repositoryId);
    if (!consumerGraph) continue;
    const node = consumerGraph.getNode(consumer.consumerId)
      ?? [...consumerGraph.allNodes()].find((candidate) => candidate.identityId === consumer.sourceCanonicalId);
    if (!node) continue;
    const relatedFlowIds = [...consumerGraph.findEdgesFrom(node.id)]
      .filter((edge) => edge.kind === 'step_of')
      .map((edge) => edge.target)
      .sort();
    const testResult = suggestTests(consumerGraph, node.name, repoPathByRepo.get(consumer.repositoryId));
    if ('error' in testResult) continue;
    suggestions.push({
      repositoryId: consumer.repositoryId,
      consumerId: consumer.consumerId,
      symbol: node.name,
      relatedFlowIds,
      suggestedCases: testResult.suggestedCases,
      existingTests: testResult.existingTests,
    });
  }
  return suggestions.length > 0 ? { ...finding, suggestedTests: suggestions } : finding;
}

export async function getGroupContractDrift(request: GroupContractDriftRequest): Promise<GroupContractDriftResult> {
  const startedAt = Date.now();
  const group = loadGroup(request.groupName);
  if (!group) throw new Error(`Group "${request.groupName}" not found`);
  const sync = loadSyncResult(request.groupName);
  if (!sync) throw new Error(`Group "${request.groupName}" has no sync result`);
  const registry = loadRegistry();
  const base: GroupContractDriftResult['base'] = {};
  const head: GroupContractDriftResult['head'] = {};
  const extraReasons: string[] = [];
  const baseContracts = new Map<string, { contract: Contract; version: GroupContractVersion; graph?: KnowledgeGraph }>();
  const headContracts = new Map<string, { contract: Contract; version: GroupContractVersion; graph?: KnowledgeGraph }>();
  const headGraphByRepo = new Map<string, KnowledgeGraph>();
  const repoPathByRepo = new Map<string, string>();

  for (const member of group.members) {
    const entry = member.repoId ? findRepoById(member.repoId, registry) : registry.find((repo) => repo.name === member.registryName);
    if (!entry) {
      extraReasons.push(`missing repo registry entry: ${member.registryName}`);
      continue;
    }
    const baseState = await buildOrLoadRepoState({ repoId: entry.id, repoName: entry.name, repoPath: entry.path, ref: request.baseRef, providedSnapshotId: request.baseSnapshotIds?.[entry.id], allowCache: request.allowCache, cachePolicy: request.cachePolicy });
    const headState = await buildOrLoadRepoState({ repoId: entry.id, repoName: entry.name, repoPath: entry.path, ref: request.headRef, providedSnapshotId: request.headSnapshotIds?.[entry.id], allowCache: request.allowCache, cachePolicy: request.cachePolicy });
    base[entry.id] = baseState.result;
    head[entry.id] = headState.result;
    if (!baseState.graph) extraReasons.push(`base unavailable for ${entry.id}`);
    if (!headState.graph) extraReasons.push(`head unavailable for ${entry.id}`);
    if (headState.graph) {
      headGraphByRepo.set(entry.id, headState.graph);
      repoPathByRepo.set(entry.id, entry.path);
    }

    if (baseState.graph && baseState.snapshotId) {
      for (const contract of extractContractsFromGraph(baseState.graph, entry.name, entry.path, entry.id, baseState.snapshotId)) {
        if (!['route', 'schema', 'event', 'graphql', 'grpc', 'export'].includes(contract.kind)) continue;
        baseContracts.set(contract.contractId!, { contract, version: versionFromContract(contract, entry.id), graph: baseState.graph });
      }
    }
    if (headState.graph && headState.snapshotId) {
      for (const contract of extractContractsFromGraph(headState.graph, entry.name, entry.path, entry.id, headState.snapshotId)) {
        if (!['route', 'schema', 'event', 'graphql', 'grpc', 'export'].includes(contract.kind)) continue;
        headContracts.set(contract.contractId!, { contract, version: versionFromContract(contract, entry.id), graph: headState.graph });
      }
    }
  }

  const consumerIndexById = sync.consumerIndex?.byContractId ?? {};
  const consumerIndexByFingerprint = sync.consumerIndex?.bySemanticFingerprint ?? {};
  const contractMap = new Map(sync.contracts.filter((contract) => contract.contractId).map((contract) => [contract.contractId!, contract]));
  const syncContractBySourceId = new Map(sync.contracts.filter((contract) => contract.sourceCanonicalId).map((contract) => [contract.sourceCanonicalId!, contract]));
  let allIds = [...new Set([...baseContracts.keys(), ...headContracts.keys()])].sort();
  if (request.kind || request.repositoryId) {
    allIds = allIds.filter((contractId) => {
      const baseEntry = baseContracts.get(contractId);
      const headEntry = headContracts.get(contractId);
      const kind = headEntry?.contract.kind ?? baseEntry?.contract.kind;
      const repositoryId = headEntry?.version.repositoryId ?? baseEntry?.version.repositoryId;
      if (request.kind && kind !== request.kind) return false;
      if (request.repositoryId && repositoryId !== request.repositoryId) return false;
      return true;
    });
  }
  const findings: ContractDriftFinding[] = [];
  let comparisonsExecuted = 0;
  let fingerprintsUnchangedSkipped = 0;
  let fingerprintsChanged = 0;
  let fullFallbackCount = 0;
  for (const contractId of allIds) {
    const baseEntry = baseContracts.get(contractId);
    const headEntry = headContracts.get(contractId);
    const syncContract = contractMap.get(contractId)
      ?? (headEntry?.contract.sourceCanonicalId ? syncContractBySourceId.get(headEntry.contract.sourceCanonicalId) : undefined)
      ?? (baseEntry?.contract.sourceCanonicalId ? syncContractBySourceId.get(baseEntry.contract.sourceCanonicalId) : undefined);
    const kind = headEntry?.contract.kind ?? baseEntry?.contract.kind;
    if (!kind) continue;
    const fingerprint = headEntry?.version.semanticFingerprint ?? baseEntry?.version.semanticFingerprint;

    // Incremental recomparison: for the fully-implemented comparator kinds, a fingerprint now
    // captures full semantic content (route shape refs; schema/event field lists — see
    // semanticFingerprintPayloadFromNode), so an identical, non-legacy fingerprint on both sides
    // provably yields no finding — every comparator already returns [] for unchanged content.
    // Skip the deep comparator call rather than re-deriving that same empty result. Missing or
    // legacy version data is never provably unchanged, so it always falls through below.
    const isFullyComparedKind = kind === 'route' || kind === 'schema' || kind === 'event';
    const canProveUnchanged = Boolean(
      baseEntry?.version && headEntry?.version
      && baseEntry.version.certainty !== 'legacy' && headEntry.version.certainty !== 'legacy',
    );
    if (isFullyComparedKind && canProveUnchanged && baseEntry!.version.semanticFingerprint === headEntry!.version.semanticFingerprint) {
      fingerprintsUnchangedSkipped += 1;
      continue;
    }
    if (isFullyComparedKind) {
      if (canProveUnchanged) fingerprintsChanged += 1;
      else fullFallbackCount += 1;
    }
    comparisonsExecuted += 1;

    findings.push(...compareContractVersions({
      kind,
      baseVersion: baseEntry?.version,
      headVersion: headEntry?.version,
      baseContract: baseEntry?.contract ?? syncContract,
      headContract: headEntry?.contract ?? syncContract,
      baseGraph: baseEntry?.graph,
      headGraph: headEntry?.graph,
      affectedConsumers: consumerIndexById[contractId]
        ?? (syncContract?.contractId ? consumerIndexById[syncContract.contractId] ?? [] : undefined)
        ?? (fingerprint ? consumerIndexByFingerprint[fingerprint] ?? [] : []),
    }));
  }

  const withSuggestions = findings.map((finding) => attachSuggestedTests(finding, headGraphByRepo, repoPathByRepo));
  const sorted = withSuggestions.sort((a, b) =>
    a.repositoryId.localeCompare(b.repositoryId)
    || a.kind.localeCompare(b.kind)
    || a.contractId.localeCompare(b.contractId)
    || a.changeKind.localeCompare(b.changeKind)
    || a.summary.localeCompare(b.summary),
  );
  const limited = request.limit && request.limit > 0 ? sorted.slice(0, request.limit) : sorted;
  const truncatedReasons = request.limit && request.limit > 0 && sorted.length > request.limit ? [`output-truncated:${request.limit}`] : [];
  const summary = summarize(sorted, [...extraReasons, ...truncatedReasons]);

  const partialRepoIds = new Set<string>();
  for (const reason of extraReasons) {
    const match = /^(?:base|head) unavailable for (.+)$/.exec(reason) ?? /^missing repo registry entry: (.+)$/.exec(reason);
    if (match) partialRepoIds.add(match[1]!);
  }
  const capHits = sorted.filter((finding) => finding.affectedConsumers.some((consumer) => consumer.coverage?.incompleteReasons?.includes('consumer-cap-exceeded'))).length;

  const metrics: GroupContractDriftMetrics = {
    contractsLoaded: allIds.length,
    fingerprintsChanged,
    fingerprintsUnchangedSkipped,
    consumersExpanded: summary.knownConsumerCoverage.examinedConsumerCount,
    comparisonsExecuted,
    fullFallbackCount,
    capHits,
    partialRepositories: partialRepoIds.size,
    elapsedMs: Date.now() - startedAt,
  };

  return { groupName: request.groupName, findings: limited, totalFindings: sorted.length, summary, base, head, metrics };
}
