import { Language } from '../../shared/index.js';
import type { Node } from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { javaQueries } from '../../parsing/queries/java.js';

export const javaModule: LanguageModule = {
  lang: Language.Java,
  fileExtensions: ['.java'],
  queries: javaQueries,
  importStyle: 'explicit',
  inheritanceStrategy: 'depth-first',

  resolveImport(rawPath: string, _fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    const filePath = cleaned.replace(/\./g, '/') + '.java';
    return workspace.findByPackage(filePath);
  },

  isExported(node: Node): boolean {
    const text = node.text;
    return text.includes('public');
  },

  extractType(node: Node): string | null {
    const typeNode = node.childForFieldName('type');
    return typeNode?.text ?? null;
  },
};
