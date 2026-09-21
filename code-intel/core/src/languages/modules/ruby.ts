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

  isExported(node: Node): boolean {
    let prev = node.previousSibling;
    while (prev) {
      if (prev.type === 'identifier' && prev.text.trim() === 'private') return false;
      if (prev.type === 'method' || prev.type === 'singleton_method' || prev.type === 'class' || prev.type === 'module') break;
      prev = prev.previousSibling;
    }
    return true;
  },

  extractType(_node: Node): string | null {
    return null; // Ruby: dynamic typing
  },
};
