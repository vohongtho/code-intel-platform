#!/usr/bin/env node
/**
 * Code Intelligence Platform — Benchmark Evaluator
 *
 * Measures quality of:
 *   1. Knowledge Graph (symbol count, edge count, accuracy)
 *   2. Skill Files (presence, hot symbols accuracy, entry points)
 *   3. MCP Tools (search, inspect, impact accuracy)
 *   4. Context Files (AGENTS.md / CLAUDE.md upsert correctness)
 *
 * Usage:
 *   node eval/run-eval.mjs [--fixture <path>] [--json]
 *
 * Outputs a score table and optionally writes eval/results/<timestamp>.json
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'code-intel', 'core', 'dist', 'cli', 'main.js');
const RESULTS_DIR = path.join(__dirname, 'results');
const FIXTURE_DEFAULT = path.join(__dirname, 'fixtures', 'simple-ts');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flagIdx = args.indexOf('--fixture');
const fixturePath = flagIdx !== -1 ? path.resolve(args[flagIdx + 1]) : FIXTURE_DEFAULT;
const jsonOut = args.includes('--json');

// ── Helpers ─────────────────────────────────────────────────────────────────
function pass(label, note = '') {
  console.log(`  ✅ PASS  ${label}${note ? '  (' + note + ')' : ''}`);
  return { label, pass: true, note };
}

function fail(label, note = '') {
  console.log(`  ❌ FAIL  ${label}${note ? '  (' + note + ')' : ''}`);
  return { label, pass: false, note };
}

function run(args) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', timeout: 60_000 });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 };
}

// ── Eval cases ───────────────────────────────────────────────────────────────
const results = [];
let passed = 0;
let total = 0;

function check(result) {
  results.push(result);
  total++;
  if (result.pass) passed++;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════');
console.log('  Code Intelligence Platform — Benchmark Evaluation');
console.log(`  Fixture: ${fixturePath}`);
console.log('═══════════════════════════════════════════════════════\n');

// ── 1. ANALYZE ───────────────────────────────────────────────────────────────
console.log('▶ Phase 1: Analysis');

const analyze = run(['analyze', fixturePath]);
check(analyze.code === 0
  ? pass('analyze exits 0')
  : fail('analyze exits 0', `exit=${analyze.code} ${analyze.stderr.slice(0, 100)}`));

// Check stats in output
const nodesMatch = analyze.stdout.match(/Nodes:\s*(\d+)/);
const edgesMatch = analyze.stdout.match(/Edges:\s*(\d+)/);
const nodes = parseInt(nodesMatch?.[1] ?? '0', 10);
const edges = parseInt(edgesMatch?.[1] ?? '0', 10);

check(nodes >= 5
  ? pass('nodes detected', `${nodes} nodes`)
  : fail('nodes detected', `only ${nodes} nodes`));

check(edges >= 3
  ? pass('edges detected', `${edges} edges`)
  : fail('edges detected', `only ${edges} edges`));

// ── 2. SEARCH ────────────────────────────────────────────────────────────────
console.log('\n▶ Phase 2: Search');

const searchCalc = run(['search', 'Calculator', '-p', fixturePath]);
check(searchCalc.stdout.includes('Calculator')
  ? pass('search finds Calculator')
  : fail('search finds Calculator', searchCalc.stdout.slice(0, 100)));

const searchAdd = run(['search', 'add', '-p', fixturePath]);
check(searchAdd.stdout.includes('add')
  ? pass('search finds add()')
  : fail('search finds add()', searchAdd.stdout.slice(0, 100)));

// ── 3. INSPECT ───────────────────────────────────────────────────────────────
console.log('\n▶ Phase 3: Inspect');

const inspectCalc = run(['inspect', 'Calculator', '-p', fixturePath]);
check(inspectCalc.stdout.includes('Calculator')
  ? pass('inspect returns Calculator')
  : fail('inspect returns Calculator', inspectCalc.stdout.slice(0, 100)));

// Verify add() has callers via impact (compute calls add)
const impactAdd = run(['impact', 'add', '-p', fixturePath]);
const hasCallees = impactAdd.stdout.includes('Calculator') || parseInt(
  impactAdd.stdout.match(/(\d+)\s+affected/i)?.[1] ?? '0', 10) >= 2;
check(hasCallees
  ? pass('inspect callees: add() is called by Calculator area (≥2 affected)')
  : fail('inspect callees via impact', impactAdd.stdout.slice(0, 200)));

// ── 4. IMPACT ────────────────────────────────────────────────────────────────
console.log('\n▶ Phase 4: Impact');

const impact = run(['impact', 'add', '-p', fixturePath]);
// add() is called by Calculator.compute → should show blast radius
check(impact.stdout.includes('add')
  ? pass('impact finds add in blast radius')
  : fail('impact finds add', impact.stdout.slice(0, 100)));

const affectedMatch = impact.stdout.match(/(\d+)\s+affected\s+symbols?/i);
const affected = parseInt(affectedMatch?.[1] ?? '0', 10);
check(affected >= 1
  ? pass('impact blast radius ≥ 1', `${affected} affected`)
  : fail('impact blast radius', `${affected} affected`));

// ── 5. SKILL FILES ───────────────────────────────────────────────────────────
console.log('\n▶ Phase 5: Skill Files');

const skillDir = path.join(fixturePath, '.claude', 'skills', 'code-intel');
check(fs.existsSync(skillDir)
  ? pass('.claude/skills/code-intel/ created')
  : fail('.claude/skills/code-intel/ created', 'directory not found'));

if (fs.existsSync(skillDir)) {
  const skillFiles = fs.readdirSync(skillDir, { recursive: true })
    .filter(f => String(f).endsWith('SKILL.md'));
  check(skillFiles.length >= 1
    ? pass('SKILL.md files generated', `${skillFiles.length} files`)
    : fail('SKILL.md files generated', '0 files'));

  // Check skill content quality
  for (const sf of skillFiles.slice(0, 1)) {
    const content = fs.readFileSync(path.join(skillDir, sf), 'utf-8');
    check(content.includes('## Hot Symbols')
      ? pass('skill has Hot Symbols section')
      : fail('skill has Hot Symbols section'));
    check(content.includes('## Quick Commands')
      ? pass('skill has Quick Commands section')
      : fail('skill has Quick Commands section'));
    check(content.includes('## Impact Guidance')
      ? pass('skill has Impact Guidance section')
      : fail('skill has Impact Guidance section'));
    check(content.includes('description:')
      ? pass('skill has frontmatter description')
      : fail('skill has frontmatter description'));
  }
}

// ── 6. CONTEXT FILES ─────────────────────────────────────────────────────────
console.log('\n▶ Phase 6: Context Files (AGENTS.md / CLAUDE.md)');

for (const fname of ['AGENTS.md', 'CLAUDE.md']) {
  const fpath = path.join(fixturePath, fname);
  check(fs.existsSync(fpath)
    ? pass(`${fname} created`)
    : fail(`${fname} created`));

  if (fs.existsSync(fpath)) {
    const content = fs.readFileSync(fpath, 'utf-8');
    check(content.includes('<!-- code-intel:start -->')
      ? pass(`${fname} has code-intel block`)
      : fail(`${fname} has code-intel block`));
    check(content.includes('code-intel analyze')
      ? pass(`${fname} has CLI reference`)
      : fail(`${fname} has CLI reference`));
    // Test idempotency: re-running analyze should not duplicate the block
    run(['analyze', fixturePath]);
    const content2 = fs.readFileSync(fpath, 'utf-8');
    const blockCount = (content2.match(/<!-- code-intel:start -->/g) ?? []).length;
    check(blockCount === 1
      ? pass(`${fname} block idempotent (no duplicates)`)
      : fail(`${fname} block idempotent`, `${blockCount} blocks found`));
  }
}

// ── 7. STATUS ────────────────────────────────────────────────────────────────
console.log('\n▶ Phase 7: Status');

const status = run(['status', fixturePath]);
check(status.code === 0 && status.stdout.includes('Indexed')
  ? pass('status shows indexed state')
  : fail('status shows indexed state', status.stdout.slice(0, 100)));

// ── 8. CLEAN ─────────────────────────────────────────────────────────────────
console.log('\n▶ Phase 8: Clean');

const clean = run(['clean', fixturePath]);
const codeIntelDir = path.join(fixturePath, '.code-intel');
check(clean.code === 0 && !fs.existsSync(codeIntelDir)
  ? pass('clean removes .code-intel/')
  : fail('clean removes .code-intel/'));

// ── SUMMARY ──────────────────────────────────────────────────────────────────
const score = Math.round((passed / total) * 100);
console.log('\n═══════════════════════════════════════════════════════');
console.log(`  Score: ${passed}/${total} (${score}%)`);
console.log('═══════════════════════════════════════════════════════\n');

const failures = results.filter(r => !r.pass);
if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) {
    console.log(`  • ${f.label}${f.note ? ': ' + f.note : ''}`);
  }
  console.log('');
}

if (jsonOut) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(RESULTS_DIR, `eval-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ score, passed, total, results }, null, 2));
  console.log(`Results written to: ${outFile}`);
}

process.exit(score === 100 ? 0 : 1);
