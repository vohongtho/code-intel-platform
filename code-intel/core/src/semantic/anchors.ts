import path from 'node:path';

export interface SourceRange {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface SemanticAnchors {
  identity: SourceRange;
  scope?: SourceRange;
  documentation?: SourceRange;
  render: SourceRange;
}

export function normalizeRepoRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const withoutDot = normalized.replace(/^\.\//, '');
  return path.posix.normalize(withoutDot);
}

export function serializeSourceRange(range: SourceRange): string {
  return [
    normalizeRepoRelativePath(range.filePath),
    `${range.startLine}:${range.startColumn}`,
    `${range.endLine}:${range.endColumn}`,
  ].join('#');
}

export function compareSourceRanges(left: SourceRange, right: SourceRange): number {
  return serializeSourceRange(left).localeCompare(serializeSourceRange(right));
}
