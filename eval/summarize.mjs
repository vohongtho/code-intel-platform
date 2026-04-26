#!/usr/bin/env node
/**
 * Eval Summary — reads all JSON result files from eval/results/
 * and prints a consolidated benchmark table.
 *
 * Usage:
 *   node eval/summarize.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');

if (!fs.existsSync(RESULTS_DIR)) {
  console.log('\n  No results yet. Run: npm run eval:all\n');
  process.exit(0);
}

const files = fs.readdirSync(RESULTS_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('bench-'))
  .sort()
  .map(f => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8')) }));

if (files.length === 0) {
  console.log('\n  No results yet. Run: npm run eval:all\n');
  process.exit(0);
}

console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║          Code Intelligence Platform — Benchmark Results          ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// Latest run per fixture
const latest = new Map();
for (const { file, data } of files) {
  const fixture = data.fixture ?? 'simple-ts';
  const ts = parseInt(file.match(/(\d+)\.json$/)?.[1] ?? '0', 10);
  const prev = latest.get(fixture);
  if (!prev || ts > prev.ts) latest.set(fixture, { ts, data, file });
}

// Table header
const col = (s, w) => String(s).padEnd(w);
console.log(
  '  ' + col('Fixture', 18) + col('Score', 10) + col('Pass', 8) + col('Total', 8) + 'File'
);
console.log('  ' + '─'.repeat(70));

let grandPass = 0, grandTotal = 0;
for (const [fixture, { data, file }] of [...latest.entries()].sort()) {
  const bar = '█'.repeat(Math.round(data.score / 5)) + '░'.repeat(20 - Math.round(data.score / 5));
  const scoreStr = `${data.score}% [${bar}]`;
  console.log(
    '  ' + col(fixture, 18) + col(scoreStr, 36) + col(data.passed, 6) + '/' + col(data.total, 6) + file
  );
  grandPass += data.passed;
  grandTotal += data.total;
}

const grandScore = Math.round((grandPass / grandTotal) * 100);
console.log('  ' + '─'.repeat(70));
console.log('  ' + col('TOTAL', 18) + col(`${grandScore}%`, 36) + col(grandPass, 6) + '/' + grandTotal);

console.log('\n  ── Phase Breakdown (latest runs) ──\n');

// Per-phase breakdown across all latest runs
const phaseMap = new Map();
for (const [, { data }] of latest.entries()) {
  for (const r of data.results ?? []) {
    const key = r.label;
    if (!phaseMap.has(key)) phaseMap.set(key, { pass: 0, total: 0 });
    const p = phaseMap.get(key);
    p.total++;
    if (r.pass) p.pass++;
  }
}

for (const [label, { pass, total }] of phaseMap.entries()) {
  const icon = pass === total ? '✅' : pass > 0 ? '⚠️ ' : '❌';
  console.log(`  ${icon}  ${col(label, 50)} ${pass}/${total}`);
}

console.log('\n  Run `npm run eval:all` to refresh results.\n');

// ── MCP Bench summary ──────────────────────────────────────────────────────
const mcpFiles = fs.readdirSync(RESULTS_DIR)
  .filter(f => f.startsWith('bench-mcp-') && f.endsWith('.json'))
  .sort();

if (mcpFiles.length > 0) {
  const latest = mcpFiles[mcpFiles.length - 1];
  const mcp = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, latest), 'utf-8'));
  console.log('  ── MCP Server Benchmark ──────────────────────────────────────────\n');
  console.log(`  Fixture: ${mcp.fixture}   File: ${latest}`);
  console.log('');
  const col2 = (s, w) => String(s).padEnd(w);
  console.log('  ' + col2('Metric', 30) + 'Value');
  console.log('  ' + '─'.repeat(50));
  console.log('  ' + col2('Score', 30) + `${mcp.passed}/${mcp.total} (${mcp.score}%)`);
  console.log('  ' + col2('Avg tool latency', 30) + `${mcp.avgLatencyMs}ms/call`);
  const failures = mcp.results.filter(r => !r.pass);
  if (failures.length > 0) {
    console.log('  ' + col2('Failures', 30) + failures.map(f => f.label).join(', '));
  }
  console.log('');
  console.log('  Run `npm run bench:mcp` to refresh.\n');
}

// ── Bench summary ──────────────────────────────────────────────────────────
const benchFiles = fs.readdirSync(RESULTS_DIR)
  .filter(f => f.startsWith('bench-agent-') && f.endsWith('.json'))
  .sort();

if (benchFiles.length > 0) {
  const latest = benchFiles[benchFiles.length - 1];
  const bench = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, latest), 'utf-8'));
  console.log('  ── Agent Benchmark (Before vs After) ──────────────────────────\n');
  const b = bench.baseline;
  const e = bench.enhanced;
  const d = bench.delta;
  console.log(`  Fixture: ${bench.fixture}   Tasks: ${bench.tasks}   File: ${latest}`);
  console.log('');
  const col2 = (s, w) => String(s).padEnd(w);
  console.log('  ' + col2('Metric', 30) + col2('Baseline', 18) + col2('Enhanced', 18) + 'Δ');
  console.log('  ' + '─'.repeat(70));
  console.log('  ' + col2('Accuracy', 30) + col2(`${b.avgAccuracy}%`, 18) + col2(`${e.avgAccuracy}%`, 18) + `+${d.accuracyPp}pp`);
  console.log('  ' + col2('Tool calls / task', 30) + col2((b.totalSteps / bench.tasks).toFixed(1), 18) + col2((e.totalSteps / bench.tasks).toFixed(1), 18) + `${d.stepsReductionPct}% fewer`);
  console.log('  ' + col2('Avg response chars', 30) + col2(b.avgChars, 18) + col2(e.avgChars, 18) + `-${d.charsReductionPct}% token cost`);
  console.log('');
  console.log('  Run `npm run bench` to refresh.\n');
}
