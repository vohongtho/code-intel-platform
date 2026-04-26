/**
 * group-sync.ts
 * Loads each member repo's knowledge graph from its .code-intel/graph.db,
 * extracts contracts (exports, routes, events, schemas), and matches them
 * across repos to produce ContractLinks.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { RepoGroup, Contract, ContractLink, GroupSyncResult } from './types.js';
import { loadRegistry } from '../storage/repo-registry.js';
import { DbManager } from '../storage/db-manager.js';
import { createKnowledgeGraph, type KnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadGraphFromDB } from './graph-from-db.js';

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
      });
    }

    // route nodes → 'route' contracts
    if (node.kind === 'route') {
      contracts.push({
        repoName,
        repoPath,
        kind: 'route',
        name: node.name,
        nodeId: node.id,
        nodeKind: node.kind,
        filePath: node.filePath,
        signature: node.content?.split('\n')[0]?.trim(),
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

function matchContracts(allContracts: Contract[]): ContractLink[] {
  const links: ContractLink[] = [];

  // Group contracts by repo
  const byRepo = new Map<string, Contract[]>();
  for (const c of allContracts) {
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
          // same-kind matches are more confident
          const sameKind = provider.kind === consumer.kind;
          links.push({
            providerRepo: provider.repoName,
            providerContract: provider.name,
            consumerRepo: consumer.repoName,
            consumerContract: consumer.name,
            matchKind: provider.kind === 'route' ? 'route-match' : 'name-match',
            confidence: sameKind ? 0.9 : 0.6,
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

  for (const member of group.members) {
    // Resolve the actual repo path from the registry
    const regEntry = registry.find((r) => r.name === member.registryName);
    if (!regEntry) {
      console.warn(`  ⚠ Registry entry "${member.registryName}" not found — skipping ${member.groupPath}`);
      continue;
    }

    const dbPath = path.join(regEntry.path, '.code-intel', 'graph.db');
    if (!fs.existsSync(dbPath)) {
      console.warn(`  ⚠ No index at ${dbPath} — run \`code-intel analyze ${regEntry.path}\` first`);
      continue;
    }

    const graph = createKnowledgeGraph();
    const db = new DbManager(dbPath);
    try {
      await db.init();
      await loadGraphFromDB(graph, db);
      db.close();
    } catch (err) {
      db.close();
      console.warn(`  ⚠ Could not load graph for "${member.registryName}": ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const contracts = extractContracts(graph, member.registryName, regEntry.path);
    console.log(`  ✓ ${member.registryName} (${member.groupPath}): ${contracts.length} contracts`);
    allContracts.push(...contracts);
  }

  const links = matchContracts(allContracts);

  return {
    groupName: group.name,
    syncedAt: new Date().toISOString(),
    memberCount: group.members.length,
    contracts: allContracts,
    links,
  };
}
