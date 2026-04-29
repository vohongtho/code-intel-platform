import { Query } from 'web-tree-sitter';
import type { Node, Tree, Language } from 'web-tree-sitter';

export interface QueryCapture {
  name: string;
  node: Node;
  text: string;
}

export interface QueryMatch {
  patternIndex: number;
  captures: QueryCapture[];
}

// ─── Query compilation cache ──────────────────────────────────────────────────
//
// Compiling a tree-sitter Query from source is expensive (~20-30ms per call).
// Without caching, the parse phase calls `new Query(lang, src)` for EVERY file,
// turning 10k files into ~10k compilations × 20ms = ~200s of pure overhead.
//
// This cache avoids recompilation: one `new Query` per (language, querySource)
// pair per process/worker lifetime — typically 1 per language (3 total for a
// TS+Python+Go repo).
//
// Key: Language instance (singleton from parser-manager's languageCache)
// Value: Map<querySource, compiled Query>
// WeakMap: Language objects won't be GC-pinned by this cache.

const _queryCache = new WeakMap<Language, Map<string, Query>>();

function getOrCompileQuery(language: Language, querySource: string): Query {
  let langMap = _queryCache.get(language);
  if (!langMap) {
    langMap = new Map<string, Query>();
    _queryCache.set(language, langMap);
  }
  let q = langMap.get(querySource);
  if (!q) {
    q = new Query(language, querySource);
    langMap.set(querySource, q);
  }
  return q;
}

// ─────────────────────────────────────────────────────────────────────────────

export function runQuery(
  tree: Tree,
  language: Language,
  querySource: string,
): QueryCapture[] {
  const query = getOrCompileQuery(language, querySource);
  const matches = query.matches(tree.rootNode);
  const captures: QueryCapture[] = [];

  for (const match of matches) {
    for (const capture of match.captures) {
      captures.push({
        name: capture.name,
        node: capture.node,
        text: capture.node.text,
      });
    }
  }

  return captures;
}

/**
 * Return all captures grouped by match, so callers can correlate captures
 * within the same pattern match (e.g. "def.func" + "def.func.name").
 */
export function runQueryMatches(
  tree: Tree,
  language: Language,
  querySource: string,
): QueryMatch[] {
  const query = getOrCompileQuery(language, querySource);
  const raw = query.matches(tree.rootNode);
  return raw.map((m) => ({
    patternIndex: m.patternIndex,
    captures: m.captures.map((c) => ({
      name: c.name,
      node: c.node,
      text: c.node.text,
    })),
  }));
}
