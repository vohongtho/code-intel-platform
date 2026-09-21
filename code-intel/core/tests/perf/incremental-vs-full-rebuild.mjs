#!/usr/bin/env node
/**
 * incremental-vs-full-rebuild.mjs
 *
 * Ad hoc performance comparison for the v1-0-11-dependency-aware-incremental-resolution
 * change: measures wall-clock time for a full rebuild vs. a single-file
 * incremental edit against synthetic TypeScript workspaces of increasing
 * size, using the real fact adapter + resolution pipeline (via the
 * convergence harness built for this change's integration tests).
 *
 * This is a diagnostic script, not a CI gate: production incremental
 * publication stays disabled (see rollout-gate.ts), so these numbers
 * characterize the mechanism's performance, not a currently-shipping path.
 *
 * Run: node --loader ... not needed; compiled JS is imported directly.
 *   cd code-intel/core && npx tsc -b tsconfig.test.json && node tests/perf/incremental-vs-full-rebuild.mjs
 */
import { createEvidenceStore } from '../../dist-tests/src/evidence/store.js';
import {
  buildInitialState,
  applyIncrementalEdit,
  runFullRebuild,
} from '../../dist-tests/tests/integration/incremental/convergence-harness.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function buildWorkspace(fileCount) {
  const files = {};
  for (let i = 0; i < fileCount; i += 1) {
    files[`module${i}.ts`] = [
      `export class Widget${i} { }`,
      `export function helper${i}(): void { }`,
      i > 0 ? `import { Widget${i - 1} } from './module${i - 1}.js';` : '',
    ].filter(Boolean).join('\n');
  }
  return files;
}

function timeMs(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const end = process.hrtime.bigint();
  return { result, ms: Number(end - start) / 1e6 };
}

function runOnce(fileCount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-incr-'));
  try {
    const evidence = createEvidenceStore(dir);
    const files = buildWorkspace(fileCount);

    const { result: initialState, ms: fullBuildMs } = timeMs(() => buildInitialState(files, evidence));

    const editedFile = `module${Math.floor(fileCount / 2)}.ts`;
    const edited = { ...files, [editedFile]: `${files[editedFile]}\n// touched` };

    const { result: incrementalResult, ms: incrementalMs } = timeMs(() =>
      applyIncrementalEdit(initialState, evidence, { changedFiles: { [editedFile]: edited[editedFile] } }));

    const { ms: freshFullRebuildMs } = timeMs(() => runFullRebuild(edited, evidence));

    evidence.close();

    return {
      fileCount,
      fullBuildMs: Number(fullBuildMs.toFixed(2)),
      incrementalEditMs: Number(incrementalMs.toFixed(2)),
      freshFullRebuildOfEditedTreeMs: Number(freshFullRebuildMs.toFixed(2)),
      requiresFullResolution: incrementalResult.delta.requiresFullResolution,
      speedup: Number((freshFullRebuildMs / incrementalMs).toFixed(1)),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function runMedian(fileCount, repeats = 3) {
  const attempts = Array.from({ length: repeats }, () => runOnce(fileCount));
  return {
    fileCount,
    fullBuildMs: median(attempts.map((a) => a.fullBuildMs)),
    incrementalEditMs: median(attempts.map((a) => a.incrementalEditMs)),
    freshFullRebuildOfEditedTreeMs: median(attempts.map((a) => a.freshFullRebuildOfEditedTreeMs)),
    requiresFullResolution: attempts[0].requiresFullResolution,
    speedup: Number((median(attempts.map((a) => a.freshFullRebuildOfEditedTreeMs)) / median(attempts.map((a) => a.incrementalEditMs))).toFixed(1)),
  };
}

// Warm up the JIT before taking measurements — the first run of any size is
// consistently an outlier (cold V8 optimization), not a real signal.
runOnce(200);

const sizes = [50, 200, 1000, 4000];
const rows = sizes.map((size) => runMedian(size));

console.log('file_count | full_rebuild_ms | incremental_edit_ms | fresh_full_rebuild_of_edited_tree_ms | speedup | fallback');
for (const row of rows) {
  console.log(
    `${row.fileCount}`.padEnd(11)
    + '| ' + `${row.fullBuildMs}`.padEnd(16)
    + '| ' + `${row.incrementalEditMs}`.padEnd(21)
    + '| ' + `${row.freshFullRebuildOfEditedTreeMs}`.padEnd(38)
    + '| ' + `${row.speedup}x`.padEnd(8)
    + '| ' + row.requiresFullResolution,
  );
}

fs.writeFileSync(
  path.join(path.dirname(new URL(import.meta.url).pathname), 'incremental-vs-full-rebuild-result.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
);
