#!/usr/bin/env node
import fs from 'node:fs';

const logPath = process.argv[2];
const input = logPath
  ? fs.readFileSync(logPath, 'utf8')
  : fs.readFileSync(0, 'utf8');

const banned = [
  'npm warn ERESOLVE overriding peer dependency',
  'deprecated prebuild-install@7.1.3',
  'deprecated boolean@3.2.0',
  'deprecated node-domexception@1.0.0',
  'deprecated glob@10.5.0',
  'requires a system Node/npm',
  'Bundled Node runtime not found',
];

const found = banned.filter((line) => input.includes(line));
if (found.length === 0) {
  console.log('install log clean');
  process.exit(0);
}

console.error('install log contains banned warnings:');
for (const line of found) console.error(`- ${line}`);
process.exit(1);
