#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const RUNTIME_VARIANTS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'];

function packageName(variant) {
  return `@ladybugdb/core-${variant}`;
}

export function listMissingRuntimeNativePackages(root = repoRoot) {
  return RUNTIME_VARIANTS
    .map(packageName)
    .filter((name) => !fs.existsSync(path.join(root, 'node_modules', name)));
}

export function prepareRuntimeNativePackages(root = repoRoot) {
  const corePackagePath = path.join(root, 'node_modules/@ladybugdb/core/package.json');
  if (!fs.existsSync(corePackagePath)) {
    throw new Error(`Missing @ladybugdb/core package: ${corePackagePath}. Run npm ci first.`);
  }
  const version = JSON.parse(fs.readFileSync(corePackagePath, 'utf8')).version;
  const missing = listMissingRuntimeNativePackages(root);

  for (const name of missing) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-native-package-'));
    try {
      const tarball = execFileSync('npm', [
        'pack',
        `${name}@${version}`,
        '--silent',
        '--pack-destination',
        workDir,
      ], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).at(-1);
      if (!tarball) throw new Error(`npm pack returned no archive for ${name}@${version}`);

      execFileSync('tar', ['-xzf', path.join(workDir, tarball), '-C', workDir]);
      const destination = path.join(root, 'node_modules', name);
      fs.mkdirSync(destination, { recursive: true });
      fs.cpSync(path.join(workDir, 'package'), destination, { recursive: true });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  const remaining = listMissingRuntimeNativePackages(root);
  if (remaining.length > 0) {
    throw new Error(`Missing runtime native packages after preparation: ${remaining.join(', ')}`);
  }
  return missing;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const installed = prepareRuntimeNativePackages();
    process.stdout.write(installed.length > 0
      ? `Prepared ${installed.join(', ')}\n`
      : 'All runtime native packages are already present.\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
