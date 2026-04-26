import { Language } from '../shared/index.js';
import type Parser from 'web-tree-sitter';

export interface FileSet {
  has(filePath: string): boolean;
  resolve(fromDir: string, relativePath: string): string | null;
  findByPackage(packageName: string): string | null;
}

export interface LanguageModule {
  readonly lang: Language;
  readonly fileExtensions: readonly string[];
  readonly queries: string;
  readonly importStyle: 'explicit' | 'wildcard' | 'namespace' | 'include';
  readonly inheritanceStrategy: 'depth-first' | 'c3' | 'mixin-aware' | 'none';
  resolveImport(rawPath: string, fromFile: string, workspace: FileSet): string | null;
  isExported(node: Parser.SyntaxNode): boolean;
  extractType(node: Parser.SyntaxNode): string | null;
}
