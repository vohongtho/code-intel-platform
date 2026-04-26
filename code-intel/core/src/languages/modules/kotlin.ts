import { Language } from '../../shared/index.js';
import type { Node } from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { kotlinQueries } from '../../parsing/queries/kotlin.js';

export const kotlinModule: LanguageModule = {
  lang: Language.Kotlin,
  fileExtensions: ['.kt', '.kts'],
  queries: kotlinQueries,
  importStyle: 'explicit',
  inheritanceStrategy: 'depth-first',

  resolveImport(rawPath: string, _fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    const filePath = cleaned.replace(/\./g, '/') + '.kt';
    return workspace.findByPackage(filePath);
  },

  isExported(node: Node): boolean {
    return !node.text.includes('private') && !node.text.includes('internal');
  },

  extractType(node: Node): string | null {
    const typeNode = node.childForFieldName('type');
    return typeNode?.text ?? null;
  },
};
