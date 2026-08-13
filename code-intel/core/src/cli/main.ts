#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runStandaloneCommand } from './standalone-commands.js';
import { runAtomicAnalyze } from './atomic-analyze.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadPackageMeta(): { version: string } {
  for (const candidate of [
    path.join(__dirname, '../../package.json'),
    path.join(__dirname, '../../../package.json'),
    path.join(__dirname, '../../../../package.json'),
  ]) {
    if (!existsSync(candidate)) continue;
    try {
      return JSON.parse(readFileSync(candidate, 'utf-8')) as { version: string };
    } catch {
      // Try next candidate.
    }
  }
  return { version: '0.0.0' };
}

const pkg = loadPackageMeta();
const arg = process.argv[2];

if (process.argv.length === 3 && (arg === '--version' || arg === '-V')) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

if (await runStandaloneCommand(process.argv.slice(2))) {
  process.exit(process.exitCode ?? 0);
}

if (arg === 'analyze' && process.env['CODE_INTEL_ATOMIC_CHILD'] !== '1') {
  const status = runAtomicAnalyze(process.argv.slice(2), new URL(import.meta.url));
  process.exit(status);
}

const appUrl = new URL('./app.js', import.meta.url);
await import(appUrl.href);
