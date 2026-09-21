import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadBundledRuntimeMetadata, type BundledRuntimeMetadata } from './runtime-metadata.js';

export interface LauncherRunOptions {
  scriptPath?: string;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

function resolveBundledNode(metadata: BundledRuntimeMetadata): string {
  if (!metadata.nodePath || !fs.existsSync(metadata.nodePath)) {
    throw new Error(`Bundled Node runtime not found: ${metadata.nodePath ?? '(missing path)'}`);
  }
  return metadata.nodePath;
}

function resolveBundledEntrypoint(metadata: BundledRuntimeMetadata): string {
  if (!metadata.appEntrypoint || !fs.existsSync(metadata.appEntrypoint)) {
    throw new Error(`Bundled CLI entrypoint not found: ${metadata.appEntrypoint ?? '(missing path)'}`);
  }
  return metadata.appEntrypoint;
}

export async function runBundledLauncher(options: LauncherRunOptions = {}): Promise<number | null> {
  const metadata = loadBundledRuntimeMetadata(options.scriptPath);
  if (!metadata.bundled) return null;

  const nodePath = resolveBundledNode(metadata);
  const entrypoint = resolveBundledEntrypoint(metadata);
  const argv = options.argv ?? process.argv.slice(2);
  const child = spawn(nodePath, [entrypoint, ...argv], {
    stdio: 'inherit',
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...options.env,
      CODE_INTEL_RUNTIME_ACTIVE: '1',
      CODE_INTEL_RUNTIME_MANIFEST_PATH: metadata.manifestPath ?? '',
      CODE_INTEL_BUNDLED_NODE_PATH: nodePath,
      CODE_INTEL_BUNDLED_CURRENT_ROOT: metadata.currentRoot ?? '',
      CODE_INTEL_LAUNCHER_PATH: metadata.launcherPath ?? '',
    },
  });

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const handler = () => {
      if (!child.killed) child.kill(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return await new Promise<number>((resolve, reject) => {
    child.once('error', (error) => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      for (const [registeredSignal, handler] of handlers) process.off(registeredSignal, handler);
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

export function formatVersionOutput(appVersion: string, scriptPath = process.argv[1] ?? ''): string {
  const metadata = loadBundledRuntimeMetadata(scriptPath);
  if (!metadata.bundled) return appVersion;
  const target = metadata.manifest?.bundleBuild?.target;
  const node = metadata.manifest?.bundledNode?.pinnedVersion;
  const parts = [appVersion];
  if (target) parts.push(target);
  if (node) parts.push(`node ${String(node).replace(/^v/, 'v')}`);
  return parts.join(' ');
}
