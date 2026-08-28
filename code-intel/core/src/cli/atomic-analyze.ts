import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
import { reconcileRegistryEntry } from '../storage/registry-reconciliation.js';
import {
  getSnapshotArtifactPath,
  resolveIndexSnapshot,
  type IndexSnapshot,
} from '../storage/index-snapshot.js';
import { planAtomicAnalysis } from '../pipeline/analysis-plan.js';
import type { IndexMetadata } from '../storage/metadata.js';
import { DEFAULT_CONFIG, loadConfig } from './init-wizard.js';
import { createKnowledgeGraph } from '../graph/knowledge-graph.js';
import { DbManager } from '../storage/db-manager.js';
import { loadGraphFromDB } from '../multi-repo/graph-from-db.js';
import { Bm25Index } from '../search/bm25-index.js';
import { VectorIndex } from '../search/vector-index.js';
import { createEvidenceStore } from '../evidence/store.js';

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
  artifacts: IndexArtifactName[] = ['graph.db', 'bm25.db', 'vector.db', 'evidence.db', 'meta.json'],
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

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function verifyStagingReadBack(generation: IndexGeneration, metadata: IndexMetadata): Promise<IndexMetadata> {
  const graph = createKnowledgeGraph();
  const db = new DbManager(generation.graphDbPath, true);
  await db.init();
  try {
    await loadGraphFromDB(graph, db);
  } finally {
    db.close();
  }
  const graphPersisted = graph.size.nodes + graph.size.edges;
  const graphProduced = metadata.graphVerification?.producedCount ?? graphPersisted;
  metadata.graphVerification = {
    ...(metadata.graphVerification ?? { status: 'verified' }),
    persistedCount: graphPersisted,
    contentFingerprint: sha256({ nodes: graph.size.nodes, edges: graph.size.edges }),
    status: graphPersisted < graphProduced ? 'collapsed' : 'verified',
    reason: graphPersisted < graphProduced ? 'staging graph read-back smaller than produced graph' : metadata.graphVerification?.reason,
  };

  const bm25 = new Bm25Index(generation.bm25DbPath);
  const bm25Receipt = bm25.getReadBackReceipt();
  metadata.bm25Verification = {
    ...(metadata.bm25Verification ?? { status: 'verified' }),
    persistedCount: bm25Receipt.docCount,
    contentFingerprint: sha256(bm25Receipt),
    status: bm25Receipt.docCount < (metadata.bm25Verification?.producedCount ?? bm25Receipt.docCount) ? 'collapsed' : 'verified',
    reason: bm25Receipt.docCount < (metadata.bm25Verification?.producedCount ?? bm25Receipt.docCount) ? 'staging bm25 read-back smaller than produced membership' : metadata.bm25Verification?.reason,
  };

  if (metadata.embeddings?.enabled && metadata.embeddings.status === 'ready') {
    const idx = new VectorIndex(generation.vectorDbPath, metadata.embeddings.dimension, { readonly: true, fileMustExist: true });
    try {
      await idx.init();
      const built = await idx.isBuilt();
      metadata.vectorVerification = {
        ...(metadata.vectorVerification ?? { status: 'verified' }),
        persistedCount: built ? (metadata.vectorVerification?.producedCount ?? 0) : 0,
        contentFingerprint: metadata.compatibilityReceipt?.embeddingFingerprint,
        status: built ? 'verified' : 'collapsed',
        reason: built ? metadata.vectorVerification?.reason : 'staging vector read-back failed',
      };
    } finally {
      idx.close();
    }
  }

  if (fs.existsSync(generation.evidenceDbPath ?? '')) {
    const evidenceStore = createEvidenceStore(path.dirname(path.dirname(generation.stagingDir)));
    try {
      const expected = metadata.evidenceVerification?.producedCount ?? 0;
      const receiptId = metadata.evidenceVerification?.contentFingerprint;
      const receipt = receiptId ? evidenceStore.getReceipt(receiptId) : null;
      metadata.evidenceVerification = {
        ...(metadata.evidenceVerification ?? { status: 'verified' }),
        persistedCount: expected,
        status: receipt || expected === 0 ? 'verified' : 'collapsed',
        reason: receipt || expected === 0 ? metadata.evidenceVerification?.reason : 'staging evidence read-back failed',
      };
    } finally {
      evidenceStore.close();
    }
  }

  return metadata;
}

/**
 * Run analyze against an isolated staging directory and publish only after all
 * required artifacts validate. A repository lock serializes analyze processes.
 */
export async function runAtomicAnalyze(args: string[], binUrl: URL): Promise<number> {
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
        console.log(`    evolution: ${plan.evolution}`);
        console.log(`    graph: ${plan.graph}`);
        console.log(`    bm25: ${plan.bm25}`);
        console.log(`    vector: ${plan.vector}`);
        console.log(`    seed artifacts: ${plan.seedArtifacts.join(', ') || '(none)'}`);
      }
    }

    if (plan.mode === 'passthrough') {
      return runChild(args, binUrl);
    }

    const requestedRepoName = (() => {
      const nameFlagIndex = args.indexOf('--name');
      if (nameFlagIndex >= 0) return args[nameFlagIndex + 1]?.trim();
      const inline = args.find((arg) => arg.startsWith('--name='));
      return inline ? inline.slice('--name='.length).trim() : undefined;
    })();

    if (previous) {
      const result = reconcileRegistryEntry({
        workspaceRoot,
        requestedName: requestedRepoName,
        metadata: previous,
      });
      if (result.outcome === 'conflict') {
        throw new Error(`${result.message}${result.guidance ? `\n  ${result.guidance}` : ''}`);
      }
      if (result.outcome === 'registered') {
        console.log(`  ✓ ${result.message}`);
      }
    }

    if (plan.mode === 'noop') {
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
      const verifiedMetadata = await verifyStagingReadBack(generation, metadata);
      publishIndexGeneration(workspaceRoot, generation, verifiedMetadata, {
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
