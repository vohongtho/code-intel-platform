/**
 * group-sync.ts
 * Loads each member repo's knowledge graph from its .code-intel/graph.db,
 * extracts contracts (exports, routes, events, schemas), and matches them
 * across repos to produce ContractLinks.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { CodeNode } from '../shared/index.js';
import type { RepoGroup, Contract, ContractLink, GroupSyncResult, GroupContractVersion, ContractRole, LinkKind } from './types.js';
import { findRepoById, loadRegistry } from '../storage/repo-registry.js';
import { DbManager } from '../storage/db-manager.js';
import { createKnowledgeGraph, type KnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadGraphFromDB } from './graph-from-db.js';
import Logger from '../shared/logger.js';
import { parseOpenAPIContracts } from './schema-parsers/openapi-parser.js';
import { extractProtocolFacts, type ProtocolFact, type ProtocolKind } from './protocol-facts.js';
import { buildProtocolConsumerRefs, extractProtocolSnapshot, graphqlContracts, grpcContracts, readProtocolSources, type ProtocolMemberSnapshot } from './protocol-contracts.js';
import { GRAPHQL_BINDING_CAPABILITIES, GRPC_BINDING_CAPABILITIES } from '../semantic/protocol-contracts/grpc-bindings.js';
import { buildSymbolSpanIndex } from './symbol-spans.js';
import { computeContractSimilarity } from './type-similarity.js';
import { collectGraphFacts, matchApiContracts, routeFactFromNode, type ScopedFact } from '../semantic/api-contracts/index.js';
import type { HttpConsumerFact, HttpRouteFact } from '../semantic/api-contracts/types.js';
import { contractIdentityFromContract, getStableContractId } from './contract-identity.js';
import { contractFingerprintFromContract, computeSemanticContractFingerprint, semanticFingerprintPayloadFromNode, GROUP_CONTRACT_SCHEMA_VERSION } from './contract-fingerprint.js';
import { resolveIndexSnapshot } from '../storage/index-snapshot.js';
import { buildContractConsumerIndex } from './contract-consumer-index.js';
import { loadSyncResult } from './group-registry.js';

// ─── Extract contracts from a single repo's graph ────────────────────────────

function fullCoverage() {
  return { complete: true, examinedCount: 1, incompleteReasons: [] as string[] };
}

function legacyAwareContractRole(kind: Contract['kind']): ContractRole {
  return kind === 'export' || kind === 'route' || kind === 'schema' || kind === 'event' || kind === 'graphql' || kind === 'grpc'
    ? 'producer'
    : 'unknown';
}

function enrichContract(contract: Contract, repositoryId: string, snapshotId: string, node?: CodeNode): Contract {
  const sourceCanonicalId = contract.sourceCanonicalId ?? contract.nodeId;
  const enriched: Contract = {
    ...contract,
    sourceCanonicalId,
    snapshotId,
    role: contract.role ?? legacyAwareContractRole(contract.kind),
    certainty: contract.certainty ?? 'exact',
    coverage: contract.coverage ?? fullCoverage(),
  };
  return {
    ...enriched,
    contractId: enriched.contractId ?? getStableContractId(contractIdentityFromContract(enriched, repositoryId)),
    semanticFingerprint: enriched.semanticFingerprint ?? computeSemanticContractFingerprint({
      ...contractFingerprintFromContract(enriched),
      semantic: semanticFingerprintPayloadFromNode(node, enriched.kind),
    }),
  };
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

function extractContracts(
  graph: KnowledgeGraph,
  repoName: string,
  repoPath: string,
  repositoryId: string,
  snapshotId: string,
): Contract[] {
  const contracts: Contract[] = [];

  for (const node of graph.allNodes()) {
    // exported symbols → 'export' contracts
    if (
      node.exported === true &&
      ['function', 'class', 'interface', 'method', 'type_alias', 'constant', 'enum', 'struct', 'trait'].includes(node.kind)
    ) {
      contracts.push(enrichContract({
        repoName,
        repoPath,
        kind: 'export',
        name: node.name,
        nodeId: node.id,
        nodeKind: node.kind,
        filePath: node.filePath,
        signature: node.content?.split('\n')[0]?.trim(),
        parameters: (node.metadata?.parameters ?? node.metadata?.params) as Array<{ name: string; type?: string }> | undefined,
        returnType: node.metadata?.returnType as string | undefined,
        exported: node.exported,
        sourceCanonicalId: node.identityId ?? node.id,
      }, repositoryId, snapshotId, node));
    }

    // route nodes → 'route' contracts. When the route carries API-contract evidence
    // (HttpRouteFact via graph-projector.ts), attach method/normalizedPath so matching can use
    // real evidence instead of name equality/substring — see matchRouteConsumersViaFacts.
    if (node.kind === 'route') {
      const routeFact = routeFactFromNode(node);
      contracts.push(enrichContract({
        repoName,
        repoPath,
        kind: 'route',
        name: node.name,
        nodeId: node.id,
        nodeKind: node.kind,
        filePath: node.filePath,
        signature: node.content?.split('\n')[0]?.trim(),
        method: routeFact?.method,
        normalizedPath: routeFact?.normalizedPath,
        sourceCanonicalId: routeFact?.factId ?? node.identityId ?? node.id,
      }, repositoryId, snapshotId, node));
    }

    // interfaces / type aliases with "event" or "schema" in name → schema/event contracts
    if (['interface', 'type_alias'].includes(node.kind)) {
      const nameLower = node.name.toLowerCase();
      if (nameLower.includes('event') || nameLower.includes('message')) {
        contracts.push(enrichContract({
          repoName,
          repoPath,
          kind: 'event',
          name: node.name,
          nodeId: node.id,
          nodeKind: node.kind,
          filePath: node.filePath,
          sourceCanonicalId: node.identityId ?? node.id,
        }, repositoryId, snapshotId, node));
      } else if (nameLower.includes('schema') || nameLower.includes('dto') || nameLower.includes('request') || nameLower.includes('response')) {
        contracts.push(enrichContract({
          repoName,
          repoPath,
          kind: 'schema',
          name: node.name,
          nodeId: node.id,
          nodeKind: node.kind,
          filePath: node.filePath,
          sourceCanonicalId: node.identityId ?? node.id,
        }, repositoryId, snapshotId, node));
      }
    }
  }

  return contracts;
}

// ─── Match contracts across repos ────────────────────────────────────────────

/**
 * Resolves cross-repo route → consumer links using the same evidence-based matcher as
 * `api_impact`/`api_drift` (method + normalized-path equality, never name/substring) instead
 * of a second, name-based route parser. Only routes/consumers that carry API-contract facts
 * (Express/Fastify/NestJS/ASP.NET Core producers; fetch/Axios/Angular consumers) participate —
 * other frameworks' route contracts still appear in `contracts` for listing, just without a
 * cross-repo link, which is a strictly more honest result than a name-based guess.
 */
