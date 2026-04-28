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

export function runQuery(
  tree: Tree,
  language: Language,
  querySource: string,
): QueryCapture[] {
  const query = new Query(language, querySource);
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
  const query = new Query(language, querySource);
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
