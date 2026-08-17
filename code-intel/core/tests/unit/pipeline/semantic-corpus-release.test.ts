import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { createKnowledgeGraph as createReloadedGraph } from '../../../src/graph/knowledge-graph.js';
import { parsePhase } from '../../../src/pipeline/phases/parse-phase.js';
import { parsePhaseParallel } from '../../../src/pipeline/workers/parse-phase-parallel.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';
import { generateNodeId } from '../../../src/graph/id-generator.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphFromDB } from '../../../src/multi-repo/graph-from-db.js';
import { Bm25Index } from '../../../src/search/bm25-index.js';
import { dispatchTool, resetRepoGraphCacheForTests } from '../../../src/mcp-server/server.js';
import { getLanguageCapabilityDescriptors } from '../../../src/languages/capability-registry.js';
import type { CapabilityState, ResolverPerformanceContract } from '../../../src/languages/capability-types.js';

const CORPUS_ROOT = path.resolve('tests/semantic-corpus');
const RELEASE_REPORT_PATH = path.join(CORPUS_ROOT, 'release-report.json');

interface CorpusManifest {
  language: string;
  fixtures: { main: string; grouped: string };
  expected: { definitions: string[]; forbidden: string[] };
  groupedExpected: string[];
}

interface ReleaseRow {
  language: string;
  parser: 'tree-sitter' | 'regex';
  serialCount: number;
  parallelCount: number;
  persistedCount: number;
  acceptedMissing: string[];
  forbiddenExported: string[];
  groupedHits: string[];
  stableOrder: boolean;
  searchVisible: boolean;
  inspectVisible: boolean;
  capabilities: Record<string, CapabilityState>;
  accepted: boolean;
  correctness: {
    acceptedMissing: number;
    forbiddenExported: number;
    searchVisible: boolean;
    inspectVisible: boolean;
  };
  determinism: {
    stableOrder: boolean;
    serialCount: number;
    parallelCount: number;
  };
  completeness: {
    persistedCount: number;
    groupedHits: number;
  };
  scalability: {
    maxWorkspaceTraversalsPerPass: number | null;
    maxPreparedIndexBuildsPerPass: number | null;
    candidateLookupBudget: number | null;
    truncationBudget: number | null;
    depthScalingBudget: number | null;
  };
  resourceUse: {
    retainedHeapMiB: number | null;
  };
}

function corpusLanguages(): string[] {
  return getLanguageCapabilityDescriptors().map((descriptor) => descriptor.language);
}

function readManifest(language: string): CorpusManifest {
  return JSON.parse(fs.readFileSync(path.join(CORPUS_ROOT, language, 'manifest.json'), 'utf8')) as CorpusManifest;
}

function stageFixture(language: string, fixtureName: string): { workspaceRoot: string; filePath: string; relativePath: string } {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `semantic-${language}-`));
  const relativePath = fixtureName;
  const sourcePath = path.join(CORPUS_ROOT, language, fixtureName);
  const filePath = path.join(workspaceRoot, relativePath);
  fs.copyFileSync(sourcePath, filePath);
  return { workspaceRoot, filePath, relativePath };
}

function seedFileNode(graph: ReturnType<typeof createKnowledgeGraph>, relativePath: string): void {
  graph.addNode({
    id: generateNodeId('file', relativePath, relativePath),
    kind: 'file',
    name: relativePath,
    filePath: relativePath,
  });
}

async function runParsePhase(language: string, fixtureName: string, mode: 'serial' | 'parallel') {
  const { workspaceRoot, filePath, relativePath } = stageFixture(language, fixtureName);
  const graph = createKnowledgeGraph();
  seedFileNode(graph, relativePath);
  const context: PipelineContext = { workspaceRoot, graph, filePaths: [filePath] };
  const phase = mode === 'serial' ? parsePhase : parsePhaseParallel;
  const result = await phase.execute(context, new Map());
  const nodes = [...graph.allNodes()].filter((node) => node.kind !== 'file');
  return { workspaceRoot, filePath, relativePath, graph, nodes, result, parser: context.parserUsed ?? 'regex' };
}

function normalizeNodes(nodes: Array<{ kind: string; name: string; filePath: string; startLine?: number; endLine?: number }>): string[] {
  return nodes
    .map((node) => `${node.kind}:${node.name}:${node.filePath}:${node.startLine ?? 0}:${node.endLine ?? 0}`)
    .sort();
}

function exportedNames(nodes: Array<{ name: string; exported?: boolean }>): string[] {
  return nodes.filter((node) => node.exported).map((node) => node.name);
}

function expectNames(nodes: Array<{ name: string }>, wanted: string[]): string[] {
  const present = new Set(nodes.map((node) => node.name));
  return wanted.filter((name) => !present.has(name));
}

