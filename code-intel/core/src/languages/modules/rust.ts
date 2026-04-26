import { Language } from '../../shared/index.js';
import type Parser from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { rustQueries } from '../../parsing/queries/rust.js';

export const rustModule: LanguageModule = {
  lang: Language.Rust,
  fileExtensions: ['.rs'],
  queries: rustQueries,
  importStyle: 'explicit',
  inheritanceStrategy: 'none',

  resolveImport(rawPath: string, _fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    const parts = cleaned.split('::');
    const filePath = parts.join('/') + '.rs';
    return workspace.findByPackage(filePath);
  },

  isExported(node: Parser.SyntaxNode): boolean {
    return node.text.startsWith('pub ') || node.text.startsWith('pub(');
  },

  extractType(node: Parser.SyntaxNode): string | null {
    const returnType = node.childForFieldName('return_type');
    return returnType?.text ?? null;
  },
};
