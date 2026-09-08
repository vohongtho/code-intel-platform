#!/usr/bin/env node
/**
 * npm tarball content validation (tasks 4.1 / 4.2 / 4.3 / 3.4 tarball leg).
 *
 * The previous `validate:dist` script only proved `npm pack` exits
 * successfully and then deleted the tarball — it never looked inside.
 * Since Core's own build can silently omit dist/web (see
 * scripts/copy-grammars.mjs) or a future change could add an unwanted
 * `files` entry, this inspects the actual tarball contents before deleting
 * it: required runtime assets must be present, and known-sensitive/dev-only
 * paths must be absent.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

const requiredPatterns = [
  { label: 'package.json', test: (files) => files.includes('package/package.json') },
  { label: 'CLI entrypoint (dist/cli/main.js)', test: (files) => files.includes('package/dist/cli/main.js') },
  { label: 'hook entrypoint (dist/cli/hook.js)', test: (files) => files.includes('package/dist/cli/hook.js') },
  { label: 'package entrypoint (dist/index.js)', test: (files) => files.includes('package/dist/index.js') },
  { label: 'Web UI assets (dist/web/)', test: (files) => files.some((f) => f.startsWith('package/dist/web/')) },
  { label: 'bundled grammars (dist/wasm/*.wasm)', test: (files) => files.some((f) => f.startsWith('package/dist/wasm/') && f.endsWith('.wasm')) },
  { label: 'workflow/agent assets (dist/agents/)', test: (files) => files.some((f) => f.startsWith('package/dist/agents/')) },
  { label: 'runtime manifest validator (dist/agents/workflows)', test: (files) => files.some((f) => f.startsWith('package/dist/agents/workflows/')) },
  { label: 'bundled workflow markdown assets (dist/agents/workflows/assets/*.md)', test: (files) => files.some((f) => f.startsWith('package/dist/agents/workflows/assets/') && f.endsWith('.md')) },
  { label: 'README.md', test: (files) => files.includes('package/README.md') },
  { label: 'LICENSE', test: (files) => files.includes('package/LICENSE') },
];

const forbiddenPatterns = [
  { label: '.code-intel/ persisted state', test: (f) => f.includes('.code-intel/') || f.includes('/.code-intel/') },
  { label: 'dist-tests build output', test: (f) => f.includes('/dist-tests/') || f.startsWith('package/dist-tests/') },
  { label: '.env files', test: (f) => /(^|\/)\.env(\..*)?$/.test(f) },
  { label: 'local npm/git config', test: (f) => /(^|\/)\.npmrc$/.test(f) || /(^|\/)\.git\//.test(f) },
  { label: 'OS/editor cruft', test: (f) => /(^|\/)\.DS_Store$/.test(f) },
];

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-validate-dist-'));
  let tarballName;
  try {
    const packOutput = execFileSync('npm', ['pack', '--json', '--pack-destination', tmpDir], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    const packResult = JSON.parse(packOutput);
    tarballName = packResult[0]?.filename;
    if (!tarballName) throw new Error('npm pack did not report a tarball filename');

    const tarballPath = path.join(tmpDir, tarballName);
    const listing = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' });
    const files = listing.split('\n').map((line) => line.trim()).filter(Boolean);

    console.log(`Inspecting ${tarballName} (${files.length} entries)`);

    const failures = [];

    for (const { label, test } of requiredPatterns) {
      if (!test(files)) failures.push(`missing required asset: ${label}`);
      else console.log(`  ✓ ${label}`);
    }

    for (const { label, test } of forbiddenPatterns) {
      const offenders = files.filter(test);
      if (offenders.length > 0) {
        failures.push(`forbidden content present (${label}): ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? ', …' : ''}`);
      }
    }
    if (failures.length === 0) {
      console.log('  ✓ no forbidden paths found (.code-intel/, dist-tests/, .env, .npmrc, .git/, .DS_Store)');
    }

    // Tarball version must match package.json (release metadata consistency, task 3.4).
    const corePkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    if (packResult[0]?.name !== corePkg.name) {
      failures.push(`tarball package name "${packResult[0]?.name}" != package.json name "${corePkg.name}"`);
    }
    // npm pack --json includes version in packResult[0].version for modern npm.
    const tarballVersion = packResult[0]?.version;
    if (tarballVersion && tarballVersion !== corePkg.version) {
      failures.push(`tarball version "${tarballVersion}" != package.json version "${corePkg.version}"`);
    } else if (tarballVersion) {
      console.log(`  ✓ tarball version matches package.json (${tarballVersion})`);
    }

    if (failures.length > 0) {
      console.error('\n✗ npm tarball validation failed:');
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      console.log('\n✓ npm tarball contains required runtime assets and no forbidden content.');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
