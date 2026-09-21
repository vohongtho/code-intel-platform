import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { generateNodeId } from '../../../src/graph/id-generator.js';
import { parsePhase } from '../../../src/pipeline/phases/parse-phase.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';

function makeWorkspace(filename: string, source: string): { workspaceRoot: string; filePath: string; relativePath: string } {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-identity-parse-'));
  const filePath = path.join(workspaceRoot, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source, 'utf8');
  return { workspaceRoot, filePath, relativePath: filename };
}

describe('parsePhase identity-aware projection', () => {
  it('keeps same-name declarations distinct instead of kind:name overwrite', async () => {
    const { workspaceRoot, filePath, relativePath } = makeWorkspace(
      'src/overloads.ts',
      'export function login(token: string): void;\nexport function login(id: number): void;\nexport function login(value: string | number): void { void value; }\n',
    );

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
    const loginNodes = nodes.filter((node) => node.name === 'login');
    const functionNodes = nodes.filter((node) => node.kind === 'function');

    assert.ok(functionNodes.length >= 2);
    assert.ok(loginNodes.length >= 2);
    assert.equal(new Set(loginNodes.map((node) => node.id)).size, loginNodes.length);
    assert.equal(loginNodes.every((node) => typeof node.metadata?.semantic === 'object'), true);
  });
});
