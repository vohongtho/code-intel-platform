import { Language } from '../../shared/index.js';
import type Parser from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { goQueries } from '../../parsing/queries/go.js';

export const goModule: LanguageModule = {
  lang: Language.Go,
  fileExtensions: ['.go'],
  queries: goQueries,
  importStyle: 'wildcard',
  inheritanceStrategy: 'depth-first',

  resolveImport(rawPath: string, _fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    return workspace.findByPackage(cleaned);
  },

  isExported(node: Parser.SyntaxNode): boolean {
    const name = node.childForFieldName('name');
    if (!name) return false;
    const first = name.text[0];
    return first === first.toUpperCase() && first !== first.toLowerCase();
  },

  extractType(node: Parser.SyntaxNode): string | null {
    const typeNode = node.childForFieldName('type');
    return typeNode?.text ?? null;
  },
};
