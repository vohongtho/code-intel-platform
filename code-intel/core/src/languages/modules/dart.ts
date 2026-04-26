import { Language } from '../../shared/index.js';
import type { Node } from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { typescriptQueries } from '../../parsing/queries/typescript.js';
import path from 'node:path';

export const dartModule: LanguageModule = {
  lang: Language.Dart,
  fileExtensions: ['.dart'],
  queries: typescriptQueries, // Dart grammar fallback
  importStyle: 'wildcard',
  inheritanceStrategy: 'depth-first',

  resolveImport(rawPath: string, fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    if (cleaned.startsWith('package:')) {
      const pkg = cleaned.replace('package:', '');
      return workspace.findByPackage(pkg);
    }
    const fromDir = path.dirname(fromFile);
    return workspace.resolve(fromDir, cleaned);
  },

  isExported(node: Node): boolean {
    const name = node.childForFieldName('name');
    if (!name) return true;
    return !name.text.startsWith('_');
  },

  extractType(node: Node): string | null {
    const typeNode = node.childForFieldName('type');
    return typeNode?.text ?? null;
  },
};
