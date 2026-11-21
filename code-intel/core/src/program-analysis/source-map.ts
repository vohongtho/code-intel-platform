import type { FunctionIr } from './ir/contracts.js';

export interface ChangedLineRange {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface SourceStatementRef {
  statementId: string;
  startLine: number;
  endLine: number;
  functionId: string;
  filePath: string;
}

export interface SourceMapBoundary {
  kind: 'no-statement-map';
  range: ChangedLineRange;
}

export interface SourceRangeMapResult {
  statementRefs: SourceStatementRef[];
  functionIds: string[];
  boundaries: SourceMapBoundary[];
}

function overlaps(left: ChangedLineRange, right: SourceStatementRef): boolean {
  return left.filePath === right.filePath
    && left.startLine <= right.endLine
    && right.startLine <= left.endLine;
}

/**
 * Maps diff line ranges onto the source ranges already produced by IR
 * lowering. This deliberately performs no source parsing: an unmatched hunk
 * is retained as an explicit boundary rather than interpreted as no impact.
 */
export function mapChangedLineRanges(
  functions: readonly FunctionIr[],
  changedRanges: readonly ChangedLineRange[],
): SourceRangeMapResult {
  const index: SourceStatementRef[] = [];
  for (const ir of functions) {
    for (const statementId of ir.order) {
      const statement = ir.statements[statementId];
      if (!statement) continue;
      index.push({
        statementId,
        startLine: statement.range.startLine,
        endLine: statement.range.endLine,
        functionId: ir.functionId,
        filePath: statement.range.filePath,
      });
    }
  }

  index.sort((a, b) => (
    a.filePath.localeCompare(b.filePath)
    || a.startLine - b.startLine
    || a.endLine - b.endLine
    || a.functionId.localeCompare(b.functionId)
    || a.statementId.localeCompare(b.statementId)
  ));

  const matched = new Map<string, SourceStatementRef>();
  const boundaries: SourceMapBoundary[] = [];
  for (const range of changedRanges) {
    let mapped = false;
    for (const ref of index) {
      if (!overlaps(range, ref)) continue;
      matched.set(`${ref.functionId}\0${ref.statementId}`, ref);
      mapped = true;
    }
    if (!mapped) boundaries.push({ kind: 'no-statement-map', range });
  }

  const statementRefs = [...matched.values()];
  return {
    statementRefs,
    functionIds: [...new Set(statementRefs.map((ref) => ref.functionId))],
    boundaries,
  };
}
