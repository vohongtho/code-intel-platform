import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  abortIndexGeneration,
  cloneGenerationArtifact,
  createIndexGeneration,
  publishIndexGeneration,
  touchIndexGeneration,
  type ArtifactCloneMode,
  type IndexArtifactName,
  type IndexGeneration,
} from '../storage/index-generation.js';
import { acquireAnalyzeLock } from '../storage/analyze-lock.js';
import { findRepoByName, findRepoByPath } from '../storage/repo-registry.js';
import {
  getSnapshotArtifactPath,
  resolveIndexSnapshot,
  type IndexSnapshot,
} from '../storage/index-snapshot.js';
import { planAtomicAnalysis } from '../pipeline/analysis-plan.js';
import type { IndexMetadata } from '../storage/metadata.js';
import { DEFAULT_CONFIG, loadConfig } from './init-wizard.js';

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

function loadSnapshotMetadata(snapshot: IndexSnapshot | null): IndexMetadata | null {
  if (!snapshot || !fs.existsSync(snapshot.metadataPath)) return null;
  try { return JSON.parse(fs.readFileSync(snapshot.metadataPath, 'utf8')) as IndexMetadata; } catch { return null; }
}

export function seedIndexGeneration(
  repoDir: string,
  generation: IndexGeneration,
  snapshot: IndexSnapshot | null = resolveIndexSnapshot(repoDir),
  artifacts: IndexArtifactName[] = ['graph.db', 'bm25.db', 'vector.db', 'meta.json'],
): Partial<Record<IndexArtifactName, ArtifactCloneMode>> {
  const modes: Partial<Record<IndexArtifactName, ArtifactCloneMode>> = {};
  if (!snapshot) return modes;
  for (const artifact of artifacts) {
    const source = getSnapshotArtifactPath(snapshot, artifact);
    if (!fs.existsSync(source)) continue;
    const target = path.join(generation.stagingDir, artifact);
    modes[artifact] = cloneGenerationArtifact(source, target);
  }
  touchIndexGeneration(generation);
  return modes;
}

function runChild(args: string[], binUrl: URL, extraEnv: NodeJS.ProcessEnv = {}): number {
  const child = spawnSync(process.execPath, [fileURLToPath(binUrl), ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
      CODE_INTEL_ATOMIC_CHILD: '1',
    },
  });
  return child.status ?? 1;
}

/**
 * Run analyze against an isolated staging directory and publish only after all
 * required artifacts validate. A repository lock serializes analyze processes.
 */
export function runAtomicAnalyze(args: string[], binUrl: URL): number {
  const workspaceRoot = resolveAnalyzeWorkspaceRoot(args);
  let lock: ReturnType<typeof acquireAnalyzeLock> | null = null;
  try {
    const snapshot = resolveIndexSnapshot(workspaceRoot);
    const indexConfig = loadConfig()?.index ?? DEFAULT_CONFIG.index;
    const staleStagingMs = Math.max(1, indexConfig.staleStagingHours) * 60 * 60 * 1000;
    lock = acquireAnalyzeLock(workspaceRoot, {
      staleAfterMs: staleStagingMs,
      baseGenerationId: snapshot && !snapshot.legacy ? snapshot.generationId : undefined,
    });
    const previous = loadSnapshotMetadata(snapshot);
    const plan = planAtomicAnalysis(workspaceRoot, args, previous, snapshot);
    if (args.includes('--verbose')) {
      console.log('  Analysis plan:');
      console.log(`    mode: ${plan.mode}`);
      console.log(`    reason: ${plan.reason}`);
      if (plan.mode === 'publish') {
        console.log(`    graph: ${plan.graph}`);
        console.log(`    bm25: ${plan.bm25}`);
        console.log(`    vector: ${plan.vector}`);
        console.log(`    seed artifacts: ${plan.seedArtifacts.join(', ') || '(none)'}`);
      }
    }

    if (plan.mode === 'passthrough') {
      return runChild(args, binUrl);
    }
    if (plan.mode === 'noop') {
      const requestedRepoName = (() => {
        const nameFlagIndex = args.indexOf('--name');
        if (nameFlagIndex >= 0) return args[nameFlagIndex + 1]?.trim();
        const inline = args.find((arg) => arg.startsWith('--name='));
        return inline ? inline.slice('--name='.length).trim() : undefined;
      })();
      if (requestedRepoName) {
        const existingByPath = findRepoByPath(workspaceRoot);
        const existingByName = findRepoByName(requestedRepoName);
        if (existingByPath && existingByPath.name !== requestedRepoName) {
          throw new Error(`Path already indexed as "${existingByPath.name}". Use \`code-intel repo rename ${existingByPath.name} ${requestedRepoName}\`.`);
        }
        if (existingByName && existingByName.path !== workspaceRoot) {
          throw new Error(`Repository name "${requestedRepoName}" is linked to ${existingByName.path}. Use \`code-intel repo relink ${requestedRepoName} ${workspaceRoot}\`.`);
        }
      }
      console.log('  ✓ No source or index changes detected');
      console.log(`  ✓ Active generation preserved: ${snapshot?.generationId ?? 'legacy'}`);
      return 0;
    }

    const generation = createIndexGeneration(workspaceRoot, undefined, {
      baseGenerationId: snapshot && !snapshot.legacy ? snapshot.generationId : undefined,
    });
    lock.update({ stagingGenerationId: generation.generationId });
    const cloneModes = seedIndexGeneration(workspaceRoot, generation, snapshot, plan.seedArtifacts);
    if (args.includes('--verbose') && Object.keys(cloneModes).length > 0) {
      console.log(`    clone modes: ${Object.entries(cloneModes).map(([name, mode]) => `${name}=${mode}`).join(', ')}`);
    }
    const childArgs = [...args];

    if (
      previous?.embeddings?.enabled
      && !childArgs.includes('--embeddings')
      && !childArgs.includes('--skip-embeddings')
    ) {
      childArgs.push('--embeddings');
    }

    const childStatus = runChild(childArgs, binUrl, {
      CODE_INTEL_INDEX_STAGING_DIR: generation.stagingDir,
      CODE_INTEL_ANALYSIS_PLAN: JSON.stringify(plan),
    });
    if (childStatus !== 0) {
      abortIndexGeneration(generation);
      return childStatus;
    }

    try {
      touchIndexGeneration(generation);
      const metadata = JSON.parse(fs.readFileSync(generation.metadataPath, 'utf8')) as IndexMetadata;
      metadata.generationId = generation.generationId;
      publishIndexGeneration(workspaceRoot, generation, metadata, {
        vectorRequired: Boolean(metadata.embeddings?.enabled && metadata.embeddings.status === 'ready'),
        keepGenerations: Math.max(1, Math.floor(indexConfig.keepGenerations)),
        staleStagingMs,
      });
      return 0;
    } catch (error) {
      abortIndexGeneration(generation);
      console.error(`Atomic index publication failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    lock?.release();
  }
}
