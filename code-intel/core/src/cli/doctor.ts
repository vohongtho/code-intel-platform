import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { loadConfig } from './init-wizard.js';
import { verifyIndexTrust } from '../storage/index-trust.js';
import { loadBundledRuntimeMetadata, type BundledRuntimeMetadata } from './runtime-metadata.js';
import { resolveSetupPlan } from './setup-plan.js';
import Logger from '../shared/logger.js';
import { getDefaultEmbeddingModel } from '../search/embedding-model-registry.js';
import { Language } from '../shared/index.js';
import { isTreeSitterAvailable } from '../parsing/parser-manager.js';
import { resolveVectorRuntimeState } from '../search/vector-runtime-state.js';
import { getVectorDbPath, loadMetadata } from '../storage/metadata.js';
import { listInstalledRuntimeVersions, previewRuntimeUninstall } from './runtime-lifecycle.js';
import { resolveStableCliCommand } from './runtime-command.js';

export interface DoctorCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: Record<string, unknown>;
  remediation?: string;
}

function resolveGlobalDir(): string {
  return process.env['CODE_INTEL_GLOBAL_DIR'] ?? path.join(os.homedir(), '.code-intel');
}

function classifyNodeVersion(version: string): DoctorCheck {
  const [major] = version.split('.').map(Number);
  return (major ?? 0) >= 22
    ? { id: 'node-version', status: 'pass', message: `Node.js ${version}`, details: { version, required: '>=22.0.0' } }
    : { id: 'node-version', status: 'warn', message: `Node.js ${version}`, details: { version, required: '>=22.0.0' }, remediation: 'Install Node.js 22 or newer.' };
}

function gitCheck(): DoctorCheck {
  try {
    const version = execSync('git --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return { id: 'git', status: 'pass', message: version, details: { version } };
  } catch {
    return { id: 'git', status: 'warn', message: 'git not found in PATH', remediation: 'Install git to enable incremental analysis.' };
  }
}

function configCheck(): DoctorCheck {
  const cfg = loadConfig();
  if (!cfg?.serve) {
    return { id: 'config', status: 'warn', message: 'Config not found', remediation: 'Run `code-intel init`.' };
  }
  return { id: 'config', status: 'pass', message: 'Config present', details: { globalDir: resolveGlobalDir(), defaultPort: cfg.serve.defaultPort } };
}

function runtimeCheck(scriptPath?: string): DoctorCheck {
  const runtime = loadBundledRuntimeMetadata(scriptPath);
  if (!runtime.bundled) {
    return { id: 'runtime-launcher', status: 'warn', message: 'Running outside bundled runtime', remediation: 'Use the stable self-contained launcher to verify bundled runtime metadata.' };
  }
  const nodeOk = Boolean(runtime.nodePath && fs.existsSync(runtime.nodePath));
  const entryOk = Boolean(runtime.appEntrypoint && fs.existsSync(runtime.appEntrypoint));
  return {
    id: 'runtime-launcher',
    status: nodeOk && entryOk ? 'pass' : 'fail',
    message: nodeOk && entryOk ? 'Bundled runtime detected' : 'Bundled runtime incomplete',
    details: {
      manifestPath: runtime.manifestPath,
      launcherPath: runtime.launcherPath,
      nodePath: runtime.nodePath,
      appEntrypoint: runtime.appEntrypoint,
      target: runtime.manifest?.bundleBuild?.target,
      nodeVersion: runtime.manifest?.bundledNode?.pinnedVersion,
      appVersion: runtime.manifest?.product?.version,
      commitSha: runtime.manifest?.product?.commitSha,
    },
    remediation: nodeOk && entryOk ? undefined : 'Reinstall or rebuild the self-contained runtime bundle.',
  };
}

function writableCheck(): DoctorCheck {
  const globalDir = resolveGlobalDir();
  const tmpFile = path.join(globalDir, `.doctor-write-${process.pid}`);
  try {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(tmpFile, 'ok');
    fs.unlinkSync(tmpFile);
    return { id: 'global-dir', status: 'pass', message: 'Global config dir writable', details: { globalDir } };
  } catch (error) {
    return { id: 'global-dir', status: 'fail', message: 'Global config dir not writable', details: { globalDir, error: error instanceof Error ? error.message : String(error) }, remediation: 'Fix permissions for the Code Intel global directory.' };
  }
}

function logsCheck(): DoctorCheck {
  const logDir = Logger.LOG_DIR;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    return { id: 'logs-dir', status: 'pass', message: 'Log directory writable', details: { logDir } };
  } catch (error) {
    return { id: 'logs-dir', status: 'warn', message: 'Log directory not writable', details: { logDir, error: error instanceof Error ? error.message : String(error) }, remediation: 'Fix permissions if file logging is required.' };
  }
}

function setupPlanCheck(scriptPath?: string): DoctorCheck {
  const plan = resolveSetupPlan(process.cwd());
  return {
    id: 'setup-selection',
    status: plan.selectionStatus === 'valid' || plan.selectionStatus === 'all-agents' ? 'pass' : 'warn',
    message: `Setup selection ${plan.selectionStatus}`,
    details: {
      repositoryRoot: plan.repositoryRoot,
      selectionPath: plan.selectionPath,
      integrations: plan.integrations,
      unknownAgents: plan.unknownAgents,
      stableLauncher: resolveStableCliCommand(scriptPath),
    },
    remediation: plan.selectionStatus === 'missing' ? 'Run `code-intel analyze` or `code-intel setup --all-agents` before setup.' : undefined,
  };
}

