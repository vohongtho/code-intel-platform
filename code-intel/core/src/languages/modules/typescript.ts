import { Language } from '../../shared/index.js';
import type Parser from 'web-tree-sitter';
import type { LanguageModule, FileSet } from '../types.js';
import { typescriptQueries } from '../../parsing/queries/typescript.js';
import path from 'node:path';

function resolveRelative(rawPath: string, fromFile: string, workspace: FileSet): string | null {
  const fromDir = path.dirname(fromFile);
  const cleaned = rawPath.replace(/['"]/g, '');
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
  const resolved = workspace.resolve(fromDir, cleaned);
  if (resolved) return resolved;
  for (const ext of extensions) {
    const r = workspace.resolve(fromDir, cleaned + ext);
    if (r) return r;
  }
  return null;
}

export const typescriptModule: LanguageModule = {
  lang: Language.TypeScript,
  fileExtensions: ['.ts', '.tsx', '.mts', '.cts'],
  queries: typescriptQueries,
  importStyle: 'explicit',
  inheritanceStrategy: 'depth-first',

  resolveImport(rawPath: string, fromFile: string, workspace: FileSet): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    if (cleaned.startsWith('.')) {
      return resolveRelative(rawPath, fromFile, workspace);
    }
    return workspace.findByPackage(cleaned);
  },

  isExported(node: Parser.SyntaxNode): boolean {
    const parent = node.parent;
    if (!parent) return false;
    return parent.type === 'export_statement' || node.type === 'export_statement';
  },

  extractType(node: Parser.SyntaxNode): string | null {
    const typeAnnotation = node.childForFieldName('type');
    return typeAnnotation?.text ?? null;
  },
};

export const javascriptModule: LanguageModule = {
  ...typescriptModule,
  lang: Language.JavaScript,
  fileExtensions: ['.js', '.jsx', '.mjs', '.cjs'],
};
