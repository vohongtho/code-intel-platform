#!/usr/bin/env node
/**
 * Exclusion scan micro-benchmark.
 * Measures scan-only overhead for exclusion patterns.
 *
 * Usage:
 *   node tests/perf/exclusion-scan-bench.mjs [--files=10000] [--simple=50] [--glob=50]
 *
 * Requires `npx tsc -b tsconfig.test.json --force` first so dist-tests exists.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CORE_DIST = path.join(PKG_ROOT, 'code-intel', 'core', 'dist-tests', 'src', 'index.js').replace(/\\/g, '/');

const args = process.argv.slice(2);
const fileCount = Number(args.find((a) => a.startsWith('--files='))?.split('=')[1] ?? '10000');
const simpleCount = Number(args.find((a) => a.startsWith('--simple='))?.split('=')[1] ?? '50');
const globCount = Number(args.find((a) => a.startsWith('--glob='))?.split('=')[1] ?? '50');

const {
  createKnowledgeGraph,
  runPipeline,
  scanPhase,
} = await import(CORE_DIST);

function makeRepo() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-exclusion-bench-'));
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'scan-exclusion-bench', private: true }, null, 2));

  for (let i = 0; i < fileCount; i++) {
    const bucket = `group${Math.floor(i / 100)}`;
    const dir = path.join(repoDir, 'src', bucket);
    fs.mkdirSync(dir, { recursive: true });
    const fileName = i % 10 === 0 ? `file${i}.generated.ts` : `file${i}.ts`;
    fs.writeFileSync(path.join(dir, fileName), `export const v${i} = ${i};\n`);
  }

  return repoDir;
}

async function runScan(workspaceRoot, opts = {}) {
  const graph = createKnowledgeGraph();
  const context = {
    workspaceRoot,
    graph,
    filePaths: [],
    skipFolders: opts.skipFolders,
    skipFiles: opts.skipFiles,
  };

  const start = performance.now();
  const result = await runPipeline([scanPhase], context);
  const durationMs = performance.now() - start;
  if (!result.success) {
    throw new Error('scan benchmark failed');
  }
  return { durationMs, files: context.filePaths.length };
}

function percentOverhead(actual, baseline) {
  if (baseline === 0) return 0;
  return ((actual - baseline) / baseline) * 100;
}

const repoDir = makeRepo();

const simplePatterns = Array.from({ length: simpleCount }, (_, i) => `skip-dir-${i}`);
const globPatterns = Array.from({ length: globCount }, (_, i) => `**/*pattern${i}*.ts`);

const baseline = await runScan(repoDir);
const simple = await runScan(repoDir, { skipFolders: simplePatterns });
const glob = await runScan(repoDir, { skipFiles: globPatterns });

const report = {
  files: fileCount,
  baselineMs: Number(baseline.durationMs.toFixed(2)),
  simpleExclusionsMs: Number(simple.durationMs.toFixed(2)),
  globExclusionsMs: Number(glob.durationMs.toFixed(2)),
  simpleOverheadPct: Number(percentOverhead(simple.durationMs, baseline.durationMs).toFixed(2)),
  globOverheadPct: Number(percentOverhead(glob.durationMs, baseline.durationMs).toFixed(2)),
  scannedFilesBaseline: baseline.files,
  scannedFilesSimple: simple.files,
  scannedFilesGlob: glob.files,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(report, null, 2));

try {
  fs.rmSync(repoDir, { recursive: true, force: true });
} catch {
  // ignore cleanup errors
}
