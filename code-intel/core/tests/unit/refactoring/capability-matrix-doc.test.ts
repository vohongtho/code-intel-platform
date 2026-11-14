import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFACTORING_CAPABILITIES } from '../../../src/refactoring/contracts.js';

/** Walk up from this file to the repository root (the directory holding docs/). */
function docPath(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, 'docs', 'safe-refactoring-and-architecture-guards.md');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('docs/safe-refactoring-and-architecture-guards.md not found');
    dir = parent;
  }
}

describe('refactoring capability matrix — published doc', () => {
  it('matches REFACTORING_CAPABILITIES row for row', () => {
    const text = fs.readFileSync(docPath(), 'utf8');
    const block = /<!-- capability-matrix:start -->\n([\s\S]*?)\n<!-- capability-matrix:end -->/.exec(text)?.[1];
    assert.ok(block, 'capability-matrix markers missing');
    const expected = [
      '| Language | Rename | Scope / reason |',
      '|---|---|---|',
      ...REFACTORING_CAPABILITIES.map((row) => `| ${row.language} | ${row.rename} | ${[row.scope, row.reason].filter(Boolean).join('; ')} |`),
    ].join('\n');
    assert.equal(block, expected);
  });
});
