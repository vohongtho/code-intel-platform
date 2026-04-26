#!/usr/bin/env node
/**
 * Multi-language fixture eval — Go, Rust, Java
 *
 * Tests symbol detection, search, inspect, impact, skill files, context files
 * across three additional languages.
 *
 * Usage:
 *   node eval/run-eval-langs.mjs [--json]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'code-intel', 'core', 'dist', 'cli', 'main.js');
const RESULTS_DIR = path.join(__dirname, 'results');
const jsonOut = process.argv.includes('--json');

function runCLI(...args) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', timeout: 60_000 });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 };
}

const allResults = [];
let grandPass = 0, grandTotal = 0;

// ── Per-language test spec ────────────────────────────────────────────────────
const LANGS = [
  {
    name: 'Go',
    fixture: path.join(__dirname, 'fixtures', 'go-repo'),
    minNodes: 6,
    minEdges: 2,
    symbols: [
      { search: 'UserRepository', expect: 'UserRepository' },
      { search: 'ValidateEmail', expect: 'ValidateEmail' },
      { search: 'FormatUser', expect: 'FormatUser' },
    ],
    impact: { symbol: 'NewUserRepository', minAffected: 1 },
  },
  {
    name: 'Rust',
    fixture: path.join(__dirname, 'fixtures', 'rust-repo'),
    minNodes: 5,
    minEdges: 1,
    symbols: [
      { search: 'UserRepository', expect: 'UserRepository' },
      { search: 'validate_email', expect: 'validate_email' },
      { search: 'generate_token', expect: 'generate_token' },
    ],
    impact: { symbol: 'internal_hash', minAffected: 1 },
  },
  {
    name: 'Java',
    fixture: path.join(__dirname, 'fixtures', 'java-repo'),
    minNodes: 5,
    minEdges: 1,
    symbols: [
      { search: 'UserRepository', expect: 'UserRepository' },
      { search: 'User', expect: 'User' },
      { search: 'EmailValidator', expect: 'EmailValidator' },
    ],
    impact: { symbol: 'User', minAffected: 1 },
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────
function pass(lang, label, note = '') {
  console.log(`  ✅  [${lang}] ${label}${note ? '  (' + note + ')' : ''}`);
  return { lang, label, pass: true, note };
}
function fail(lang, label, note = '') {
  console.log(`  ❌  [${lang}] ${label}${note ? '  (' + note + ')' : ''}`);
  return { lang, label, pass: false, note };
}
function check(r) { allResults.push(r); grandTotal++; if (r.pass) grandPass++; }

console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║          Eval: Language Fixtures — Go · Rust · Java             ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

for (const lang of LANGS) {
  console.log(`▶ ${lang.name}  (${lang.fixture})`);

  // Analyze
  const a = runCLI('analyze', lang.fixture);
  check(a.code === 0 ? pass(lang.name, 'analyze exits 0') : fail(lang.name, 'analyze exits 0', a.stderr.slice(0, 80)));

  const nodes = parseInt(a.stdout.match(/Nodes:\s*(\d+)/)?.[1] ?? '0', 10);
  const edges = parseInt(a.stdout.match(/Edges:\s*(\d+)/)?.[1] ?? '0', 10);
  check(nodes >= lang.minNodes ? pass(lang.name, `nodes ≥ ${lang.minNodes}`, `${nodes}`) : fail(lang.name, `nodes ≥ ${lang.minNodes}`, `${nodes}`));
  check(edges >= lang.minEdges ? pass(lang.name, `edges ≥ ${lang.minEdges}`, `${edges}`) : fail(lang.name, `edges ≥ ${lang.minEdges}`, `${edges}`));

  // Symbol searches
  for (const { search, expect } of lang.symbols) {
    const r = runCLI('search', search, '-p', lang.fixture);
    check(r.stdout.includes(expect)
      ? pass(lang.name, `search: ${search}`)
      : fail(lang.name, `search: ${search}`, r.stdout.slice(0, 80)));
  }

  // Impact
  const imp = runCLI('impact', lang.impact.symbol, '-p', lang.fixture);
  const affected = parseInt(imp.stdout.match(/(\d+)\s+affected/i)?.[1] ?? '0', 10);
  check(affected >= lang.impact.minAffected
    ? pass(lang.name, `impact: ${lang.impact.symbol} ≥ ${lang.impact.minAffected}`, `${affected}`)
    : fail(lang.name, `impact: ${lang.impact.symbol}`, `${affected} < ${lang.impact.minAffected}`));

  // Skill files
  const skillDir = path.join(lang.fixture, '.claude', 'skills', 'code-intel');
  check(fs.existsSync(skillDir) ? pass(lang.name, 'skills dir created') : fail(lang.name, 'skills dir created'));

  // Context files
  for (const fname of ['AGENTS.md', 'CLAUDE.md']) {
    const fpath = path.join(lang.fixture, fname);
    const exists = fs.existsSync(fpath);
    check(exists ? pass(lang.name, `${fname} created`) : fail(lang.name, `${fname} created`));
    if (exists) {
      const c = fs.readFileSync(fpath, 'utf-8');
      check(c.includes('<!-- code-intel:start -->')
        ? pass(lang.name, `${fname} has code-intel block`)
        : fail(lang.name, `${fname} has code-intel block`));
    }
  }

  // Clean
  const clean = runCLI('clean', lang.fixture);
  check(clean.code === 0 && !fs.existsSync(path.join(lang.fixture, '.code-intel'))
    ? pass(lang.name, 'clean removes .code-intel/')
    : fail(lang.name, 'clean removes .code-intel/'));

  console.log('');
}

// ── Summary ───────────────────────────────────────────────────────────────────
const score = Math.round((grandPass / grandTotal) * 100);
console.log('═══════════════════════════════════════════════════════');
console.log(`  Score: ${grandPass}/${grandTotal} (${score}%)`);
console.log('═══════════════════════════════════════════════════════\n');

const failures = allResults.filter(r => !r.pass);
if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  • [${f.lang}] ${f.label}${f.note ? ': ' + f.note : ''}`);
  console.log('');
}

if (jsonOut) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `eval-langs-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ fixture: 'go+rust+java', score, passed: grandPass, total: grandTotal, results: allResults }, null, 2));
  console.log(`Results: ${out}\n`);
}

process.exit(score === 100 ? 0 : 1);
