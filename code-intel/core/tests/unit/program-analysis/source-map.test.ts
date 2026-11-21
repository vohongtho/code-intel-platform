import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Language } from '../../../src/shared/languages.js';
import type { FunctionIr, IrStatement } from '../../../src/program-analysis/ir/contracts.js';
import { mapChangedLineRanges } from '../../../src/program-analysis/source-map.js';

function statement(id: string, functionId: string, startLine: number, endLine = startLine): IrStatement {
  return {
    id,
    functionId,
    kind: 'unknown',
    range: {
      filePath: '/src/index.ts',
      startLine,
      startColumn: 0,
      endLine,
      endColumn: 20,
    },
    expressions: [],
    targets: [],
    children: [],
  };
}

function ir(functionId: string, statements: IrStatement[]): FunctionIr {
  return {
    version: 'ir-v1',
    functionId,
    language: Language.TypeScript,
    entryStatementId: statements[0]?.id ?? null,
    statements: Object.fromEntries(statements.map((item) => [item.id, item])),
    expressions: {},
    order: statements.map((item) => item.id),
    truncated: false,
  };
}

describe('program-analysis source-range mapping', () => {
  it('maps a changed line inside a multiline statement', () => {
    const fn = ir('fn:multi', [statement('stmt:multi', 'fn:multi', 2, 5)]);
    const result = mapChangedLineRanges([fn], [{ filePath: '/src/index.ts', startLine: 4, endLine: 4 }]);

    assert.deepEqual(result.statementRefs.map((ref) => ref.statementId), ['stmt:multi']);
    assert.deepEqual(result.functionIds, ['fn:multi']);
    assert.deepEqual(result.boundaries, []);
  });

  it('reports comments or whitespace between statements as an explicit no-map boundary', () => {
    const fn = ir('fn:comments', [
      statement('stmt:before', 'fn:comments', 2),
      statement('stmt:after', 'fn:comments', 5),
    ]);
    const changed = { filePath: '/src/index.ts', startLine: 3, endLine: 4 };
    const result = mapChangedLineRanges([fn], [changed]);

    assert.deepEqual(result.statementRefs, []);
    assert.deepEqual(result.functionIds, []);
    assert.deepEqual(result.boundaries, [{ kind: 'no-statement-map', range: changed }]);
  });

  it('keeps both owning functions when nested-function ranges overlap', () => {
    const outer = ir('fn:outer', [statement('stmt:outer', 'fn:outer', 1, 10)]);
    const inner = ir('fn:inner', [statement('stmt:inner', 'fn:inner', 5)]);
    const result = mapChangedLineRanges([outer, inner], [{ filePath: '/src/index.ts', startLine: 5, endLine: 5 }]);

    assert.deepEqual(result.statementRefs.map((ref) => ref.statementId), ['stmt:outer', 'stmt:inner']);
    assert.deepEqual(result.functionIds, ['fn:outer', 'fn:inner']);
  });

  it('maps every IR statement sharing one changed source line', () => {
    const fn = ir('fn:same-line', [
      statement('stmt:first', 'fn:same-line', 7),
      statement('stmt:second', 'fn:same-line', 7),
    ]);
    const result = mapChangedLineRanges([fn], [{ filePath: '/src/index.ts', startLine: 7, endLine: 7 }]);

    assert.deepEqual(result.statementRefs.map((ref) => ref.statementId), ['stmt:first', 'stmt:second']);
    assert.deepEqual(result.functionIds, ['fn:same-line']);
  });

  it('reports a no-map boundary when no lowered function covers the changed file', () => {
    const fn = ir('fn:other', [statement('stmt:other', 'fn:other', 1)]);
    const changed = { filePath: '/src/missing.ts', startLine: 1, endLine: 2 };
    const result = mapChangedLineRanges([fn], [changed]);

    assert.deepEqual(result.statementRefs, []);
    assert.deepEqual(result.boundaries, [{ kind: 'no-statement-map', range: changed }]);
  });
});
