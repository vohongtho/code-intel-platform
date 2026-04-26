import Parser from 'web-tree-sitter';

export interface QueryCapture {
  name: string;
  node: Parser.SyntaxNode;
  text: string;
}

export function runQuery(
  tree: Parser.Tree,
  language: Parser.Language,
  querySource: string,
): QueryCapture[] {
  const query = language.query(querySource);
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
