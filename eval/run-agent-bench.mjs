#!/usr/bin/env node
/**
 * Agent Task Benchmark — Before vs After code-intel
 *
 * Simulates what an AI agent does when answering code questions:
 *
 *   BASELINE  — no tool, agent must grep/read files manually
 *   ENHANCED  — agent uses code-intel CLI tools
 *
 * Measures for each mode:
 *   • Accuracy   — did the answer contain all ground-truth symbols?
 *   • Steps      — how many tool calls / file reads needed?
 *   • Latency ms — wall-clock time
 *   • Chars      — response size (proxy for token cost)
 *
 * Usage:
 *   node eval/run-agent-bench.mjs [--json]
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'code-intel', 'core', 'dist', 'cli', 'main.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'simple-ts');
const TASKS = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases', 'tasks.json'), 'utf-8'));
const RESULTS_DIR = path.join(__dirname, 'results');
const jsonOut = process.argv.includes('--json');

// ── Helpers ──────────────────────────────────────────────────────────────────
function runCLI(...args) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', timeout: 30_000 });
  return r.stdout ?? '';
}

function grepFile(pattern) {
  try {
    return execSync(
      `grep -rn --exclude-dir=.code-intel --exclude-dir=.claude --include="*.ts" --include="*.py" --include="*.js" "${pattern}" "${FIXTURE}"`,
      { encoding: 'utf-8', timeout: 5_000 }
    );
  } catch { return ''; }
}

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

function score(answer, groundTruth) {
  const hits = groundTruth.filter(t =>
    typeof t === 'number'
      ? answer.includes(String(t))
      : answer.toLowerCase().includes(String(t).toLowerCase())
  );
  return { hits: hits.length, total: groundTruth.length, pct: Math.round((hits.length / groundTruth.length) * 100) };
}

// ── Ensure analyzed ───────────────────────────────────────────────────────────
runCLI('analyze', FIXTURE, '--silent' in process.env ? '' : '');

// ── Baseline agent (no code-intel) ────────────────────────────────────────────
/**
 * Simulates: agent reads source files + uses grep.
 * Every task requires: 1 file read + 1 grep = 2 steps.
 */
function baselineAnswer(task) {
  const t0 = Date.now();
  let answer = '';
  let steps = 0;

  // Read all source files in fixture
  const files = fs.readdirSync(FIXTURE).filter(f => /\.(ts|js|py)$/.test(f));
  for (const f of files) {
    answer += readFile(path.join(FIXTURE, f));
    steps++;
  }

  // Grep for the keyword in the question
  const keyword = task.symbol ?? task.question.split(' ').pop();
  answer += grepFile(keyword);
  steps++;

  return { answer, steps, ms: Date.now() - t0, chars: answer.length };
}

// ── Enhanced agent (uses code-intel tools) ────────────────────────────────────
/**
 * Simulates: agent calls the right code-intel command per task category.
 * 1 tool call = 1 step.
 */
function enhancedAnswer(task) {
  const t0 = Date.now();
  let answer = '';
  let steps = 0;

  const symbol = task.symbol ?? '';

  if (task.cliCmd === 'inspect') {
    answer = runCLI('inspect', symbol, '-p', FIXTURE);
    steps = 1;
  } else if (task.cliCmd === 'impact') {
    answer = runCLI('impact', symbol, '-p', FIXTURE);
    steps = 1;
  } else if (task.cliCmd === 'search') {
    answer = runCLI('search', symbol, '-p', FIXTURE, '-l', '30');
    steps = 1;
  }

  return { answer, steps, ms: Date.now() - t0, chars: answer.length };
}

// ── Run benchmark ─────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║        Agent Task Benchmark — Baseline vs code-intel            ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

const col = (s, w) => String(s).padEnd(w);
console.log(
  '  ' + col('Task', 18) +
  col('Category', 14) +
  col('Base Acc%', 10) + col('Base Steps', 11) + col('Base ms', 9) +
  col('Enh Acc%', 10) + col('Enh Steps', 10) + col('Enh ms', 8)
);
console.log('  ' + '─'.repeat(100));

