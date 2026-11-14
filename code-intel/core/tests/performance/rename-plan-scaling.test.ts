/**
 * Rename-plan benchmark on a high-reference symbol (safe-refactoring task 22).
 *
 * A synthetic workspace exports one function that N consumer files import
 * (half directly, half through an `export *` barrel) and reference five times
 * each, next to N unrelated files that the text prefilter must skip without
 * parsing. Only planning is timed: the graph is built directly (file nodes plus
 * the target) so analysis cost does not hide planner scaling.
 *
 * Ceilings are generous (shared CI hardware): they catch super-linear scans or
 * a per-reference re-parse, not small drift. Numbers are logged as `[bench]`.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { buildRenamePlan } from '../../src/refactoring/rename-plan.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-plan-bench-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function workspace(consumers: number) {
  const root = path.join(TMP, `ws-${consumers}`);
  const files: string[] = [];
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
    files.push(file);
  };
  write('src/core/hot.ts', 'export function hotPath(n: number): number {\n  return n + 1;\n}\n');
  write('src/core/index.ts', "export * from './hot.js';\n");
  for (let i = 0; i < consumers; i++) {
    const from = i % 2 === 0 ? '../core/hot.js' : '../core/index.js';
    write(`src/feature${i % 20}/use${i}.ts`, [
      `import { hotPath } from '${from}';`,
      `export function step${i}(x: number): number {`,
      '  const a = hotPath(x);',
      '  const b = hotPath(a) + hotPath(a + 1);',
      '  // hotPath is called a lot here',
      '  return hotPath(b) + hotPath(b * 2);',
      '}',
      '',
    ].join('\n'));
    write(`src/other${i % 20}/noise${i}.ts`, `export function unrelated${i}(v: string): string {\n  return v.trim();\n}\n`);
  }
  const graph = createKnowledgeGraph();
  for (const file of files) graph.addNode({ id: `file:${file}`, kind: 'file', name: path.posix.basename(file), filePath: file });
  graph.addNode({ id: 'function:hotPath@src/core/hot.ts:1', kind: 'function', name: 'hotPath', filePath: 'src/core/hot.ts', startLine: 1, exported: true });
  return { root, graph };
}

async function timePlan(consumers: number) {
  const { root, graph } = workspace(consumers);
  const start = process.hrtime.bigint();
  const result = await buildRenamePlan({ graph, workspaceRoot: root, selector: 'function:hotPath@src/core/hot.ts:1', newName: 'warmPath' });
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(result.status, 'planned');
  if (result.status !== 'planned') throw new Error('unreachable');
  return { elapsed, plan: result.plan };
}

describe('rename plan — high-reference symbol scaling', { timeout: 600_000 }, () => {
  it('plans every exact reference with near-linear cost', async () => {
    await timePlan(10); // warm the parser/grammar
    const sizes = [100, 400, 1600];
    const runs: Array<{ consumers: number; elapsed: number; edits: number }> = [];
    for (const consumers of sizes) {
      const { elapsed, plan } = await timePlan(consumers);
      // Definition + barrel re-export is not an edit (`export *`), so: 1 definition + 6 per consumer.
      assert.equal(plan.edits.length, 1 + consumers * 6, `edits for ${consumers}`);
      assert.equal(plan.applicable, true, JSON.stringify(plan.boundaries.slice(0, 3)));
      assert.equal(plan.occurrences.filter((o) => o.category === 'candidate-text').length, consumers, 'one comment mention per consumer');
      assert.ok(plan.coverage.examinedCount <= consumers + 3, 'unrelated files are prefiltered, not parsed');
      runs.push({ consumers, elapsed, edits: plan.edits.length });
      console.log(`[bench] rename-plan consumers=${consumers} files=${consumers * 2 + 2} edits=${plan.edits.length} ms=${elapsed.toFixed(1)} perEdit=${(elapsed / plan.edits.length).toFixed(3)}`);
    }
    const [, mid, large] = runs;
    // 4× the input must cost well under 4²: allow 2.5× slack over linear for GC/IO noise.
    assert.ok(large.elapsed <= Math.max(mid.elapsed, 50) * 4 * 2.5, `super-linear: ${mid.elapsed.toFixed(0)}ms → ${large.elapsed.toFixed(0)}ms`);
    assert.ok(large.elapsed < 60_000, `1600-consumer plan took ${large.elapsed.toFixed(0)}ms`);
  });
});
