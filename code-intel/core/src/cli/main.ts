#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runStandaloneCommand } from './standalone-commands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
const arg = process.argv[2];

if (process.argv.length === 3 && (arg === '--version' || arg === '-V')) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

if (await runStandaloneCommand(process.argv.slice(2))) {
  process.exit(process.exitCode ?? 0);
}

const appUrl = new URL('./app.js', import.meta.url);
await import(appUrl.href);
