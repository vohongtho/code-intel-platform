import { Language } from '../../shared/index.js';
import type Parser from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { pythonQueries } from '../../parsing/queries/python.js';
import path from 'node:path';

export const pythonModule: LanguageModule = {
  lang: Language.Python,
  fileExtensions: ['.py', '.pyi'],
  queries: pythonQueries,
  importStyle: 'namespace',
  inheritanceStrategy: 'c3',

  resolveImport(rawPath: string, fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    const parts = cleaned.split('.');
    const fromDir = path.dirname(fromFile);

    // Try as relative path
    const relPath = parts.join('/');
    for (const suffix of ['/__init__.py', '.py']) {
      const r = workspace.resolve(fromDir, relPath + suffix);
      if (r) return r;
    }

    // Try as package from root
    return workspace.findByPackage(cleaned);
  },

  isExported(node: Parser.SyntaxNode): boolean {
    // Python: names starting with _ are private by convention
    const name = node.childForFieldName('name');
    if (!name) return true;
    return !name.text.startsWith('_');
  },

  extractType(node: Parser.SyntaxNode): string | null {
    const returnType = node.childForFieldName('return_type');
    return returnType?.text ?? null;
  },
};
