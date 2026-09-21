#!/usr/bin/env node
/**
 * Build-ordering regression test (task 2.7).
 *
 * Proves, from a clean checkout:
 *   1. An unsupported Core-only build (`npm run build --workspace=code-intel/core`
 *      without building Web first) fails with an actionable error instead of
 *      silently producing an incomplete package (the exact bug this release's
 *      Workstream A is about — see code-intel/core/scripts/copy-grammars.mjs).
 *   2. The supported product build (`npm run build:product`) succeeds and
 *      actually produces `code-intel/core/dist/web/` from a clean start.
 *
 * Runs against this actual checkout (like the other verify:* scripts) rather
 * than a throwaway copy, and leaves the repo in a built (not half-built)
 * state afterward regardless of outcome.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const webDist = path.join(repoRoot, 'code-intel/web/dist');
const coreDistWeb = path.join(repoRoot, 'code-intel/core/dist/web');

function run(cmd, args, opts = {}) {
  // runtime-manifest.mjs --validate dumps the full manifest (incl. every
  // node_modules file it inventories) to stdout on success, easily exceeding
  // spawnSync's 1MB default maxBuffer.
  return spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function npmRun(script, extraEnv = {}) {
  return run('npm', ['run', script], { env: { ...process.env, ...extraEnv } });
}

function main() {
  // ── Clean start ──────────────────────────────────────────────────────
  const clean = npmRun('clean:product');
  if (clean.status !== 0) throw new Error(`clean:product failed:\n${clean.stdout}\n${clean.stderr}`);
  if (fs.existsSync(webDist)) throw new Error(`expected ${webDist} to be gone after clean:product`);
  console.log('✓ clean:product removed generated output');

  // ── 1. Unsupported Core-only build MUST fail with an actionable error ──
  const coreOnly = run('npm', ['run', 'build', '--workspace=code-intel/core']);
  if (coreOnly.status === 0) {
    throw new Error(
      'RELEASE BLOCKER: `npm run build --workspace=code-intel/core` succeeded without Web having been built first — '
      + 'this is exactly the silent-incomplete-package bug Workstream A fixed. It must fail loudly instead.',
    );
  }
  const combinedOutput = `${coreOnly.stdout}\n${coreOnly.stderr}`;
  if (!combinedOutput.includes('build:product') && !combinedOutput.includes('CODE_INTEL_SKIP_WEB_ASSETS')) {
    throw new Error(`Core-only build failed (correct), but the error wasn't actionable — expected guidance mentioning build:product or CODE_INTEL_SKIP_WEB_ASSETS. Got:\n${combinedOutput.slice(-1000)}`);
  }
  console.log('✓ unsupported Core-only build fails loudly with actionable guidance (not a silent incomplete package)');

  // ── 2. The opt-out escape hatch for legitimate core-only dev builds works ──
  const skipResult = run('npm', ['run', 'build', '--workspace=code-intel/core'], { env: { ...process.env, CODE_INTEL_SKIP_WEB_ASSETS: '1' } });
  if (skipResult.status !== 0) {
    throw new Error(`CODE_INTEL_SKIP_WEB_ASSETS=1 core-only dev build should succeed but failed:\n${skipResult.stdout}\n${skipResult.stderr}`);
  }
  console.log('✓ CODE_INTEL_SKIP_WEB_ASSETS=1 core-only dev build succeeds (documented escape hatch still works)');

  // ── 3. Clean again, then the SUPPORTED path must succeed end-to-end ────
  const clean2 = npmRun('clean:product');
  if (clean2.status !== 0) throw new Error(`clean:product failed:\n${clean2.stdout}\n${clean2.stderr}`);

  const product = npmRun('build:product');
  if (product.status !== 0) {
    throw new Error(`the supported product build failed from a clean checkout:\n${product.stdout.slice(-2000)}\n${product.stderr.slice(-2000)}`);
  }
  if (!fs.existsSync(coreDistWeb) || fs.readdirSync(coreDistWeb).length === 0) {
    throw new Error(`build:product succeeded but ${coreDistWeb} is missing or empty — Web assets were not actually recreated`);
  }
  console.log('✓ build:product (shared -> web -> core) succeeds from a clean checkout and recreates dist/web');

  console.log('\n✓ build ordering regression coverage passed (task 2.7).');
}

main();
