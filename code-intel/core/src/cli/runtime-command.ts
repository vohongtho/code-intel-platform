import path from 'node:path';
import { loadBundledRuntimeMetadata } from './runtime-metadata.js';

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function fallbackBundledLauncher(scriptPath: string): string | null {
  const currentRoot = process.env['CODE_INTEL_BUNDLED_CURRENT_ROOT']?.trim();
  if (currentRoot) return path.resolve(currentRoot, '..', 'bin', 'code-intel');
  const resolved = path.resolve(scriptPath);
  if (!resolved) return null;
  const bundledSuffix = `${path.sep}current${path.sep}app${path.sep}code-intel${path.sep}core${path.sep}dist${path.sep}cli${path.sep}main.js`;
  if (!resolved.endsWith(bundledSuffix)) return null;
  return path.resolve(path.dirname(resolved), '../../../../../../bin/code-intel');
}

export function resolveStableCliCommand(scriptPath = process.argv[1] ?? ''): string {
  const runtime = loadBundledRuntimeMetadata(scriptPath);
  return runtime.launcherPath ? path.resolve(runtime.launcherPath) : (fallbackBundledLauncher(scriptPath) ?? 'code-intel');
}

export function resolveStableHookCommand(agent: string, scriptPath = process.argv[1] ?? ''): string {
  return `${shellQuote(resolveStableCliCommand(scriptPath))} hook ${agent}`;
}

export function resolveStableMcpConfig(repoRoot: string, scriptPath = process.argv[1] ?? ''): { command: string; args: string[] } {
  return {
    command: resolveStableCliCommand(scriptPath),
    args: ['mcp', repoRoot],
  };
}
