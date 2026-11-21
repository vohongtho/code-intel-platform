import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { escapeNewlines, unescapeNewlines } from '../../../src/storage/csv-writer.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { DbManager } from '../../../src/storage/db-manager.js';
import { loadGraphToDB } from '../../../src/storage/graph-loader.js';
import { loadGraphFromDB } from '../../../src/multi-repo/graph-from-db.js';

describe('escapeNewlines / unescapeNewlines', () => {
  it('round-trips multi-line code including CRLF', () => {
    const code = 'function a() {\n  return 1;\r\n}\n';
    assert.equal(unescapeNewlines(escapeNewlines(code)), code);
    assert.ok(!escapeNewlines(code).includes('\n'));
  });

  it('leaves content without backslashes untouched', () => {
    assert.equal(unescapeNewlines('plain text'), 'plain text');
    assert.equal(escapeNewlines('plain text'), 'plain text');
  });

  it('documents the known limit: a source literal backslash-n decodes to a line break', () => {
    const source = String.raw`const s = 'a\nb';`;
    assert.equal(unescapeNewlines(escapeNewlines(source)), "const s = 'a\nb';");
    // …but both sides reduce to the same stored form, which is what source-hydration compares.
    assert.equal(escapeNewlines(unescapeNewlines(escapeNewlines(source))), escapeNewlines(source));
  });
});

describe('graph store content round trip', () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-roundtrip-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns multi-line source with real newlines from graph.db', async () => {
    const source = `export function load(id: string) {\n  const row = db.get(id);\n  if (!row) {\n    throw new Error('missing');\n  }\n  return row;\n}`;
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'load', kind: 'function', name: 'load', filePath: 'src/load.ts', startLine: 1, endLine: 7, content: source });

    const dbPath = path.join(dir, 'graph.db');
    const writer = new DbManager(dbPath);
    await writer.init();
    await loadGraphToDB(graph, writer);
    writer.close();

    const loaded = createKnowledgeGraph();
    const reader = new DbManager(dbPath, true);
    await reader.init();
    await loadGraphFromDB(loaded, reader);
    reader.close();

    const node = loaded.getNode('load');
    assert.equal(node?.content, source);
    assert.equal(node?.content?.split('\n').length, 7);
  });
});
