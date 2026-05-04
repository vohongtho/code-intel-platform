/**
 * group-query.ts
 * Search execution flows across all repos in a group.
 * Loads each repo's graph, runs text search, and merges via RRF.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { RepoGroup } from './types.js';
import type { SearchResult } from '../search/text-search.js';
import { textSearch, reciprocalRankFusion } from '../search/text-search.js';
import { loadRegistry } from '../storage/repo-registry.js';
import { DbManager } from '../storage/db-manager.js';
import { createKnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadGraphFromDB } from './graph-from-db.js';

export interface GroupQueryResult {
  repoName: string;
  repoPath: string;
  groupPath: string;
  results: SearchResult[];
}

export async function queryGroup(
  group: RepoGroup,
  query: string,
  limit = 20,
): Promise<{ perRepo: GroupQueryResult[]; merged: SearchResult[] }> {
  const registry = loadRegistry();
  const perRepo: GroupQueryResult[] = [];
  const allRankings: SearchResult[][] = [];

  for (const member of group.members) {
    const regEntry = registry.find((r) => r.name === member.registryName);
    if (!regEntry) continue;

    const dbPath = path.join(regEntry.path, '.code-intel', 'graph.db');
    if (!fs.existsSync(dbPath)) continue;

    const graph = createKnowledgeGraph();
    const db = new DbManager(dbPath, true);
    try {
      await db.init();
      await loadGraphFromDB(graph, db);
      db.close();
    } catch {
      db.close();
      continue;
    }

    const results = textSearch(graph, query, limit);
    // Tag each result with repo info via snippet prefix
    const taggedResults: SearchResult[] = results.map((r) => ({
      ...r,
      snippet: `[${member.registryName}] ${r.snippet ?? ''}`.trim(),
    }));

    perRepo.push({
      repoName: member.registryName,
      repoPath: regEntry.path,
      groupPath: member.groupPath,
      results: taggedResults,
    });
    allRankings.push(taggedResults);
  }

  const merged = reciprocalRankFusion(...allRankings).slice(0, limit);
  return { perRepo, merged };
}
