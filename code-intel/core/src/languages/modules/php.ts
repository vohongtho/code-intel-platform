import { Language } from '../../shared/index.js';
import type Parser from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { phpQueries } from '../../parsing/queries/php.js';

export const phpModule: LanguageModule = {
  lang: Language.PHP,
  fileExtensions: ['.php'],
  queries: phpQueries,
  importStyle: 'explicit',
  inheritanceStrategy: 'depth-first',

  resolveImport(rawPath: string, _fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"\\]/g, '/').replace(/^\//, '');
    return workspace.findByPackage(cleaned + '.php');
  },

  isExported(node: Parser.SyntaxNode): boolean {
    return node.text.includes('public') || !node.text.includes('private');
  },

  extractType(node: Parser.SyntaxNode): string | null {
    const typeNode = node.childForFieldName('type');
    return typeNode?.text ?? null;
  },
};