async function persistAndReload(language: string, serialNodes: ReturnType<typeof normalizeNodes>, graph: ReturnType<typeof createKnowledgeGraph>) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `semantic-db-${language}-`));
  const graphDbPath = path.join(repoRoot, '.code-intel', 'graph.db');
  const bm25DbPath = path.join(repoRoot, '.code-intel', 'bm25.db');
  const db = new DbManager(graphDbPath);
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();

  const reloaded = createReloadedGraph();
  const readDb = new DbManager(graphDbPath, true);
  await readDb.init();
  await loadGraphFromDB(reloaded, readDb);
  readDb.close();

  const reloadedNodes = [...reloaded.allNodes()].filter((node) => node.kind !== 'file');
  const reloadedNormalized = normalizeNodes(reloadedNodes);
  assert.deepEqual(reloadedNormalized, serialNodes, `${language}: persisted graph should reopen with identical canonical nodes`);

  const bm25 = new Bm25Index(bm25DbPath);
  bm25.build(reloaded);
  bm25.load();

  return { repoRoot, reloaded, reloadedNodes, bm25 };
}

describe('semantic corpus release gate', () => {
  it('writes a machine-readable 15-language release report and fails on accepted-row regressions', async () => {
    resetRepoGraphCacheForTests();
    const rows: ReleaseRow[] = [];

    for (const language of corpusLanguages()) {
      const manifest = readManifest(language);
      const serial = await runParsePhase(language, manifest.fixtures.main, 'serial');
      const parallel = await runParsePhase(language, manifest.fixtures.main, 'parallel');

      const serialNormalized = normalizeNodes(serial.nodes);
      const parallelNormalized = normalizeNodes(parallel.nodes);

      const grouped = await runParsePhase(language, manifest.fixtures.grouped, 'serial');
      const groupedHits = manifest.groupedExpected.filter((name) => grouped.nodes.some((node) => node.name === name));

      const { reloaded, reloadedNodes, bm25 } = await persistAndReload(language, serialNormalized, serial.graph);

      const probe = manifest.expected.definitions[0] ?? manifest.groupedExpected[0] ?? language;
      const searchResults = bm25.search(probe, 10);
      if (searchResults.length === 0) {
        throw new Error(`${language}: empty BM25 results for ${probe}`);
      }

      const missingAccepted = expectNames(reloadedNodes, manifest.expected.definitions);
      const forbiddenExported = manifest.expected.forbidden.filter((name) => exportedNames(reloadedNodes).includes(name));
      const descriptor = getLanguageCapabilityDescriptors().find((item) => item.language === language)!;
      const perf: ResolverPerformanceContract | undefined = descriptor.resolutionPerformance;
      const row: ReleaseRow = {
        language,
        parser: serial.parser,
        serialCount: serial.nodes.length,
        parallelCount: parallel.nodes.length,
        persistedCount: reloadedNodes.length,
        acceptedMissing: missingAccepted,
        forbiddenExported,
        groupedHits,
        stableOrder: JSON.stringify(serialNormalized) === JSON.stringify(parallelNormalized),
        searchVisible: Boolean(searchResults.some((item) => item.name === probe)),
        inspectVisible: Boolean(reloadedNodes.some((item) => item.name === probe)),
        capabilities: { ...descriptor.capabilities },
        accepted: missingAccepted.length === 0 && forbiddenExported.length === 0 && Boolean(searchResults.some((item) => item.name === probe)) && Boolean(reloadedNodes.some((item) => item.name === probe)),
        correctness: {
          acceptedMissing: missingAccepted.length,
          forbiddenExported: forbiddenExported.length,
          searchVisible: Boolean(searchResults.some((item) => item.name === probe)),
          inspectVisible: Boolean(reloadedNodes.some((item) => item.name === probe)),
        },
        determinism: {
          stableOrder: JSON.stringify(serialNormalized) === JSON.stringify(parallelNormalized),
          serialCount: serial.nodes.length,
          parallelCount: parallel.nodes.length,
        },
        completeness: {
          persistedCount: reloadedNodes.length,
          groupedHits: groupedHits.length,
        },
        scalability: {
          maxWorkspaceTraversalsPerPass: perf?.maxWorkspaceTraversalsPerPass ?? null,
          maxPreparedIndexBuildsPerPass: perf?.maxPreparedIndexBuildsPerPass ?? null,
          candidateLookupBudget: perf?.candidateLookupBudget ?? null,
          truncationBudget: perf?.truncationBudget ?? null,
          depthScalingBudget: perf?.depthScalingBudget ?? null,
        },
        resourceUse: {
          retainedHeapMiB: perf?.retainedHeapMiB ?? null,
        },
      };
      rows.push(row);

      assert.equal(row.acceptedMissing.length, 0, `${language}: accepted row missing ${row.acceptedMissing.join(', ')}`);
      assert.equal(row.forbiddenExported.length, 0, `${language}: forbidden exported ${row.forbiddenExported.join(', ')}`);
      assert.equal(row.searchVisible, true, `${language}: search should expose ${probe}`);
      assert.equal(row.inspectVisible, true, `${language}: inspect should expose ${probe}`);
      if (descriptor.capabilities.calls === 'supported') {
        assert.equal(row.stableOrder, true, `${language}: normalized fingerprint ordering must be stable for supported rows`);
      }
    }

    fs.writeFileSync(RELEASE_REPORT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`, 'utf8');
    assert.equal(rows.length, corpusLanguages().length);
  });
});
