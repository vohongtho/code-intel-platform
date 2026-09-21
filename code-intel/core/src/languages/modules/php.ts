import { Language } from '../../shared/index.js';
import type { Node } from 'web-tree-sitter';
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

  isExported(node: Node): boolean {
    const text = node.text;
    return text.includes('public') && !text.includes('private') && !text.includes('protected');
  },

  extractType(node: Node): string | null {
    const typeNode = node.childForFieldName('type');
    return typeNode?.text ?? null;
  },
};