function matchRouteConsumersViaFacts(memberGraphs: ReadonlyArray<{ repoId: string; graph: KnowledgeGraph }>): ContractLink[] {
  const routes: ScopedFact<HttpRouteFact>[] = [];
  const consumers: ScopedFact<HttpConsumerFact>[] = [];
  for (const { repoId, graph } of memberGraphs) {
    const facts = collectGraphFacts(graph);
    for (const fact of facts.routes) routes.push({ repoId, fact });
    for (const fact of facts.consumers) consumers.push({ repoId, fact });
  }
  if (routes.length === 0 || consumers.length === 0) return [];

  const matches = matchApiContracts(routes, consumers);
  const routesByFactId = new Map(routes.map((route) => [route.fact.factId, route]));
  const consumersByFactId = new Map(consumers.map((consumer) => [consumer.fact.factId, consumer]));

  const links: ContractLink[] = [];
  for (const match of matches) {
    if (match.certainty === 'unresolved') continue;
    const consumer = consumersByFactId.get(match.referenceId);
    if (!consumer) continue;
    for (const candidate of match.candidates) {
      const route = routesByFactId.get(candidate.targetId);
      if (!route || route.repoId === consumer.repoId) continue; // cross-repo links only, matching matchContracts' i!==j scope
      links.push({
        providerRepo: route.repoId,
        providerContract: `${route.fact.method} ${route.fact.normalizedPath}`,
        consumerRepo: consumer.repoId,
        consumerContract: `${consumer.fact.filePath}:${consumer.fact.sourceRange.startLine}`,
        matchKind: 'route-match',
        confidence: candidate.confidence,
        providerContractId: candidate.targetId,
        consumerSourceCanonicalId: consumer.fact.factId,
        providerSourceCanonicalId: route.fact.factId,
        callSites: [consumer.fact.factId],
        consumedFields: consumer.fact.consumedKeys,
        certainty: match.certainty === 'exact' ? 'exact' : match.coverage.complete ? 'heuristic' : 'lower-bound',
        coverage: {
          complete: match.coverage.complete,
          examinedCount: match.coverage.emittedCandidates,
          totalKnownCount: match.coverage.totalKnownCandidates,
          incompleteReasons: [...match.coverage.incompleteReasons],
        },
      });
    }
  }
  return links;
}

