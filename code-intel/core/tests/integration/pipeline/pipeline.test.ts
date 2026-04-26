import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { runPipeline } from '../../../src/pipeline/orchestrator.js';
import {
  scanPhase,
  structurePhase,
  parsePhase,
  resolvePhase,
  clusterPhase,
  flowPhase,
} from '../../../src/pipeline/phases/index.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';

// __dirname for tests: dist-tests/tests/integration/pipeline -> 4 levels up = package root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');  // code-intel-platform root
const SHARED_ROOT = path.join(PKG_ROOT, 'code-intel', 'shared');
const CORE_ROOT = path.join(PKG_ROOT, 'code-intel', 'core');

describe('Pipeline Integration', () => {
  it('should analyze the shared package', async () => {
    const graph = createKnowledgeGraph();
    const context: PipelineContext = {
      workspaceRoot: SHARED_ROOT,
      graph,
      filePaths: [],
    };

    const phases = [scanPhase, structurePhase, parsePhase, resolvePhase, clusterPhase, flowPhase];
    const result = await runPipeline(phases, context);

    assert.equal(result.success, true);
    assert.ok(graph.size.nodes > 0, `Expected nodes > 0, got ${graph.size.nodes}`);
    assert.ok(graph.size.edges > 0, `Expected edges > 0, got ${graph.size.edges}`);

    // Should have file nodes
    let fileNodes = 0;
    for (const node of graph.allNodes()) {
      if (node.kind === 'file') fileNodes++;
    }
    assert.ok(fileNodes > 0, 'Expected file nodes');
  });

  it('should find the Language enum', async () => {
    const graph = createKnowledgeGraph();
    const context: PipelineContext = {
      workspaceRoot: SHARED_ROOT,
      graph,
      filePaths: [],
    };

    const phases = [scanPhase, structurePhase, parsePhase, resolvePhase];
    await runPipeline(phases, context);

    let found = false;
    for (const node of graph.allNodes()) {
      if (node.name === 'Language' && node.kind === 'enum') {
        found = true;
        break;
      }
    }
    assert.ok(found, 'Should find Language enum');
  });

  it('should detect import edges', async () => {
    // Use the full workspace which has cross-package imports
    const graph = createKnowledgeGraph();
    const context: PipelineContext = {
      workspaceRoot: CORE_ROOT,
      graph,
      filePaths: [],
    };

    const phases = [scanPhase, structurePhase, parsePhase, resolvePhase];
    await runPipeline(phases, context);

    let importEdges = 0;
    for (const edge of graph.findEdgesByKind('imports')) {
      importEdges++;
    }
    assert.ok(importEdges > 0, `Expected import edges > 0, got ${importEdges}`);
  });
});
