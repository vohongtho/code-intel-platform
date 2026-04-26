import { Language } from '../../shared/index.js';
import type Parser from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { cppQueries } from '../../parsing/queries/cpp.js';
import path from 'node:path';

export const cppModule: LanguageModule = {
  lang: Language.Cpp,
  fileExtensions: ['.cpp', '.cxx', '.cc', '.hpp', '.hxx'],
  queries: cppQueries,
  importStyle: 'include',
  inheritanceStrategy: 'depth-first',

  resolveImport(rawPath: string, fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/[<>"']/g, '');
    const fromDir = path.dirname(fromFile);
    return workspace.resolve(fromDir, cleaned);
  },

  isExported(_node: Parser.SyntaxNode): boolean {
    return true;
  },

  extractType(node: Parser.SyntaxNode): string | null {
    const typeNode = node.childForFieldName('type');
    return typeNode?.text ?? null;
  },
};
