import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  abortIndexGeneration,
  createIndexGeneration,
  publishIndexGeneration,
  resolvePublishedArtifactPath,
  type IndexArtifactName,
  type IndexGeneration,
} from '../storage/index-generation.js';
import { loadMetadata, type IndexMetadata } from '../storage/metadata.js';

const ANALYZE_VALUE_OPTIONS = new Set([
  '--name', '--llm-provider', '--llm-model', '--llm-base-url', '--llm-api-key',
  '--llm-batch-size', '--llm-max-nodes', '--max-memory',
]);
const ANALYZE_VARIADIC_OPTIONS = new Set(['--skip-folders', '--skip-files']);

export function resolveAnalyzeWorkspaceRoot(args: string[], cwd = process.cwd()): string {
  const analyzeIndex = args.indexOf('analyze');
  if (analyzeIndex < 0) return cwd;
  for (let i = analyzeIndex + 1; i < args.length; i += 1) {
    const token = args[i]!;
    if (token === '--') {
      const positional = args[i + 1];
      return path.resolve(cwd, positional ?? '.');
    }
    if (!token.startsWith('-')) return path.resolve(cwd, token);
    const optionName = token.split('=', 1)[0]!;
    if (token.includes('=')) continue;
    if (ANALYZE_VALUE_OPTIONS.has(optionName)) {
      i += 1;
      continue;
    }
    if (ANALYZE_VARIADIC_OPTIONS.has(optionName)) {
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) i += 1;
    }
  }
  return cwd;
}

export function seedIndexGeneration(repoDir: string, generation: IndexGeneration): void {
  const artifacts: IndexArtifactName[] = ['graph.db', 'bm25.db', 'vector.db', 'meta.json'];
  for (const artifact of artifacts) {
    const source = resolvePublishedArtifactPath(repoDir, artifact);
    if (!fs.existsSync(source)) continue;
    const target = path.join(generation.stagingDir, artifact);
    fs.copyFileSync(source, target);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${source}${suffix}`;
      if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, `${target}${suffix}`);
    }
  }
}

/**
 * Run the existing analyze command against an isolated staging directory and
 * publish it by swapping current.json only after the child exits successfully.
 */
export function runAtomicAnalyze(args: string[], binUrl: URL): number {
  const workspaceRoot = resolveAnalyzeWorkspaceRoot(args);
  const generation = createIndexGeneration(workspaceRoot);
  const previous = loadMetadata(workspaceRoot);
  const childArgs = [...args];

  seedIndexGeneration(workspaceRoot, generation);

  if (
    previous?.embeddings?.enabled
    && !childArgs.includes('--embeddings')
    && !childArgs.includes('--skip-embeddings')
  ) {
    childArgs.push('--embeddings');
  }

  const child = spawnSync(process.execPath, [fileURLToPath(binUrl), ...childArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CODE_INTEL_ATOMIC_CHILD: '1',
      CODE_INTEL_INDEX_STAGING_DIR: generation.stagingDir,
    },
  });

  if (child.status !== 0) {
    abortIndexGeneration(generation);
    return child.status ?? 1;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(generation.metadataPath, 'utf8')) as IndexMetadata;
    metadata.generationId = generation.generationId;
    publishIndexGeneration(workspaceRoot, generation, metadata, {
      vectorRequired: Boolean(metadata.embeddings?.enabled && metadata.embeddings.status === 'ready'),
    });
    return 0;
  } catch (error) {
    abortIndexGeneration(generation);
    console.error(`Atomic index publication failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
