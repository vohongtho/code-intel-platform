import { Language } from '../../shared/index.js';
import type { Node } from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { rubyQueries } from '../../parsing/queries/ruby.js';

export const rubyModule: LanguageModule = {
  lang: Language.Ruby,
  fileExtensions: ['.rb'],
  queries: rubyQueries,
  importStyle: 'wildcard',
  inheritanceStrategy: 'mixin-aware',

  resolveImport(rawPath: string, _fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    return workspace.findByPackage(cleaned + '.rb') ?? workspace.findByPackage(cleaned);
  },

  isExported(_node: Node): boolean {
    return true; // Ruby: methods are public by default
  },

  extractType(_node: Node): string | null {
    return null; // Ruby: dynamic typing
  },
};