const rows = [];
let baseTotalAcc = 0, enhTotalAcc = 0;
let baseTotalSteps = 0, enhTotalSteps = 0;
let baseTotalMs = 0, enhTotalMs = 0;
let baseTotalChars = 0, enhTotalChars = 0;

for (const task of TASKS) {
  const base = baselineAnswer(task);
  const enh = enhancedAnswer(task);

  const baseScore = score(base.answer, task.groundTruth);
  const enhScore = score(enh.answer, task.groundTruth);

  const baseAcc = `${baseScore.pct}%`;
  const enhAcc = `${enhScore.pct}%`;

  const baseIcon = baseScore.pct === 100 ? '✅' : baseScore.pct > 0 ? '⚠️ ' : '❌';
  const enhIcon = enhScore.pct === 100 ? '✅' : enhScore.pct > 0 ? '⚠️ ' : '❌';

  console.log(
    '  ' + col(task.id, 18) +
    col(task.category, 14) +
    col(`${baseIcon} ${baseAcc}`, 12) + col(base.steps, 11) + col(base.ms + 'ms', 9) +
    col(`${enhIcon} ${enhAcc}`, 12) + col(enh.steps, 10) + col(enh.ms + 'ms', 8)
  );

  baseTotalAcc += baseScore.pct;
  enhTotalAcc += enhScore.pct;
  baseTotalSteps += base.steps;
  enhTotalSteps += enh.steps;
  baseTotalMs += base.ms;
  enhTotalMs += enh.ms;
  baseTotalChars += base.chars;
  enhTotalChars += enh.chars;

  rows.push({ task: task.id, category: task.category, base: { ...baseScore, steps: base.steps, ms: base.ms, chars: base.chars }, enhanced: { ...enhScore, steps: enh.steps, ms: enh.ms, chars: enh.chars } });
}

const n = TASKS.length;
const avgBaseAcc = Math.round(baseTotalAcc / n);
const avgEnhAcc = Math.round(enhTotalAcc / n);
const stepsReduction = Math.round(((baseTotalSteps - enhTotalSteps) / baseTotalSteps) * 100);
const charsReduction = Math.round(((baseTotalChars - enhTotalChars) / baseTotalChars) * 100);

console.log('  ' + '─'.repeat(100));
console.log(
  '  ' + col('AVERAGE', 18) + col('', 14) +
  col(`${avgBaseAcc}%`, 12) + col(baseTotalSteps, 11) + col(baseTotalMs + 'ms', 9) +
  col(`${avgEnhAcc}%`, 12) + col(enhTotalSteps, 10) + col(enhTotalMs + 'ms', 8)
);

console.log('\n  ── Summary ──────────────────────────────────────────────────────\n');
console.log(`  Accuracy:      Baseline ${avgBaseAcc}%  →  Enhanced ${avgEnhAcc}%   (+${avgEnhAcc - avgBaseAcc}pp)`);
console.log(`  Steps/task:    Baseline ${(baseTotalSteps/n).toFixed(1)}  →  Enhanced ${(enhTotalSteps/n).toFixed(1)}   (${stepsReduction}% fewer steps)`);
console.log(`  Response size: Baseline ${Math.round(baseTotalChars/n)} chars  →  Enhanced ${Math.round(enhTotalChars/n)} chars   (${charsReduction > 0 ? '-' : '+'}${Math.abs(charsReduction)}% chars = token savings)`);
console.log(`  Total time:    Baseline ${baseTotalMs}ms  →  Enhanced ${enhTotalMs}ms`);
console.log('');

if (jsonOut) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `bench-agent-${Date.now()}.json`);
  const summary = {
    fixture: 'simple-ts',
    tasks: n,
    baseline: { avgAccuracy: avgBaseAcc, totalSteps: baseTotalSteps, totalMs: baseTotalMs, avgChars: Math.round(baseTotalChars / n) },
    enhanced: { avgAccuracy: avgEnhAcc, totalSteps: enhTotalSteps, totalMs: enhTotalMs, avgChars: Math.round(enhTotalChars / n) },
    delta: { accuracyPp: avgEnhAcc - avgBaseAcc, stepsReductionPct: stepsReduction, charsReductionPct: charsReduction },
    rows,
  };
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`  Results: ${out}\n`);
}
