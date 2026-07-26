import { Language } from '../../shared/index.js';
import type { Node } from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { htmlQueries } from '../../parsing/queries/html.js';

export const htmlModule: LanguageModule = {
  lang: Language.HTML,
  fileExtensions: ['.html'],
  queries: htmlQueries,
  importStyle: 'include',
  inheritanceStrategy: 'none',

  resolveImport(_rawPath: string, _fromFile: string, _workspace: FileSet): string | null {
    return null;
  },

  isExported(_node: Node): boolean {
    return true;
  },

  extractType(_node: Node): string | null {
    return null;
  },
};
