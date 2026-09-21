import fs from 'node:fs';
import path from 'node:path';
import { createKnowledgeGraph } from '../graph/knowledge-graph.js';
import { DbManager } from '../storage/db-manager.js';
import { getDbPath } from '../storage/metadata.js';
import { verifyIndexTrust, upgradeLegacyIndexMetadata } from '../storage/index-trust.js';
import { CURRENT_SCHEMA_VERSION } from '../migrations/migration-runner.js';
import { loadGraphFromDB } from '../multi-repo/graph-from-db.js';
import { buildChangeContext } from '../query/change-context.js';
import { parseDiffFiles } from '../query/pr-impact.js';
import { startChangeContextHttp, startChangeContextMcp } from './change-context-transports.js';
import { DEFAULT_CONFIG, loadConfig } from './init-wizard.js';
import {
  applyAnalyzeUnlock,
  applyIndexCleanup,
  planAnalyzeUnlock,
  planIndexCleanup,
} from '../storage/index-maintenance.js';
import { collectDoctorChecks } from './doctor.js';
import {
  cleanupRuntimeVersions,
  installRuntimeUpgrade,
  listInstalledRuntimeVersions,
  pinRuntimeVersion,
  previewRuntimeUninstall,
  rollbackRuntimeVersion,
  uninstallRuntime,
} from './runtime-lifecycle.js';

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(args: string[], name: string): number | undefined {
  const value = optionValue(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function loadGraph(repoDir: string) {
  const dbPath = getDbPath(repoDir);
  if (!fs.existsSync(dbPath)) throw new Error(`Index graph not found: ${dbPath}`);
  const graph = createKnowledgeGraph();
  const db = new DbManager(dbPath, true);
  await db.init();
  try {
    await loadGraphFromDB(graph, db);
  } finally {
    db.close();
  }
  return graph;
}

async function runIndexStatus(args: string[]): Promise<void> {
  const repoDir = path.resolve(args[0] && !args[0].startsWith('-') ? args[0] : '.');
  let result = verifyIndexTrust(repoDir);
  if (args.includes('--upgrade-legacy') && result.state === 'legacy') {
    upgradeLegacyIndexMetadata(repoDir, CURRENT_SCHEMA_VERSION);
    result = verifyIndexTrust(repoDir);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.state === 'corrupt' || result.state === 'missing') process.exitCode = 2;
  else if (result.state === 'stale' || result.state === 'legacy') process.exitCode = 1;
}

async function runIndexMaintenance(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const repoDir = path.resolve(rest[0] && !rest[0].startsWith('-') ? rest[0] : '.');
  if (subcommand === 'cleanup') {
    const config = loadConfig()?.index ?? DEFAULT_CONFIG.index;
    const keep = numberOption(rest, '--keep') ?? config.keepGenerations;
    const staleHours = numberOption(rest, '--stale-hours') ?? config.staleStagingHours;
    const plan = planIndexCleanup(repoDir, {
      keepGenerations: keep,
      staleStagingMs: Math.max(0, staleHours) * 60 * 60 * 1000,
      removeLegacy: rest.includes('--remove-legacy'),
    });
    if (!rest.includes('--dry-run')) applyIndexCleanup(plan);
    process.stdout.write(`${JSON.stringify({ dryRun: rest.includes('--dry-run'), ...plan }, null, 2)}\n`);
    return;
  }
  if (subcommand === 'unlock') {
    const plan = planAnalyzeUnlock(repoDir, rest.includes('--force'));
    if (plan.exists) applyAnalyzeUnlock(plan);
    process.stdout.write(`${JSON.stringify({ removed: plan.exists && plan.removable, ...plan }, null, 2)}\n`);
    return;
  }
  throw new Error('Usage: code-intel index cleanup [path] [--dry-run] [--keep N] [--stale-hours N] [--remove-legacy] | code-intel index unlock [path] [--force]');
}

async function runChangeContext(args: string[]): Promise<void> {
  const repoDir = path.resolve(args[0] && !args[0].startsWith('-') ? args[0] : '.');
  const fileOption = optionValue(args, '--files');
  const diffFile = optionValue(args, '--diff-file');
  let changedFiles = fileOption?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  if (diffFile) {
    const diff = fs.readFileSync(path.resolve(diffFile), 'utf8');
    changedFiles = [...new Set([...changedFiles, ...parseDiffFiles(diff)])];
  }
  if (changedFiles.length === 0) {
    throw new Error('Provide --files file1,file2 or --diff-file path/to/change.diff');
  }
  const graph = await loadGraph(repoDir);
  const result = buildChangeContext(graph, {
    changedFiles,
    maxHops: numberOption(args, '--max-hops'),
    maxTokens: numberOption(args, '--max-tokens'),
    maxChangedSymbols: numberOption(args, '--max-symbols'),
    repoDir,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runChangeContextMcp(args: string[]): Promise<void> {
  const repoDir = path.resolve(args[0] && !args[0].startsWith('-') ? args[0] : '.');
  const graph = await loadGraph(repoDir);
  await startChangeContextMcp({ repoDir, graph });
}

async function runChangeContextHttp(args: string[]): Promise<void> {
  const repoDir = path.resolve(args[0] && !args[0].startsWith('-') ? args[0] : '.');
  const graph = await loadGraph(repoDir);
  const port = numberOption(args, '--port') ?? 30128;
  const host = optionValue(args, '--host') ?? '127.0.0.1';
  startChangeContextHttp({ repoDir, graph }, port, host);
}

async function runDoctor(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const checks = await collectDoctorChecks({ scriptPath: process.argv[1], repoDir: process.cwd() });
  const hasFailure = checks.some((check) => check.status === 'fail');

  if (json) {
    process.stdout.write(`${JSON.stringify({ version: 1, ok: !hasFailure, checks }, null, 2)}\n`);
    process.exitCode = hasFailure ? 1 : 0;
    return;
  }

  process.stdout.write('\n  ◈  code-intel doctor\n\n');
  for (const check of checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️ ' : '❌';
    process.stdout.write(`  ${icon}  ${check.id.padEnd(24)} ${check.message}\n`);
    if (check.remediation) process.stdout.write(`       remediation: ${check.remediation}\n`);
  }
  process.stdout.write(`\n  ${hasFailure ? '✗' : '✅'}  ${hasFailure ? 'One or more checks failed.' : 'All checks passed.'}\n\n`);
  process.exitCode = hasFailure ? 1 : 0;
}

function runVersionList(args: string[]): void {
  const json = args.includes('--json');
  const versions = listInstalledRuntimeVersions(process.argv[1], optionValue(args, '--install-root'));
  if (json) {
    process.stdout.write(`${JSON.stringify({ versions }, null, 2)}\n`);
    return;
  }
  if (versions.length === 0) {
    process.stdout.write('No installed bundled runtime versions found.\n');
    return;
  }
  for (const version of versions) {
    const flags = [version.current ? 'current' : null, version.pinned ? 'pinned' : null].filter(Boolean).join(', ');
    process.stdout.write(`${version.version}${flags ? ` (${flags})` : ''}\n`);
  }
}

function runVersionPin(args: string[]): void {
  const version = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
  if (!version) throw new Error('Usage: code-intel version pin <version> [--install-root <path>]');
  const pinned = pinRuntimeVersion(version, process.argv[1], optionValue(args, '--install-root'));
  process.stdout.write(`${JSON.stringify({ pinned: pinned.version }, null, 2)}\n`);
}

function runRollback(args: string[]): void {
  const version = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
  const rolled = rollbackRuntimeVersion(version, process.argv[1], optionValue(args, '--install-root'));
  process.stdout.write(`${JSON.stringify({ current: rolled.version }, null, 2)}\n`);
}

function runUpgrade(args: string[]): void {
  const archive = optionValue(args, '--archive');
  if (!archive) throw new Error('Usage: code-intel upgrade --archive <path> [--checksum <sha256> | --checksum-file <path>] [--version <v>]');
  const result = installRuntimeUpgrade({
    archive,
    checksum: optionValue(args, '--checksum'),
    checksumFile: optionValue(args, '--checksum-file'),
    installRoot: optionValue(args, '--install-root'),
    tempRoot: optionValue(args, '--temp-root'),
    expectedVersion: optionValue(args, '--version'),
    skipPathCheck: args.includes('--skip-path-check'),
    scriptPath: process.argv[1],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function runCleanupVersions(args: string[]): void {
  const removed = cleanupRuntimeVersions(process.argv[1], optionValue(args, '--install-root'));
  process.stdout.write(`${JSON.stringify({ removed }, null, 2)}\n`);
}

function runUninstall(args: string[]): void {
  const purgeData = args.includes('--purge-data');
  const yes = args.includes('--yes');
  const json = args.includes('--json');
  const dryRun = args.includes('--dry-run');
  const preview = previewRuntimeUninstall({ purgeData, dataRoot: optionValue(args, '--data-root'), scriptPath: process.argv[1] });

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ preview, destructive: purgeData }, null, 2)}\n`);
    return;
  }
  if (purgeData && !yes) {
    throw new Error('Refusing destructive uninstall without --yes when --purge-data is set.');
  }

  const result = uninstallRuntime({ purgeData, dataRoot: optionValue(args, '--data-root'), scriptPath: process.argv[1] });
  process.stdout.write(`${JSON.stringify(json ? result : { removedPaths: result.removedPaths, purgedData: result.purgedData, dataRoot: result.dataRoot }, null, 2)}\n`);
}

export async function runStandaloneCommand(argv: string[]): Promise<boolean> {
  const [command, ...args] = argv;
  if (command === 'index-status') {
    await runIndexStatus(args);
    return true;
  }
  if (command === 'index') {
    await runIndexMaintenance(args);
    return true;
  }
  if (command === 'change-context') {
    await runChangeContext(args);
    return true;
  }
  if (command === 'change-context-mcp') {
    await runChangeContextMcp(args);
    return true;
  }
  if (command === 'change-context-http') {
    await runChangeContextHttp(args);
    return true;
  }
  if (command === 'doctor') {
    await runDoctor(args);
    return true;
  }
  if (command === 'upgrade') {
    runUpgrade(args);
    return true;
  }
  if (command === 'rollback') {
    runRollback(args);
    return true;
  }
  if (command === 'uninstall') {
    runUninstall(args);
    return true;
  }
  if (command === 'version') {
    const [subcommand, ...rest] = args;
    if (subcommand === 'list') {
      runVersionList(rest);
      return true;
    }
    if (subcommand === 'pin') {
      runVersionPin(rest);
      return true;
    }
  }
  if (command === 'runtime-cleanup') {
    runCleanupVersions(args);
    return true;
  }
  return false;
}
