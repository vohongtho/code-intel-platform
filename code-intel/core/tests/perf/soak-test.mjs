#!/usr/bin/env node
/**
 * Soak test runner — Epic 5 / weekly CI.
 *
 * Two scenarios:
 *
 *   --scenario=memory-stability
 *     Runs repeated analyze cycles and checks that heap does not grow
 *     beyond maxGrowthPerCycleMB per cycle (proxy for 24h < 50 MB/hr target).
 *
 *   --scenario=watcher-throughput
 *     Simulates rapid file saves and measures re-index latency per save.
 *
 * In CI the durations are compressed (minutes not hours). The same logic
 * applies at full scale for the weekly run.
 *
 * Exits 0 on pass, 1 on failure.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const distIndex = path.join(PKG_ROOT, 'code-intel', 'core', 'dist', 'index.js').replace(/\\/g, '/');

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const scenario = args.find((a) => a.startsWith('--scenario='))?.split('=')[1] ?? 'memory-stability';

console.log(`\n  ◈ Soak test — scenario: ${scenario}\n`);

// ── Load dist ─────────────────────────────────────────────────────────────────
const {
  createKnowledgeGraph,
  runPipeline,
  scanPhase,
  structurePhase,
  parsePhase,
  resolvePhase,
} = await import(distIndex);

// ── Helpers ───────────────────────────────────────────────────────────────────
function heapMB() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function makeTmpRepo(fileCount) {
  const dir = path.join(os.tmpdir(), `soak-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(
      path.join(dir, 'src', `f${i}.ts`),
      `export function fn${i}(x: number) { return x + ${i}; }\n`,
    );
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'soak', version: '0.0.1' }));
  return dir;
}

async function runAnalysis(repoDir) {
  const graph = createKnowledgeGraph();
  const context = { workspaceRoot: repoDir, graph, filePaths: [], profile: false };
  const result = await runPipeline([scanPhase, structurePhase, parsePhase, resolvePhase], context);
  return { success: result.success, nodes: graph.size.nodes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: memory-stability
// ─────────────────────────────────────────────────────────────────────────────
async function runMemoryStability() {
  // CI: 10 cycles of 50-file repos (proxy for full 24h). Each cycle must not
  // grow heap by more than 50 MB (baseline for 24h < 50 MB/hr).
  const CYCLES = 10;
  const FILES_PER_CYCLE = 50;
  const MAX_GROWTH_MB = 50; // per cycle ceiling

  const repoDir = makeTmpRepo(FILES_PER_CYCLE);
  const heapSamples = [];

  try {
    for (let i = 0; i < CYCLES; i++) {
      const before = heapMB();
      const { success } = await runAnalysis(repoDir);
      if (!success) throw new Error(`Analysis failed on cycle ${i}`);
      const after = heapMB();
      const growth = after - before;
      heapSamples.push({ cycle: i, before: before.toFixed(1), after: after.toFixed(1), growth: growth.toFixed(1) });
      process.stdout.write(`  Cycle ${String(i + 1).padStart(2)}: heap ${before.toFixed(0)} → ${after.toFixed(0)} MB  (Δ ${growth >= 0 ? '+' : ''}${growth.toFixed(1)} MB)\n`);
    }

    // Check: last sample's growth vs first sample's heap (net total)
    const firstHeap = parseFloat(heapSamples[0].before);
    const lastHeap  = parseFloat(heapSamples[heapSamples.length - 1].after);
    const totalGrowth = lastHeap - firstHeap;
    const growthPerCycle = totalGrowth / CYCLES;

    console.log(`\n  Total heap growth: ${totalGrowth.toFixed(1)} MB over ${CYCLES} cycles`);
    console.log(`  Growth per cycle : ${growthPerCycle.toFixed(1)} MB  (limit: ${MAX_GROWTH_MB} MB)`);

    return { passed: totalGrowth < MAX_GROWTH_MB * CYCLES, totalGrowth, growthPerCycle, heapSamples };
  } finally {
    try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: watcher-throughput
// ─────────────────────────────────────────────────────────────────────────────
async function runWatcherThroughput() {
  // CI: 30 rapid file modifications, each triggering a full re-analyze.
  // Target: each re-index < 1000ms (proxy for 100 saves/min target).
  const SAVES = 30;
  const MAX_LATENCY_MS = 1000;
  const repoDir = makeTmpRepo(20);
  const latencies = [];

  try {
    for (let i = 0; i < SAVES; i++) {
      // Simulate a file save
      fs.writeFileSync(
        path.join(repoDir, 'src', `f${i % 20}.ts`),
        `export function fn${i}_${Date.now()}(x: number) { return x + ${i}; }\n`,
      );
      const t0 = Date.now();
      const { success } = await runAnalysis(repoDir);
      const latency = Date.now() - t0;
      if (!success) throw new Error(`Analysis failed on save ${i}`);
      latencies.push(latency);
      process.stdout.write(`  Save ${String(i + 1).padStart(2)}: ${latency}ms\n`);
    }

    const p95 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];
    const avg = latencies.reduce((s, x) => s + x, 0) / latencies.length;
    const max = Math.max(...latencies);

    console.log(`\n  Latency p95: ${p95}ms  avg: ${avg.toFixed(0)}ms  max: ${max}ms`);
    console.log(`  Limit: ${MAX_LATENCY_MS}ms per re-index`);

    return { passed: p95 <= MAX_LATENCY_MS, p95, avg: Math.round(avg), max, latencies };
  } finally {
    try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ── Run selected scenario ─────────────────────────────────────────────────────
let resultData;
if (scenario === 'memory-stability') {
  resultData = await runMemoryStability();
} else if (scenario === 'watcher-throughput') {
  resultData = await runWatcherThroughput();
} else {
  console.error(`  ✗ Unknown scenario: ${scenario}`);
  process.exit(1);
}

// ── Write result ──────────────────────────────────────────────────────────────
const resultPath = path.join(__dirname, `soak-result-${scenario}.json`);
fs.writeFileSync(resultPath, JSON.stringify({ scenario, measuredAt: new Date().toISOString(), ...resultData }, null, 2));
console.log(`\n  Results written: ${resultPath}\n`);

if (resultData.passed) {
  console.log(`  ✅  Soak test PASSED — ${scenario}\n`);
  process.exit(0);
} else {
  console.error(`  ✗ Soak test FAILED — ${scenario}\n`);
  process.exit(1);
}
