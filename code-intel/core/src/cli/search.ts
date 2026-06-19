/**
 * search.ts — Slim standalone entry for `code-intel search`.
 *
 * Bundle target: ~30 KB vs 800 KB for main.js → fast startup.
 *
 * Dependencies: commander, better-sqlite3, bm25-searcher, reranker.
 * No winston, no OTel, no graph, no pipeline, no HTTP, no auth.
 *
 * This file is invoked by dist/cli/router.js with argv starting at the query:
 *   node search.js <query> [--limit N] [--path P] [--no-rerank]
 * ("search" has already been consumed by the router.)
 */

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { Bm25Searcher, getBm25DbPath } from '../search/bm25-searcher.js';
import { rerank } from '../search/reranker.js';
import type { SearchResult } from '../search/text-search.js';

const program = new Command();

program
  .name('code-intel search')
  .description('Search the knowledge graph for symbols matching a query')
  .argument('<query>', 'Search query (name, kind, or partial match)')
  .option('-l, --limit <n>', 'Maximum number of results', '20')
  .option('-p, --path <path>', 'Path to the repository (default: current directory)', '.')
  .option('--no-rerank', 'Disable post-retrieval re-ranking (show raw BM25 order)')
  .addHelpText('after', `
  Runs BM25 text search across all indexed symbols — functions, classes,
  files, routes, interfaces, and more.  Results are re-ranked by default
  using name-affinity, snippet coverage, symbol kind, and path quality.

  Examples:
    $ code-intel search "handleRequest"
    $ code-intel search "auth" --limit 10
    $ code-intel search "UserService" --path ./backend
    $ code-intel search "auth" --no-rerank   # raw BM25 order for comparison
`)
  .action((query: string, opts: { limit: string; path: string; rerank: boolean }) => {
    const limitN         = parseInt(opts.limit, 10);
    const workspaceRoot  = path.resolve(opts.path);
    const rerankDisabled = opts.rerank === false;

    const bm25DbPath = getBm25DbPath(workspaceRoot);

    if (!fs.existsSync(bm25DbPath)) {
      console.error(`\n  No search index found. Run: code-intel analyze\n`);
      process.exit(1);
    }

    const idx = new Bm25Searcher(bm25DbPath);
    idx.load();

    if (!idx.isLoaded) {
      console.error(`\n  Search index could not be loaded. Run: code-intel analyze\n`);
      process.exit(1);
    }

    // Fetch 3× limit so re-ranker has room to reorder
    const candidates: SearchResult[] = idx.search(query, limitN * 3);
    const results = rerankDisabled
      ? candidates.slice(0, limitN)
      : rerank(query, candidates).slice(0, limitN);

    if (results.length === 0) {
      console.log(`\n  No results found for "${query}".\n`);
      return;
    }

    const label = rerankDisabled ? 'bm25 (re-ranking off)' : 'bm25 (re-ranked)';
    console.log(`\n  ${results.length} result(s) for "${query}" [${label}]:\n`);
    for (const r of results) {
      console.log(`  ${r.kind.padEnd(14)} ${r.name.padEnd(32)} ${r.filePath}`);
    }
    console.log('');
  });

// argv starts at the query argument (router already consumed "search")
program.parse();