const PROTOCOL_LINK_KIND: Record<ProtocolKind, LinkKind> = {
  event: 'event-topic-match',
  graphql: 'graphql-operation-match',
  grpc: 'grpc-method-match',
};

function protocolContract(fact: ProtocolFact, member: { repoId: string; repoName: string; repoPath: string; snapshotId: string }): Contract {
  const anchor = `${fact.protocol}:${fact.key}@${fact.filePath}:${fact.line}`;
  return enrichContract({
    repoName: member.repoName,
    repoPath: member.repoPath,
    repositoryId: member.repoId,
    kind: fact.protocol,
    name: fact.key,
    nodeId: fact.symbolId ?? anchor,
    nodeKind: `protocol:${fact.role}`,
    filePath: fact.filePath,
    sourceCanonicalId: `${fact.protocol}:${fact.role}:${fact.key}:${fact.symbolId ?? anchor}`,
    role: fact.role === 'provider' ? 'producer' : 'consumer',
    certainty: fact.symbolId ? 'exact' : 'heuristic',
  }, member.repoId, member.snapshotId);
}

/**
 * Cross-repository protocol links: a provider fact and a consumer fact in different members
 * with the same literal protocol key. Exact only when both endpoint symbols resolved; an
 * unresolved endpoint yields a heuristic link without a consumer contract ID, which the consumer
 * index skips and the system-flow stitcher reports as a candidate.
 */
export function matchProtocolFacts(members: ReadonlyArray<{ repoId: string; repoName: string; repoPath: string; snapshotId: string; facts: readonly ProtocolFact[] }>): { contracts: Contract[]; links: ContractLink[] } {
  type Entry = { fact: ProtocolFact; contract: Contract; repoId: string };
  const contracts: Contract[] = [];
  const providers = new Map<string, Entry[]>();
  const consumers = new Map<string, Entry[]>();
  for (const member of members) {
    for (const fact of member.facts) {
      const contract = protocolContract(fact, member);
      contracts.push(contract);
      const bucket = fact.role === 'provider' ? providers : consumers;
      const bucketKey = `${fact.protocol} ${fact.key}`;
      bucket.set(bucketKey, [...(bucket.get(bucketKey) ?? []), { fact, contract, repoId: member.repoId }]);
    }
  }
  const links: ContractLink[] = [];
  for (const [bucketKey, providerList] of [...providers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const provider of providerList) {
      for (const consumer of consumers.get(bucketKey) ?? []) {
        if (consumer.repoId === provider.repoId) continue;
        const exact = Boolean(provider.fact.symbolId && consumer.fact.symbolId);
        links.push({
          providerRepo: provider.repoId,
          providerContract: provider.fact.key,
          consumerRepo: consumer.repoId,
          consumerContract: `${consumer.fact.filePath}:${consumer.fact.line}`,
          matchKind: PROTOCOL_LINK_KIND[provider.fact.protocol],
          confidence: exact ? 1 : 0.5,
          providerContractId: provider.contract.contractId,
          ...(exact ? { consumerContractId: consumer.contract.contractId } : {}),
          providerSourceCanonicalId: provider.fact.symbolId,
          consumerSourceCanonicalId: consumer.fact.symbolId,
          certainty: exact ? 'exact' : 'heuristic',
          coverage: exact
            ? fullCoverage()
            : { complete: false, examinedCount: 1, incompleteReasons: [provider.fact.unresolvedReason ?? consumer.fact.unresolvedReason ?? 'endpoint symbol unresolved'] },
        });
      }
    }
  }
  return { contracts, links };
}

