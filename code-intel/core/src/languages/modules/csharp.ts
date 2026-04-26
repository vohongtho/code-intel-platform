import { Language } from '../../shared/index.js';
import type { Node } from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { csharpQueries } from '../../parsing/queries/csharp.js';

export const csharpModule: LanguageModule = {
  lang: Language.CSharp,
  fileExtensions: ['.cs'],
  queries: csharpQueries,
  importStyle: 'explicit',
  inheritanceStrategy: 'depth-first',

  resolveImport(rawPath: string, _fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    return workspace.findByPackage(cleaned);
  },

  isExported(node: Node): boolean {
    return node.text.includes('public') || node.text.includes('internal');
  },

  extractType(node: Node): string | null {
    const typeNode = node.childForFieldName('type');
    return typeNode?.text ?? null;
  },
};
