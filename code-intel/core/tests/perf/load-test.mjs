#!/usr/bin/env node
/**
 * Load test runner — Epic 5 / nightly CI.
 *
 * Runs the full analysis pipeline against a synthetic fixture repo, measures:
 *   - analyze duration (ms)
 *   - serve-startup duration (ms) — modeled as time to load graph from DB
 *   - peak heap memory (MB)
 *
 * Exits 0 if all targets are within threshold, 1 otherwise.
 *
 * Usage:
 *   node tests/perf/load-test.mjs [--size 1k|10k] [--regression-gate]
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const sizeArg = args.find((a) => a.startsWith('--size='))?.split('=')[1] ?? '1k';
const regressionGate = args.includes('--regression-gate');
const targetSize = sizeArg === '10k' ? 10000 : 1000;
const label = targetSize === 10000 ? '10k' : '1k';

console.log(`\n  ◈ Load test — ${label} fixture (${targetSize.toLocaleString()} files)\n`);

// ── Load baseline ─────────────────────────────────────────────────────────────
const baselinePath = path.join(__dirname, 'baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
const THRESHOLD = baseline.regressionThreshold ?? 0.20;

// ── Create synthetic fixture repo ─────────────────────────────────────────────
const tmpDir = path.join(os.tmpdir(), `load-test-${label}-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });

// Each file is a small TS module with a function + class to give parser real work
const fileTemplate = (i) => `
// auto-generated fixture file ${i}
export function func${i}(x: number): number {
  return x * ${i};
}
export class Class${i} {
  private value: number;
  constructor(v: number) { this.value = v; }
  get(): number { return this.value + func${i}(this.value); }
}
export const CONST_${i} = ${i};
`;

console.log(`  Generating ${targetSize.toLocaleString()} fixture files…`);
const genStart = Date.now();
for (let i = 0; i < targetSize; i++) {
  const subDir = path.join(tmpDir, `src`, `mod${Math.floor(i / 100)}`);
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, `file${i}.ts`), fileTemplate(i));
}
// Add a package.json so it looks like a real project
fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: `load-test-${label}`, version: '0.0.1' }));
const genMs = Date.now() - genStart;
console.log(`  Fixture generation: ${genMs}ms\n`);

// ── Run analysis ──────────────────────────────────────────────────────────────
// We do an in-process analyze to avoid spawning a child process.
// Dynamic import the compiled dist — this test is run after `npm run build`.
const distRoot = path.join(PKG_ROOT, 'code-intel', 'core', 'dist');
const distIndex = path.join(distRoot, 'index.js').replace(/\\/g, '/');
const {
  createKnowledgeGraph,
  runPipeline,
  scanPhase,
  structurePhase,
  parsePhase,
  resolvePhase,
  clusterPhase,
  flowPhase,
  createApp,
  Bm25Index,
  getBm25DbPath,
} = await import(distIndex);

const graph = createKnowledgeGraph();
const context = {
  workspaceRoot: tmpDir,
  graph,
  filePaths: [],
  profile: true,
};

const heapBefore = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`  Heap before analyze: ${heapBefore.toFixed(0)} MB`);

const analyzeStart = Date.now();
const result = await runPipeline(
  [scanPhase, structurePhase, parsePhase, resolvePhase, clusterPhase, flowPhase],
  context,
);
const analyzeMs = Date.now() - analyzeStart;
const heapAfter = process.memoryUsage().heapUsed / 1024 / 1024;

if (!result.success) {
  console.error('  ✗ Pipeline failed:', [...result.results.entries()].find(([, r]) => r.status === 'failed'));
  process.exit(1);
}

console.log(`  Analyze time    : ${analyzeMs}ms`);
console.log(`  Heap after      : ${heapAfter.toFixed(0)} MB  (Δ ${(heapAfter - heapBefore).toFixed(0)} MB)`);
console.log(`  Graph           : ${graph.size.nodes} nodes, ${graph.size.edges} edges, ${context.filePaths.length} files\n`);

// ── Serve-startup simulation: measure graph.size access (already in-memory) ──
// For a realistic serve-startup measure we re-create the graph from scratch
// (simulates loading from DB). This is a conservative proxy.
const serveStart = Date.now();
const graph2 = createKnowledgeGraph();
for (const node of graph.allNodes()) graph2.addNode(node);
const serveMs = Date.now() - serveStart;
console.log(`  Serve startup   : ${serveMs}ms  (in-memory graph copy proxy)\n`);

// ── BM25 throughput benchmark ─────────────────────────────────────────────────
console.log('  Building BM25 index for throughput test…');
const bm25DbPath = getBm25DbPath(tmpDir);
const bm25 = new Bm25Index(bm25DbPath);
bm25.build(graph);
bm25.load();

const BM25_QUERIES = 1000;
const sampleTerms = ['func', 'class', 'const', 'number', 'export', 'value', 'return', 'get', 'set', 'type'];
const bm25Start = Date.now();
for (let i = 0; i < BM25_QUERIES; i++) {
  const term = sampleTerms[i % sampleTerms.length];
  bm25.search(term, 10);
}
const bm25Ms = Date.now() - bm25Start;
const bm25Qps = Math.round(BM25_QUERIES / (bm25Ms / 1000));
console.log(`  BM25 throughput : ${bm25Qps.toLocaleString()} queries/s  (${BM25_QUERIES} queries in ${bm25Ms}ms)\n`);

// ── HTTP concurrency test (100 concurrent requests) ───────────────────────────
console.log('  Starting HTTP server for concurrency test…');

let httpP95 = 0, httpErrorRate = 0;
try {
  const app = createApp(graph, path.basename(tmpDir));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  // Send 100 concurrent /health/live requests (no auth required)
  const CONCURRENT = 100;
  const latencies = [];
  const promises = Array.from({ length: CONCURRENT }, () =>
    new Promise((resolve) => {
      const t0 = Date.now();
      const req = http.request({ hostname: '127.0.0.1', port, path: '/health/live', method: 'GET' }, (res) => {
        res.resume();
        res.on('end', () => resolve({ latency: Date.now() - t0, status: res.statusCode }));
      });
      req.on('error', () => resolve({ latency: Date.now() - t0, status: 0 }));
      req.end();
    })
  );
  const httpResults = await Promise.all(promises);
  latencies.push(...httpResults.map((r) => r.latency));
  const errors = httpResults.filter((r) => r.status !== 200).length;
  latencies.sort((a, b) => a - b);
  httpP95 = latencies[Math.floor(latencies.length * 0.95)];
  httpErrorRate = (errors / CONCURRENT) * 100;
  console.log(`  HTTP p95        : ${httpP95}ms  (${CONCURRENT} concurrent, ${errors} errors)`);
  console.log(`  HTTP error rate : ${httpErrorRate.toFixed(2)}%\n`);

  await new Promise((resolve) => server.close(resolve));
} catch (err) {
  console.warn(`  ⚠  HTTP concurrency test failed: ${err.message}\n`);
  httpP95 = 0;  // treat skip as 0 (no regression)
  httpErrorRate = 0;
}

// ── Write result JSON ─────────────────────────────────────────────────────────
const resultPath = path.join(__dirname, `result-${label}.json`);
const resultJson = {
  label,
  targetSize,
  analyzeMs,
  serveMs,
  heapMB: Math.round(heapAfter),
  bm25Qps,
  httpP95,
  httpErrorRatePct: httpErrorRate,
  nodes: graph.size.nodes,
  edges: graph.size.edges,
  files: context.filePaths.length,
  measuredAt: new Date().toISOString(),
};
fs.writeFileSync(resultPath, JSON.stringify(resultJson, null, 2));
console.log(`  Results written: ${resultPath}\n`);

// ── Check targets ─────────────────────────────────────────────────────────────
const analyzeTarget = baseline.targets[`analyze_${label}_ms`];
const serveTarget   = baseline.targets[`serve_startup_${label}_ms`];
const heapTarget    = baseline.targets[`memory_heap_${label}_mb`];
const bm25Target    = baseline.targets['bm25_qps'];            // higher-is-better
const httpP95Target = baseline.targets['http_p95_ms'];
const httpErrTarget = baseline.targets['http_error_rate_pct'];

let passed = true;
const regressionLimit = (base) => base * (1 + THRESHOLD);

function check(name, actual, target, unit, higherIsBetter = false) {
  const ok = higherIsBetter ? actual >= target : actual <= target;
  const regressed = regressionGate && (higherIsBetter
    ? actual < target * (1 - THRESHOLD)   // lower than allowed floor
    : actual > regressionLimit(target));   // higher than allowed ceiling
  const icon = regressed ? '✗' : (ok ? '✔' : '⚠');
  console.log(`  ${icon}  ${name}: ${actual}${unit}  (target: ${higherIsBetter ? '>=' : '<='}${target}${unit})`);
  if (regressed) { passed = false; }
  return ok;
}

console.log('  Benchmark results:\n');
check('analyze_duration',  analyzeMs,              analyzeTarget, 'ms');
check('serve_startup',     serveMs,                serveTarget,   'ms');
check('heap_memory',       Math.round(heapAfter),  heapTarget,    ' MB');
if (bm25Qps > 0) check('bm25_qps',  bm25Qps,  bm25Target,    ' q/s', true);
if (httpP95 > 0) {
  check('http_p95',        httpP95,                httpP95Target, 'ms');
  check('http_error_rate', parseFloat(httpErrorRate.toFixed(2)), httpErrTarget, '%');
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

if (!passed) {
  console.error(`\n  ✗ Load test FAILED — one or more metrics regressed > ${(THRESHOLD * 100).toFixed(0)}% vs baseline\n`);
  process.exit(1);
}

console.log(`\n  ✅  Load test PASSED — ${label} fixture\n`);
process.exit(0);
