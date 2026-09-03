/**
 * group-sync.ts
 * Loads each member repo's knowledge graph from its .code-intel/graph.db,
 * extracts contracts (exports, routes, events, schemas), and matches them
 * across repos to produce ContractLinks.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { RepoGroup, Contract, ContractLink, GroupSyncResult } from './types.js';
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

// ─── Extract contracts from a single repo's graph ────────────────────────────

function extractContracts(
  graph: KnowledgeGraph,
  repoName: string,
  repoPath: string,
): Contract[] {
  const contracts: Contract[] = [];

  for (const node of graph.allNodes()) {
    // exported symbols → 'export' contracts
    if (
      node.exported === true &&
      ['function', 'class', 'interface', 'method', 'type_alias', 'constant', 'enum', 'struct', 'trait'].includes(node.kind)
    ) {
      contracts.push({
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
      });
    }

    // route nodes → 'route' contracts. When the route carries API-contract evidence
    // (HttpRouteFact via graph-projector.ts), attach method/normalizedPath so matching can use
    // real evidence instead of name equality/substring — see matchRouteConsumersViaFacts.
    if (node.kind === 'route') {
      const routeFact = routeFactFromNode(node);
      contracts.push({
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
      });
    }

    // interfaces / type aliases with "event" or "schema" in name → schema/event contracts
    if (['interface', 'type_alias'].includes(node.kind)) {
      const nameLower = node.name.toLowerCase();
      if (nameLower.includes('event') || nameLower.includes('message')) {
        contracts.push({
          repoName,
          repoPath,
          kind: 'event',
          name: node.name,
          nodeId: node.id,
          nodeKind: node.kind,
          filePath: node.filePath,
        });
      } else if (nameLower.includes('schema') || nameLower.includes('dto') || nameLower.includes('request') || nameLower.includes('response')) {
        contracts.push({
          repoName,
          repoPath,
          kind: 'schema',
          name: node.name,
          nodeId: node.id,
          nodeKind: node.kind,
          filePath: node.filePath,
        });
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

// ─── Main sync function ───────────────────────────────────────────────────────

export async function syncGroup(group: RepoGroup): Promise<GroupSyncResult> {
  const registry = loadRegistry();
  const allContracts: Contract[] = [];
  const memberGraphs: Array<{ repoId: string; graph: KnowledgeGraph }> = [];

  for (const member of group.members) {
    // Resolve the actual repo path from the registry
    const regEntry = member.repoId ? findRepoById(member.repoId, registry) : registry.find((r) => r.name === member.registryName);
    if (!regEntry) {
      Logger.warn(`  ⚠ Registry entry "${member.registryName}" not found — skipping ${member.groupPath}`);
      continue;
    }

    const dbPath = path.join(regEntry.path, '.code-intel', 'graph.db');
    if (!fs.existsSync(dbPath)) {
      Logger.warn(`  ⚠ No index at ${dbPath} — run \`code-intel analyze ${regEntry.path}\` first`);
      continue;
    }

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

    memberGraphs.push({ repoId: regEntry.name, graph });
    const contracts = extractContracts(graph, regEntry.name, regEntry.path);

    // Schema-file contracts (OpenAPI, GraphQL, Protobuf)
    const [openapiContracts, graphqlContracts, protoContracts] = await Promise.all([
      parseOpenAPIContracts(regEntry.path).catch(() => []),
      parseGraphQLContracts(regEntry.path).catch(() => []),
      parseProtoContracts(regEntry.path).catch(() => []),
    ]);

    for (const c of openapiContracts) {
      contracts.push({
        repoName: regEntry.name,
        repoPath: regEntry.path,
        kind: 'route',
        name: c.name,
        nodeId: `openapi:${c.method}:${c.path}`,
        nodeKind: 'route',
        filePath: c.filePath,
      });
    }
    for (const c of graphqlContracts) {
      contracts.push({
        repoName: regEntry.name,
        repoPath: regEntry.path,
        kind: 'graphql',
        name: c.name,
        nodeId: `graphql:${c.name}`,
        nodeKind: 'graphql',
        filePath: c.filePath,
      });
    }
    for (const c of protoContracts) {
      contracts.push({
        repoName: regEntry.name,
        repoPath: regEntry.path,
        kind: 'grpc',
        name: c.name,
        nodeId: `grpc:${c.serviceName}:${c.rpcName}`,
        nodeKind: 'grpc',
        filePath: c.filePath,
      });
    }

    Logger.info(`  ✓ ${regEntry.name} (${member.groupPath}): ${contracts.length} contracts`);
    allContracts.push(...contracts);
  }

  const links = [...matchContracts(allContracts), ...matchRouteConsumersViaFacts(memberGraphs)];

  return {
    groupName: group.name,
    syncedAt: new Date().toISOString(),
    memberCount: group.members.length,
    contracts: allContracts,
    links,
  };
}
