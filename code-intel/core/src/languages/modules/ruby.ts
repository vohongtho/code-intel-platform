import { Language } from '../../shared/index.js';
import type Parser from 'web-tree-sitter';
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

  isExported(_node: Parser.SyntaxNode): boolean {
    return true; // Ruby: methods are public by default
  },

  extractType(_node: Parser.SyntaxNode): string | null {
    return null; // Ruby: dynamic typing
  },
};
