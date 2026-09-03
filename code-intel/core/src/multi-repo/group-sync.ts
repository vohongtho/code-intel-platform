/**
 * group-sync.ts
 * Loads each member repo's knowledge graph from its .code-intel/graph.db,
 * extracts contracts (exports, routes, events, schemas), and matches them
 * across repos to produce ContractLinks.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { CodeNode } from '../shared/index.js';
import type { RepoGroup, Contract, ContractLink, GroupSyncResult, GroupContractVersion, ContractRole } from './types.js';
import { findRepoById, loadRegistry } from '../storage/repo-registry.js';
import { DbManager } from '../storage/db-manager.js';
import { createKnowledgeGraph, type KnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadGraphFromDB } from './graph-from-db.js';
import Logger from '../shared/logger.js';
import { parseOpenAPIContracts } from './schema-parsers/openapi-parser.js';
import { parseGraphQLContracts } from './schema-parsers/graphql-parser.js';
import { parseProtoContracts } from './schema-parsers/proto-parser.js';
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

function matchContracts(allContracts: Contract[]): ContractLink[] {
  const links: ContractLink[] = [];

  // Group contracts by repo. Route contracts are excluded here — they're matched separately
  // by matchRouteConsumersViaFacts using real method/path/consumer evidence, not name equality.
  const nonRouteContracts = allContracts.filter((c) => c.kind !== 'route');
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

    // Schema-file contracts (OpenAPI, GraphQL, Protobuf)
    const [openapiContracts, graphqlContracts, protoContracts] = await Promise.all([
      parseOpenAPIContracts(regEntry.path).catch(() => []),
      parseGraphQLContracts(regEntry.path).catch(() => []),
      parseProtoContracts(regEntry.path).catch(() => []),
    ]);

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
    for (const c of graphqlContracts) {
      contracts.push(enrichContract({
        repoName: regEntry.name,
        repoPath: regEntry.path,
        repositoryId: regEntry.id,
        kind: 'graphql',
        name: c.name,
        nodeId: `graphql:${c.name}`,
        nodeKind: 'graphql',
        filePath: c.filePath,
        sourceCanonicalId: `graphql:${c.operation}:${c.name}`,
      }, regEntry.id, snapshotId));
    }
    for (const c of protoContracts) {
      contracts.push(enrichContract({
        repoName: regEntry.name,
        repoPath: regEntry.path,
        repositoryId: regEntry.id,
        kind: 'grpc',
        name: c.name,
        nodeId: `grpc:${c.serviceName}:${c.rpcName}`,
        nodeKind: 'grpc',
        filePath: c.filePath,
        sourceCanonicalId: `grpc:${c.serviceName}:${c.rpcName}`,
      }, regEntry.id, snapshotId));
    }

    Logger.info(`  ✓ ${regEntry.name} (${member.groupPath}): ${contracts.length} contracts`);
    allContracts.push(...contracts);
    contractVersions.push(...contracts.map((contract) => versionFromContract(contract, regEntry.id)));
  }

  const links = [...matchContracts(allContracts), ...matchRouteConsumersViaFacts(memberGraphs)];

  return {
    groupName: group.name,
    syncedAt: new Date().toISOString(),
    memberCount: group.members.length,
    contracts: allContracts,
    links,
    schemaVersion: GROUP_CONTRACT_SCHEMA_VERSION,
    contractVersions,
    changedContractIds: computeChangedContractIds(contractVersions, previousVersions),
    consumerIndex: buildContractConsumerIndex({ contracts: allContracts, links, memberFacts }),
  };
}
