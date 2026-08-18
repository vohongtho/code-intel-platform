import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeSourceRange, compareSourceRanges, type SourceRange } from '../../../src/semantic/anchors.js';

function range(filePath: string, startLine: number, startColumn: number, endLine: number, endColumn: number): SourceRange {
  return { filePath, startLine, startColumn, endLine, endColumn };
}

describe('semantic anchors', () => {
  it('serializes repository-relative paths stably', () => {
    assert.equal(
      serializeSourceRange(range('./src\\semantic\\facts.ts', 2, 3, 4, 5)),
      'src/semantic/facts.ts#2:3#4:5',
    );
  });

  it('orders source ranges deterministically', () => {
    const ranges = [
      range('src/b.ts', 1, 0, 1, 4),
      range('src/a.ts', 9, 0, 9, 1),
      range('src/a.ts', 2, 0, 2, 1),
    ];

    ranges.sort(compareSourceRanges);
    assert.deepEqual(ranges.map(serializeSourceRange), [
      'src/a.ts#2:0#2:1',
      'src/a.ts#9:0#9:1',
      'src/b.ts#1:0#1:4',
    ]);
  });
});
