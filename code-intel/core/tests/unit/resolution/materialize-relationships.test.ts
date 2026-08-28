import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { Language } from '../../../src/shared/languages.js';
import { generateCallSiteId } from '../../../src/identity/callsite-identity.js';
import { buildResolutionIndexes, createResolutionInstrumentation } from '../../../src/resolution/indexes.js';
import { materializeSemanticRelationships } from '../../../src/resolution/materialize-relationships.js';
import type { ResolutionEvidenceStore } from '../../../src/evidence/store.js';
import { createEvidenceStore } from '../../../src/evidence/store.js';
import type { SemanticFact } from '../../../src/semantic/facts.js';

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-materialize-'));
}

describe('materializeSemanticRelationships', () => {
  it('materializes exact call edges with trust fields', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'file:src/a.ts:src/a.ts', kind: 'file', name: 'src/a.ts', filePath: 'src/a.ts' });
    graph.addNode({
      id: 'caller-node',
      kind: 'function',
      name: 'caller',
      filePath: 'src/a.ts',
      metadata: { semantic: { factId: 'decl:caller', anchors: { render: { startLine: 1, endLine: 5 } } } },
    });
    graph.addNode({
      id: 'callee-node',
      kind: 'function',
      name: 'callee',
      filePath: 'src/a.ts',
      metadata: { semantic: { factId: 'decl:callee', anchors: { render: { startLine: 10, endLine: 12 } } } },
    });

    const facts: SemanticFact[] = [
      {
        factId: 'decl:caller',
        language: Language.TypeScript,
        filePath: 'src/a.ts',
        sourceRange: { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 5, endColumn: 1 },
        declarationKind: 'function',
        name: 'caller',
        anchors: {
          identity: { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
          render: { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 5, endColumn: 1 },
        },
      },
      {
        factId: 'decl:callee',
        language: Language.TypeScript,
        filePath: 'src/a.ts',
        sourceRange: { filePath: 'src/a.ts', startLine: 10, startColumn: 1, endLine: 12, endColumn: 1 },
        declarationKind: 'function',
        name: 'callee',
        anchors: {
          identity: { filePath: 'src/a.ts', startLine: 10, startColumn: 1, endLine: 10, endColumn: 6 },
          render: { filePath: 'src/a.ts', startLine: 10, startColumn: 1, endLine: 12, endColumn: 1 },
        },
      },
      {
        factId: 'call:1',
        language: Language.TypeScript,
        filePath: 'src/a.ts',
        sourceRange: { filePath: 'src/a.ts', startLine: 3, startColumn: 3, endLine: 3, endColumn: 9 },
        callerRef: 'decl:caller',
        calleeText: 'callee',
      },
    ];

    const indexes = buildResolutionIndexes(facts, createResolutionInstrumentation());
    const repo = tempRepo();
    const store = createEvidenceStore(repo);
    const result = materializeSemanticRelationships({ graph, facts, indexes, evidenceStore: store, resolverVersion: 'evidence-based-v1' });
    store.close();

    assert.equal(result.edgeCount, 1);
    const edge = [...graph.allEdges()].find((item) => item.kind === 'calls' && item.source === 'caller-node' && item.target === 'callee-node');
    assert.ok(edge);
    assert.equal(edge!.certainty, 'heuristic');
    assert.equal(edge!.strategy, 'name-fallback');
    assert.equal(edge!.resolverVersion, 'evidence-based-v1');
    assert.equal(edge!.ambiguous, true);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('writes evidence for unresolved relationships without fabricating edges', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'file:src/a.ts:src/a.ts', kind: 'file', name: 'src/a.ts', filePath: 'src/a.ts' });
    graph.addNode({
      id: 'caller-node',
      kind: 'function',
      name: 'caller',
      filePath: 'src/a.ts',
      metadata: { semantic: { factId: 'decl:caller', anchors: { render: { startLine: 1, endLine: 5 } } } },
    });

    const facts: SemanticFact[] = [
      {
        factId: 'decl:caller',
        language: Language.TypeScript,
        filePath: 'src/a.ts',
        sourceRange: { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 5, endColumn: 1 },
        declarationKind: 'function',
        name: 'caller',
        anchors: {
          identity: { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
          render: { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 5, endColumn: 1 },
        },
      },
      {
        factId: 'call:2',
        language: Language.TypeScript,
        filePath: 'src/a.ts',
        sourceRange: { filePath: 'src/a.ts', startLine: 3, startColumn: 3, endLine: 3, endColumn: 15 },
        callerRef: 'decl:caller',
        calleeText: 'unknownDynamic',
        receiver: { text: 'service', type: { kind: 'unknown', text: 'Service' } },
      },
    ];

    const indexes = buildResolutionIndexes(facts, createResolutionInstrumentation());
    const repo = tempRepo();
    const store = createEvidenceStore(repo);
    const result = materializeSemanticRelationships({ graph, facts, indexes, evidenceStore: store, resolverVersion: 'evidence-based-v1' });
    const referenceId = generateCallSiteId({
      version: 1,
      filePath: 'src/a.ts',
      callerSymbolId: 'caller-node',
      range: { filePath: 'src/a.ts', startLine: 3, startColumn: 3, endLine: 3, endColumn: 15 },
      calleeText: 'unknownDynamic',
    });
    const records = store.getByReference(referenceId);
    const dbPath = path.join(repo, '.code-intel', 'evidence.db');
    store.close();

    assert.equal(result.edgeCount, 0);
    assert.equal(result.evidenceCount, 1);
    assert.equal([...graph.allEdges()].filter((item) => item.kind === 'calls').length, 0);
    assert.equal(fs.existsSync(dbPath), true);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.strategy, 'unresolved');
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('fails publication slice when required evidence write fails', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'caller-node',
      kind: 'function',
      name: 'caller',
      filePath: 'src/a.ts',
      metadata: { semantic: { factId: 'decl:caller', anchors: { render: { startLine: 1, endLine: 10 } } } },
    });

    const facts: SemanticFact[] = [
      {
        factId: 'decl:caller',
        language: Language.TypeScript,
        filePath: 'src/a.ts',
        sourceRange: { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 5, endColumn: 1 },
        declarationKind: 'function',
        name: 'caller',
        anchors: {
          identity: { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
          render: { filePath: 'src/a.ts', startLine: 1, startColumn: 1, endLine: 5, endColumn: 1 },
        },
      },
      {
        factId: 'call:1',
        language: Language.TypeScript,
        filePath: 'src/a.ts',
        sourceRange: { filePath: 'src/a.ts', startLine: 3, startColumn: 3, endLine: 3, endColumn: 15 },
        callerRef: 'decl:caller',
        calleeText: 'unknownDynamic',
        receiver: { text: 'obj', type: { kind: 'unknown', text: 'UnknownType' } },
      },
    ];

    const indexes = buildResolutionIndexes(facts, createResolutionInstrumentation());
    const evidenceStore: ResolutionEvidenceStore = {
      put() { throw new Error('disk full'); },
      get() { return null; },
      getByReference() { return []; },
      getReceipt() { return null; },
      close() {},
    };

    assert.throws(
      () => materializeSemanticRelationships({ graph, facts, indexes, evidenceStore, resolverVersion: 'evidence-based-v1' }),
      /disk full/,
    );
    assert.equal([...graph.allEdges()].filter((item) => item.kind === 'calls').length, 0);
  });
});
