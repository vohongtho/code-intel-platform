import { Language } from '../../shared/index.js';
import type { Node } from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { swiftQueries } from '../../parsing/queries/swift.js';

export const swiftModule: LanguageModule = {
  lang: Language.Swift,
  fileExtensions: ['.swift'],
  queries: swiftQueries,
  importStyle: 'wildcard',
  inheritanceStrategy: 'depth-first',

  resolveImport(rawPath: string, _fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    return workspace.findByPackage(cleaned);
  },

  isExported(node: Node): boolean {
    return !node.text.includes('private') && !node.text.includes('fileprivate');
  },

  extractType(node: Node): string | null {
    const typeAnnotation = node.childForFieldName('type');
    return typeAnnotation?.text ?? null;
  },
};
