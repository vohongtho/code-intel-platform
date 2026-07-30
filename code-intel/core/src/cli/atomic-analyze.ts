import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  abortIndexGeneration,
  createIndexGeneration,
  publishIndexGeneration,
} from '../storage/index-generation.js';
import { loadMetadata, type IndexMetadata } from '../storage/metadata.js';

function targetPathFromArgs(args: string[]): string {
  const analyzeIndex = args.indexOf('analyze');
  if (analyzeIndex < 0) return process.cwd();
  const candidate = args.slice(analyzeIndex + 1).find((value) => !value.startsWith('-'));
  return path.resolve(candidate ?? '.');
}

/**
 * Run the existing analyze command against an isolated staging directory and
 * publish it by swapping current.json only after the child exits successfully.
 */
export function runAtomicAnalyze(args: string[], binUrl: URL): number {
  const workspaceRoot = targetPathFromArgs(args);
  const generation = createIndexGeneration(workspaceRoot);
  const previous = loadMetadata(workspaceRoot);
  const childArgs = [...args];

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
