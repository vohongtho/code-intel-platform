import { defineConfig } from 'tsup';

export default defineConfig([
  // Library entry — dist/index.js (bundled single file + types)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'dist',
    dts: {
      resolve: true,
      compilerOptions: {
        composite: false,
        declaration: true,
        declarationMap: true,
        incremental: false,
      },
    },
    sourcemap: true,
    clean: true,
    external: [
      /^node:/,
      '@huggingface/transformers',
      'web-tree-sitter',
      '@ladybugdb/core',
      'express',
      'cors',
      'commander',
      '@modelcontextprotocol/sdk',
      'graphology',
      'graphology-communities-louvain',
      'code-intel-shared',
      '@anthropic-ai/sdk',
      'openai',
      'compression',
    ],
    treeshake: true,
    splitting: false,
  },
  // Hook entry — dist/cli/hook.js (tiny binary, fast startup ~50ms)
  // Imports ONLY hook-rewriter.ts — no OTel, no DB, no graph.
  {
    entry: { 'cli/hook': 'src/cli/hook.ts' },
    format: ['esm'],
    outDir: 'dist',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [/^node:/],
    treeshake: true,
    splitting: false,
  },
  // Search slim entry — dist/cli/search.js (~60 KB, fast startup ~300 ms)
  // Bundles ONLY: commander, better-sqlite3, bm25-index, reranker, text-search.
  // No graph, no pipeline, no HTTP, no auth, no OTel.
  // Requires a pre-built BM25 index (.code-intel/bm25.db). Run `code-intel analyze` first.
  {
    entry: { 'cli/search': 'src/cli/search.ts' },
    format: ['esm'],
    outDir: 'dist',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [
      /^node:/,
      'commander',
      'better-sqlite3',
    ],
    treeshake: true,
    splitting: false,
  },
  // Router entry — dist/cli/router.js (tiny ~1 KB dispatcher, <50 ms parse)
  // Dispatches `search` to the slim search.js; all other commands to main.js.
  {
    entry: { 'cli/router': 'src/cli/router.ts' },
    format: ['esm'],
    outDir: 'dist',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [/^node:/],
    treeshake: true,
    splitting: false,
  },
  // CLI entry — dist/cli/main.js (bundled single file, no types needed)
  {
    entry: { 'cli/main': 'src/cli/main.ts' },
    format: ['esm'],
    outDir: 'dist',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [
      /^node:/,
      '@huggingface/transformers',
      'web-tree-sitter',
      '@ladybugdb/core',
      'express',
      'cors',
      'commander',
      '@modelcontextprotocol/sdk',
      'graphology',
      'graphology-communities-louvain',
      'code-intel-shared',
      '@anthropic-ai/sdk',
      'openai',
      'compression',
    ],
    treeshake: true,
    splitting: false,
  },
]);