async function parserCheck(): Promise<DoctorCheck> {
  const languages = [Language.TypeScript, Language.JavaScript, Language.Python, Language.Go, Language.Rust];
  const results = await Promise.all(languages.map(async (language) => ({ language, ok: await isTreeSitterAvailable(language) })));
  const missing = results.filter((entry) => !entry.ok).map((entry) => entry.language);
  return {
    id: 'tree-sitter-wasm',
    status: missing.length === 0 ? 'pass' : 'fail',
    message: missing.length === 0 ? 'Canonical parser WASM assets available' : 'Missing parser WASM assets',
    details: { checked: results },
    remediation: missing.length === 0 ? undefined : 'Rebuild or reinstall bundled parser assets.',
  };
}

async function repoVectorCheck(repoDir: string): Promise<DoctorCheck> {
  const metadata = loadMetadata(repoDir);
  if (!metadata?.embeddings?.enabled) {
    return { id: 'vector-runtime', status: 'warn', message: 'Embeddings not enabled for current repo', remediation: 'Run `code-intel analyze --embeddings` to build vector search assets.' };
  }
  const descriptor = getDefaultEmbeddingModel();
  const state = await resolveVectorRuntimeState({
    vectorDbPath: getVectorDbPath(repoDir),
    descriptor,
    runtimeFingerprint: {
      provider: descriptor.provider,
      model: descriptor.id,
      dimension: descriptor.dimension,
    },
    metadata,
  });
  return {
    id: 'vector-runtime',
    status: state.ready ? 'pass' : state.status === 'missing' || state.status === 'stale' ? 'warn' : 'fail',
    message: state.reason ?? state.status,
    details: {
      status: state.status,
      vectorDbPath: state.vectorDbPath,
      descriptor: state.descriptor,
    },
    remediation: state.ready ? undefined : 'Run `code-intel analyze --embeddings` to rebuild vector artifacts.',
  };
}

function repoTrustCheck(repoDir: string): DoctorCheck {
  const trust = verifyIndexTrust(repoDir);
  return {
    id: 'repo-index-trust',
    status: trust.state === 'trusted' ? 'pass' : trust.state === 'stale' || trust.state === 'legacy' ? 'warn' : 'fail',
    message: `Index state: ${trust.state}`,
    details: {
      reasons: trust.reasons,
      generationId: trust.generationId,
      currentCommit: trust.currentCommit,
      artifacts: trust.artifacts,
    },
    remediation: trust.state === 'trusted' ? undefined : 'Run `code-intel analyze` or `code-intel clean && code-intel analyze`.',
  };
}

function pathConflictCheck(runtime: BundledRuntimeMetadata): DoctorCheck {
  const launcherPath = runtime.launcherPath ? path.resolve(runtime.launcherPath) : null;
  const found: Array<{ path: string; resolved: string }> = [];
  for (const segment of (process.env['PATH'] || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(segment, process.platform === 'win32' ? 'code-intel.cmd' : 'code-intel');
    if (!fs.existsSync(candidate)) continue;
    const resolved = fs.realpathSync(candidate);
    if (launcherPath && resolved === launcherPath) continue;
    found.push({ path: candidate, resolved });
  }
  return {
    id: 'path-conflicts',
    status: found.length === 0 ? 'pass' : 'warn',
    message: found.length === 0 ? 'No conflicting code-intel executables on PATH' : 'Conflicting code-intel executables detected on PATH',
    details: { conflicts: found },
    remediation: found.length === 0 ? undefined : 'Move the stable launcher earlier in PATH or remove conflicting entries.',
  };
}

function runtimeVersionsCheck(scriptPath?: string): DoctorCheck {
  const versions = listInstalledRuntimeVersions(scriptPath);
  const current = versions.find((entry) => entry.current)?.version ?? null;
  const pinned = versions.find((entry) => entry.pinned)?.version ?? null;
  return {
    id: 'runtime-versions',
    status: versions.length > 0 ? 'pass' : 'warn',
    message: versions.length > 0 ? `Installed bundled runtime versions: ${versions.length}` : 'No bundled runtime versions discovered',
    details: {
      current,
      pinned,
      versions: versions.map((entry) => ({ version: entry.version, current: entry.current, pinned: entry.pinned, target: entry.target })),
    },
    remediation: versions.length > 0 ? undefined : 'Install a self-contained runtime bundle to enable rollback and uninstall management.',
  };
}

function uninstallOwnershipCheck(scriptPath?: string): DoctorCheck {
  const preview = previewRuntimeUninstall({ scriptPath });
  return {
    id: 'runtime-uninstall',
    status: 'pass',
    message: 'Managed uninstall inventory available',
    details: {
      installRoot: preview.installRoot,
      managedPaths: preview.managedPaths,
      dataRoot: preview.dataRoot,
      dataInventory: preview.dataInventory,
    },
  };
}

export async function collectDoctorChecks(options: { scriptPath?: string; repoDir?: string } = {}): Promise<DoctorCheck[]> {
  const repoDir = options.repoDir ?? process.cwd();
  const runtime = loadBundledRuntimeMetadata(options.scriptPath);
  return [
    classifyNodeVersion(process.versions.node),
    gitCheck(),
    configCheck(),
    runtimeCheck(options.scriptPath),
    runtimeVersionsCheck(options.scriptPath),
    uninstallOwnershipCheck(options.scriptPath),
    writableCheck(),
    logsCheck(),
    setupPlanCheck(options.scriptPath),
    await parserCheck(),
    repoTrustCheck(repoDir),
    await repoVectorCheck(repoDir),
    pathConflictCheck(runtime),
  ];
}
