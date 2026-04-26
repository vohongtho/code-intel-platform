import { Node, Tree, Language, Query } from 'web-tree-sitter';

export interface QueryCapture {
  name: string;
  node: Node;
  text: string;
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
