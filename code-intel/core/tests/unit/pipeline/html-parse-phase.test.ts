import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { parsePhase } from '../../../src/pipeline/phases/parse-phase.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';
import { generateNodeId } from '../../../src/graph/id-generator.js';

function makeHtmlWorkspace(source: string): { workspaceRoot: string; filePath: string } {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-html-'));
  const filePath = path.join(workspaceRoot, 'index.html');
  fs.writeFileSync(filePath, source, 'utf8');
  return { workspaceRoot, filePath };
}

describe('parsePhase HTML semantics', () => {
  it('extracts structural HTML facts without fake functions', async () => {
    const source = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="/app.css">
    <script src="/app.js"></script>
    <script>const x = 1;</script>
  </head>
  <body id="main" class="shell app">
    <a href="/docs">Docs</a>
    <form action="/submit"></form>
  </body>
</html>`;

    const { workspaceRoot, filePath } = makeHtmlWorkspace(source);
    const relativePath = 'index.html';
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: generateNodeId('file', relativePath, relativePath),
      kind: 'file',
      name: relativePath,
      filePath: relativePath,
    });

    const context: PipelineContext = {
      workspaceRoot,
      graph,
      filePaths: [filePath],
    };

    const result = await parsePhase.execute(context, new Map());
    assert.equal(result.status, 'completed');

    const nodes = [...graph.allNodes()].filter((node) => node.kind !== 'file');
    const byKind = (kind: string) => nodes.filter((node) => node.kind === kind).map((node) => node.name).sort();

    assert.deepEqual(byKind('property'), ['app', 'main', 'shell']);
    assert.deepEqual(byKind('module'), ['/app.css', '/app.js']);
    assert.deepEqual(byKind('variable'), ['/docs', '/submit', 'const x = 1;']);

    const embeddedScript = nodes.find((node) => node.name === 'const x = 1;');
    assert.ok(embeddedScript);
    assert.equal(embeddedScript?.metadata?.embedded, true);
    assert.equal(embeddedScript?.startLine, 6);
    assert.ok((embeddedScript?.endLine ?? 0) >= 6);

    assert.equal(nodes.some((node) => node.kind === 'function'), false);
    assert.equal(nodes.some((node) => node.name === 'body' || node.name === 'html'), false);
  });
});
