#!/usr/bin/env node
/**
 * Eval Case: Multi-language fixture (Python + TypeScript)
 * Tests cross-language symbol detection, impact, and skill coverage.
 *
 * Usage:
 *   node eval/run-eval-multi.mjs [--json]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'code-intel', 'core', 'dist', 'cli', 'main.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'multi-lang');
const RESULTS_DIR = path.join(__dirname, 'results');
const jsonOut = process.argv.includes('--json');

const results = [];
let passed = 0;
let total = 0;

function pass(label, note = '') { console.log(`  ✅ PASS  ${label}${note ? '  (' + note + ')' : ''}`); results.push({ label, pass: true, note }); passed++; total++; }
function fail(label, note = '') { console.log(`  ❌ FAIL  ${label}${note ? '  (' + note + ')' : ''}`); results.push({ label, pass: false, note }); total++; }
function run(...args) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', timeout: 60_000 });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 };
}

console.log('\n═══════════════════════════════════════════════════════');
console.log('  Eval: Multi-Language Fixture (Python + TypeScript)');
console.log('═══════════════════════════════════════════════════════\n');

// ── Analyze ──────────────────────────────────────────────────────────────────
console.log('▶ Analysis');
const a = run('analyze', FIXTURE);
const nodes = parseInt(a.stdout.match(/Nodes:\s*(\d+)/)?.[1] ?? '0', 10);
const edges = parseInt(a.stdout.match(/Edges:\s*(\d+)/)?.[1] ?? '0', 10);

a.code === 0 ? pass('analyze exits 0') : fail('analyze exits 0', a.stderr.slice(0, 100));
nodes >= 8 ? pass('multi-lang nodes', `${nodes}`) : fail('multi-lang nodes', `${nodes} < 8`);
edges >= 2 ? pass('multi-lang edges', `${edges}`) : fail('multi-lang edges', `${edges} < 2`);

// ── Python symbols ────────────────────────────────────────────────────────────
console.log('\n▶ Python Symbols');
const sUser = run('search', 'User', '-p', FIXTURE);
const sAuth = run('search', 'AuthService', '-p', FIXTURE);
const sValidate = run('search', 'validate_email', '-p', FIXTURE);

sUser.stdout.includes('User') ? pass('Python: User class found') : fail('Python: User class found');
sAuth.stdout.includes('AuthService') ? pass('Python: AuthService found') : fail('Python: AuthService found');
sValidate.stdout.includes('validate_email') ? pass('Python: validate_email found') : fail('Python: validate_email found');

// ── TypeScript symbols ────────────────────────────────────────────────────────
console.log('\n▶ TypeScript Symbols');
const sRouter = run('search', 'Router', '-p', FIXTURE);
const sHandle = run('search', 'handle', '-p', FIXTURE);

sRouter.stdout.includes('Router') ? pass('TS: Router class found') : fail('TS: Router class found');
sHandle.stdout.includes('handle') ? pass('TS: handle method found') : fail('TS: handle method found');

// ── Impact ────────────────────────────────────────────────────────────────────
console.log('\n▶ Impact Analysis');
const impactAuth = run('impact', 'AuthService', '-p', FIXTURE);
const affected = parseInt(impactAuth.stdout.match(/(\d+)\s+affected/i)?.[1] ?? '0', 10);
affected >= 1 ? pass('AuthService blast radius ≥ 1', `${affected} affected`) : fail('AuthService blast radius', `${affected}`);

// ── Context files ─────────────────────────────────────────────────────────────
console.log('\n▶ Context Files');
for (const fname of ['AGENTS.md', 'CLAUDE.md']) {
  const fpath = path.join(FIXTURE, fname);
  const exists = fs.existsSync(fpath);
  exists ? pass(`${fname} created`) : fail(`${fname} created`);
  if (exists) {
    const c = fs.readFileSync(fpath, 'utf-8');
    c.includes('<!-- code-intel:start -->') ? pass(`${fname} has code-intel block`) : fail(`${fname} has code-intel block`);
  }
}

// ── Skill files ───────────────────────────────────────────────────────────────
console.log('\n▶ Skill Files');
const skillDir = path.join(FIXTURE, '.claude', 'skills', 'code-intel');
fs.existsSync(skillDir) ? pass('skills dir created') : fail('skills dir created');

// ── Clean ─────────────────────────────────────────────────────────────────────
console.log('\n▶ Clean');
const clean = run('clean', FIXTURE);
!fs.existsSync(path.join(FIXTURE, '.code-intel')) ? pass('clean removes .code-intel/') : fail('clean removes .code-intel/');

// ── Summary ───────────────────────────────────────────────────────────────────
const score = Math.round((passed / total) * 100);
console.log('\n═══════════════════════════════════════════════════════');
console.log(`  Score: ${passed}/${total} (${score}%)`);
console.log('═══════════════════════════════════════════════════════\n');

const failures = results.filter(r => !r.pass);
if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  • ${f.label}${f.note ? ': ' + f.note : ''}`);
  console.log('');
}

if (jsonOut) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `eval-multi-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ fixture: 'multi-lang', score, passed, total, results }, null, 2));
  console.log(`Results: ${out}`);
}

process.exit(score === 100 ? 0 : 1);
