import { Language } from '../../shared/index.js';
import type { Node } from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { cQueries } from '../../parsing/queries/c.js';
import path from 'node:path';

export const cModule: LanguageModule = {
  lang: Language.C,
  fileExtensions: ['.c', '.h'],
  queries: cQueries,
  importStyle: 'include',
  inheritanceStrategy: 'none',

  resolveImport(rawPath: string, fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/[<>"']/g, '');
    const fromDir = path.dirname(fromFile);
    return workspace.resolve(fromDir, cleaned);
  },

  isExported(_node: Node): boolean {
    return true; // C: all non-static symbols are visible
  },

  extractType(node: Node): string | null {
    const typeNode = node.childForFieldName('type');
    return typeNode?.text ?? null;
  },
};