function matchContracts(allContracts: Contract[]): ContractLink[] {
  const links: ContractLink[] = [];

  // Group contracts by repo. Route contracts are excluded here — they're matched separately
  // by matchRouteConsumersViaFacts using real method/path/consumer evidence, not name equality —
  // and so are protocol-fact contracts (matched by literal protocol key in matchProtocolFacts) and
  // schema-backed GraphQL/gRPC contracts (consumers keyed by canonical identity in
  // protocol-contracts.ts#buildProtocolConsumerRefs).
  const nonRouteContracts = allContracts.filter((c) => c.kind !== 'route' && !c.nodeKind.startsWith('protocol:') && !c.protocol);
  const byRepo = new Map<string, Contract[]>();
  for (const c of nonRouteContracts) {
    const arr = byRepo.get(c.repoName) ?? [];
    arr.push(c);
    byRepo.set(c.repoName, arr);
  }

  const repoNames = [...byRepo.keys()];

  for (let i = 0; i < repoNames.length; i++) {
    for (let j = 0; j < repoNames.length; j++) {
      if (i === j) continue;
      const providerContracts = byRepo.get(repoNames[i])!;
      const consumerContracts = byRepo.get(repoNames[j])!;

      // Build a name map for the consumer
      const consumerByName = new Map<string, Contract>();
      for (const c of consumerContracts) consumerByName.set(c.name, c);

      for (const provider of providerContracts) {
        const consumer = consumerByName.get(provider.name);
        if (consumer) {
          // same-kind matches are more confident; use type-aware similarity for exact name match
          const sameKind = provider.kind === consumer.kind;
          const typedScore = computeContractSimilarity(provider, consumer, 1.0);
          const confidence = sameKind ? Math.max(typedScore, 0.9) : Math.max(typedScore, 0.6);
          links.push({
            providerRepo: provider.repoName,
            providerContract: provider.name,
            consumerRepo: consumer.repoName,
            consumerContract: consumer.name,
            matchKind: 'name-match', // route-kind contracts are excluded above; see matchRouteConsumersViaFacts
            confidence: Math.min(1.0, confidence),
            providerContractId: provider.contractId,
            consumerContractId: consumer.contractId,
            providerSourceCanonicalId: provider.sourceCanonicalId,
            consumerSourceCanonicalId: consumer.sourceCanonicalId,
            certainty: sameKind ? 'exact' : 'heuristic',
            coverage: fullCoverage(),
          });
        } else {
          // partial-name match (camelCase contained)
          const providerLC = provider.name.toLowerCase();
          for (const c of consumerContracts) {
            if (c.name.toLowerCase().includes(providerLC) || providerLC.includes(c.name.toLowerCase())) {
              if (c.name.length >= 4 && provider.name.length >= 4) {
                links.push({
                  providerRepo: provider.repoName,
                  providerContract: provider.name,
                  consumerRepo: c.repoName,
                  consumerContract: c.name,
                  matchKind: 'name-match',
                  confidence: 0.4,
                  providerContractId: provider.contractId,
                  consumerContractId: c.contractId,
                  providerSourceCanonicalId: provider.sourceCanonicalId,
                  consumerSourceCanonicalId: c.sourceCanonicalId,
                  certainty: 'heuristic',
                  coverage: fullCoverage(),
                });
              }
            }
          }
        }
      }
    }
  }

  // Deduplicate: keep highest-confidence for a given (pRepo, pContract, cRepo) triple
  const seen = new Map<string, ContractLink>();
  for (const link of links) {
    const key = `${link.providerRepo}:${link.providerContract}:${link.consumerRepo}:${link.consumerContract}`;
    const existing = seen.get(key);
    if (!existing || link.confidence > existing.confidence) {
      seen.set(key, link);
    }
  }

  return [...seen.values()].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Diffs this sync's contract fingerprints against the previous sync's, so callers (and a future
 * incremental drift pass) can see exactly what changed since the last `group_sync` without
 * recomparing every contract. A missing/incompatible previous result is not a trustworthy
 * baseline, so every current contract is honestly reported as changed rather than silently
 * treated as stable — this is the safe-fallback signal for "legacy/corrupt/unknown" state.
 */
function computeChangedContractIds(
  currentVersions: readonly GroupContractVersion[],
  previousVersions: readonly GroupContractVersion[] | undefined,
): string[] {
  if (!previousVersions) return [...new Set(currentVersions.map((version) => version.contractId))].sort();

  const previousFingerprintById = new Map(previousVersions.map((version) => [version.contractId, version.semanticFingerprint]));
  const currentIds = new Set(currentVersions.map((version) => version.contractId));
  const changed = new Set<string>();
  for (const version of currentVersions) {
    const previousFingerprint = previousFingerprintById.get(version.contractId);
    if (previousFingerprint === undefined || previousFingerprint !== version.semanticFingerprint) {
      changed.add(version.contractId);
    }
  }
  for (const previousId of previousFingerprintById.keys()) {
    if (!currentIds.has(previousId)) changed.add(previousId); // removed contract — still "changed"
  }
  return [...changed].sort();
}

// ─── Main sync function ───────────────────────────────────────────────────────

export async function syncGroup(group: RepoGroup): Promise<GroupSyncResult> {
  const registry = loadRegistry();
  const previousSync = loadSyncResult(group.name);
  const previousVersions = previousSync?.schemaVersion === GROUP_CONTRACT_SCHEMA_VERSION && Array.isArray(previousSync.contractVersions)
    ? previousSync.contractVersions
    : undefined;
  const allContracts: Contract[] = [];
  const contractVersions: GroupContractVersion[] = [];
  const memberGraphs: Array<{ repoId: string; graph: KnowledgeGraph }> = [];
  const memberFacts: Array<{ repoId: string; repositoryName: string; facts: ReturnType<typeof collectGraphFacts> }> = [];
  const protocolMembers: Array<{ repoId: string; repoName: string; repoPath: string; snapshotId: string; facts: ProtocolFact[] }> = [];
  const protocolSnapshots: ProtocolMemberSnapshot[] = [];
  const protocolCoverage: NonNullable<GroupSyncResult['protocolCoverage']> = {};

  for (const member of group.members) {
    // Resolve the actual repo path from the registry
    const regEntry = member.repoId ? findRepoById(member.repoId, registry) : registry.find((r) => r.name === member.registryName);
    if (!regEntry) {
      Logger.warn(`  ⚠ Registry entry "${member.registryName}" not found — skipping ${member.groupPath}`);
      continue;
    }

    const snapshot = resolveIndexSnapshot(regEntry.path);
    if (!snapshot || !fs.existsSync(snapshot.graphDbPath)) {
      Logger.warn(`  ⚠ No index at ${path.join(regEntry.path, '.code-intel', 'graph.db')} — run \`code-intel analyze ${regEntry.path}\` first`);
      continue;
    }

    const dbPath = snapshot.graphDbPath;

    const graph = createKnowledgeGraph();
    const db = new DbManager(dbPath, true);
    try {
      await db.init();
      await loadGraphFromDB(graph, db);
      db.close();
    } catch (err) {
      db.close();
      Logger.warn(`  ⚠ Could not load graph for "${member.registryName}": ${err instanceof Error ? err.message : err}`);
      continue;
    }

    memberGraphs.push({ repoId: regEntry.id, graph });
    memberFacts.push({ repoId: regEntry.id, repositoryName: regEntry.name, facts: collectGraphFacts(graph) });
    const snapshotId = snapshot.generationId === 'legacy' ? `legacy:${regEntry.id}` : snapshot.generationId;
    const contracts: Contract[] = extractContracts(graph, regEntry.name, regEntry.path, regEntry.id, snapshotId).map((contract) => ({
      ...contract,
      repositoryId: regEntry.id,
    }));

    // Schema-file contracts. OpenAPI stays flat; GraphQL/protobuf use the versioned rich model
    // (one contract per GraphQL type / proto service, message and enum) — see protocol-contracts.ts.
    const openapiContracts = await parseOpenAPIContracts(regEntry.path).catch(() => []);
    const sources = readProtocolSources(regEntry.path, graph);
    const protocolSnapshot = extractProtocolSnapshot({ rootDir: regEntry.path, service: regEntry.name, graph });
    protocolSnapshots.push({ repoId: regEntry.id, repoName: regEntry.name, snapshot: protocolSnapshot });
    protocolCoverage[regEntry.id] = {
      graphql: [...protocolSnapshot.graphql.boundaries, ...(protocolSnapshot.graphql.schema?.coverage.boundaryReasons ?? [])].sort(),
      grpc: [...protocolSnapshot.grpc.boundaries, ...protocolSnapshot.grpc.files.flatMap((file) => file.coverage.boundaryReasons.map((reason) => `${file.filePath}:${reason}`))].sort(),
    };
    const protocolMember = { repoName: regEntry.name, repoPath: regEntry.path, repositoryId: regEntry.id, snapshotId };

    for (const c of openapiContracts) {
      contracts.push(enrichContract({
        repoName: regEntry.name,
        repoPath: regEntry.path,
        repositoryId: regEntry.id,
        kind: 'route',
        name: c.name,
        nodeId: `openapi:${c.method}:${c.path}`,
        nodeKind: 'route',
        filePath: c.filePath,
        method: c.method,
        normalizedPath: c.path,
        sourceCanonicalId: `openapi:${c.method}:${c.path}`,
      }, regEntry.id, snapshotId));
    }
    contracts.push(...graphqlContracts(protocolSnapshot, protocolMember), ...grpcContracts(protocolSnapshot, protocolMember));

    protocolMembers.push({
      repoId: regEntry.id,
      repoName: regEntry.name,
      repoPath: regEntry.path,
      snapshotId,
      facts: extractProtocolFacts(sources, buildSymbolSpanIndex(graph)),
    });

    Logger.info(`  ✓ ${regEntry.name} (${member.groupPath}): ${contracts.length} contracts`);
    allContracts.push(...contracts);
    contractVersions.push(...contracts.map((contract) => versionFromContract(contract, regEntry.id)));
  }

  const protocol = matchProtocolFacts(protocolMembers);
  allContracts.push(...protocol.contracts);
  contractVersions.push(...protocol.contracts.map((contract) => versionFromContract(contract, contract.repositoryId!)));
  const links = [...matchContracts(allContracts), ...matchRouteConsumersViaFacts(memberGraphs), ...protocol.links];

  return {
    groupName: group.name,
    syncedAt: new Date().toISOString(),
    memberCount: group.members.length,
    contracts: allContracts,
    links,
    schemaVersion: GROUP_CONTRACT_SCHEMA_VERSION,
    contractVersions,
    changedContractIds: computeChangedContractIds(contractVersions, previousVersions),
    consumerIndex: buildContractConsumerIndex({
      contracts: allContracts,
      links,
      memberFacts,
      protocolConsumers: buildProtocolConsumerRefs(allContracts, protocolSnapshots),
    }),
    protocolCapabilities: [...GRAPHQL_BINDING_CAPABILITIES, ...GRPC_BINDING_CAPABILITIES],
    protocolCoverage,
  };
}
