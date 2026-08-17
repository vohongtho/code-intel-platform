import fs from 'node:fs';
import path from 'node:path';

export interface BundledRuntimeManifestSummary {
  product?: {
    version?: string;
    commitSha?: string;
  };
  bundledNode?: {
    pinnedVersion?: string;
    requiredRange?: string | null;
  };
  bundleBuild?: {
    target?: string;
    archive?: string;
  };
  executable?: {
    launcher?: string;
    entrypoint?: string;
  };
}

export interface BundledRuntimeMetadata {
  bundled: boolean;
  scriptPath: string;
  manifestPath: string | null;
  currentRoot: string | null;
  launcherPath: string | null;
  nodePath: string | null;
  appEntrypoint: string | null;
  manifest: BundledRuntimeManifestSummary | null;
}

function candidateManifestPaths(scriptPath: string): string[] {
  const dir = path.dirname(path.resolve(scriptPath));
  return [
    path.join(dir, '../../../../../runtime-manifest.json'),
    path.join(dir, '../../../../runtime-manifest.json'),
    path.join(dir, '../../../runtime-manifest.json'),
  ].map((value) => path.resolve(value));
}

export function loadBundledRuntimeMetadata(scriptPath = process.argv[1] ?? ''): BundledRuntimeMetadata {
  const resolvedScript = scriptPath ? path.resolve(scriptPath) : '';
  for (const manifestPath of candidateManifestPaths(resolvedScript)) {
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BundledRuntimeManifestSummary;
      const currentRoot = path.dirname(manifestPath);
      const nodePath = path.join(currentRoot, 'runtime', 'bin', 'node');
      const appEntrypoint = path.join(currentRoot, 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js');
      const launcherPath = path.join(currentRoot, '..', '..', 'bin', 'code-intel');
      return {
        bundled: true,
        scriptPath: resolvedScript,
        manifestPath,
        currentRoot,
        launcherPath,
        nodePath,
        appEntrypoint,
        manifest,
      };
    } catch {
      return {
        bundled: true,
        scriptPath: resolvedScript,
        manifestPath,
        currentRoot: path.dirname(manifestPath),
        launcherPath: path.resolve(path.dirname(manifestPath), '..', '..', 'bin', 'code-intel'),
        nodePath: path.resolve(path.dirname(manifestPath), 'runtime', 'bin', 'node'),
        appEntrypoint: path.resolve(path.dirname(manifestPath), 'app', 'code-intel', 'core', 'dist', 'cli', 'main.js'),
        manifest: null,
      };
    }
  }

  return {
    bundled: false,
    scriptPath: resolvedScript,
    manifestPath: null,
    currentRoot: null,
    launcherPath: null,
    nodePath: null,
    appEntrypoint: null,
    manifest: null,
  };
}
