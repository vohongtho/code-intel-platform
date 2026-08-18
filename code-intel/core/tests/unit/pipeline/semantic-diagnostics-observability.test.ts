import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { generateNodeId } from '../../../src/graph/id-generator.js';
import { parsePhase } from '../../../src/pipeline/phases/parse-phase.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';

describe('semantic diagnostics observability', () => {
  it('collects fact diagnostics on parse context', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-diag-'));
    const filePath = path.join(workspaceRoot, 'sample.c');
    fs.writeFileSync(filePath, 'int main() { return 0; }\n', 'utf8');

    const graph = createKnowledgeGraph();
    graph.addNode({
      id: generateNodeId('file', 'sample.c', 'sample.c'),
      kind: 'file',
      name: 'sample.c',
      filePath: 'sample.c',
    });

    const context: PipelineContext = {
      workspaceRoot,
      graph,
      filePaths: [filePath],
      verbose: true,
    };

    await parsePhase.execute(context, new Map());
    assert.equal(context.factSchemaVersion, '1.0.11');
    assert.ok((context.factDiagnostics ?? []).length > 0);
    assert.ok(Array.isArray(context.frameworkDetections));
  });
});
