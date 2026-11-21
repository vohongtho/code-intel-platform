import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildResolutionIndexes } from '../../../src/resolution/indexes.js';
import { resolveDispatch } from '../../../src/resolution/dispatch.js';
import { inferReceiverTypeSet } from '../../../src/resolution/receiver-types.js';
import { resolveReference } from '../../../src/resolution/strategies.js';
import { materializeSemanticRelationships } from '../../../src/resolution/materialize-relationships.js';
import { createEvidenceStore } from '../../../src/evidence/store.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { writeEdgeCSV } from '../../../src/storage/csv-writer.js';
import { loadGraphFromDB } from '../../../src/multi-repo/graph-from-db.js';
import type { SemanticFact } from '../../../src/semantic/facts.js';
import { Language } from '../../../src/shared/languages.js';

const range = { filePath: 'src/app.ts', startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 };
const lang = Language.TypeScript;

function decl(factId: string, name: string, kind: string, extras: Record<string, unknown> = {}): SemanticFact {
  return { factId, language: lang, filePath: 'src/app.ts', sourceRange: range, declarationKind: kind, name, anchors: { identity: range, render: range }, ...extras } as SemanticFact;
}
function heritage(factId: string, declarationRef: string, target: string, heritageKind: 'extends' | 'implements' = 'implements'): SemanticFact {
  return { factId, language: lang, filePath: 'src/app.ts', sourceRange: range, declarationRef, heritageKind, target: { kind: 'nominal', text: target, name: target } } as SemanticFact;
}
const nominal = (name: string) => ({ kind: 'nominal' as const, text: name, name });

/** Service interface with two implementations, an abstract-ish Base class with an override, and an unrelated class sharing the member name. */
function fixture(): SemanticFact[] {
  return [
    decl('t:service', 'Service', 'interface'),
    decl('m:service:run', 'run', 'method', { ownerRef: 't:service' }),
    decl('t:fast', 'FastService', 'class'),
    decl('m:fast:run', 'run', 'method', { ownerRef: 't:fast' }),
    heritage('h:fast', 't:fast', 'Service'),
    decl('t:slow', 'SlowService', 'class'),
    decl('m:slow:run', 'run', 'method', { ownerRef: 't:slow' }),
    heritage('h:slow', 't:slow', 'Service'),
    decl('t:base', 'Base', 'class'),
    decl('m:base:start', 'start', 'method', { ownerRef: 't:base' }),
    decl('m:base:helper', 'helper', 'method', { ownerRef: 't:base' }),
    decl('t:child', 'Child', 'class'),
    decl('m:child:start', 'start', 'method', { ownerRef: 't:child' }),
    heritage('h:child', 't:child', 'Base', 'extends'),
    decl('t:quiet', 'QuietChild', 'class'),
    heritage('h:quiet', 't:quiet', 'Base', 'extends'),
    decl('t:unrelated', 'Unrelated', 'class'),
    decl('m:unrelated:run', 'run', 'method', { ownerRef: 't:unrelated' }),
    decl('m:unrelated:start', 'start', 'method', { ownerRef: 't:unrelated' }),
    decl('f:caller', 'caller', 'method', { ownerRef: 't:base', signature: { parameters: [{ name: 'svc', type: nominal('Service') }] } }),
  ];
}

const targets = (result: ReturnType<typeof resolveDispatch>) => result?.candidates.map((item) => item.targetId) ?? [];

describe('receiver type-set dispatch', () => {
  it('keeps both valid interface implementations and does not pick one by score', () => {
    const indexes = buildResolutionIndexes(fixture());
    const result = resolveDispatch(indexes, { callSiteId: 'cs:1', language: lang, receiver: { text: 'svc', type: nominal('Service') }, memberName: 'run' });
    assert.deepEqual(targets(result), ['m:fast:run', 'm:slow:run']);
    assert.equal(result?.certainty, 'candidate-set');
    assert.equal(result?.complete, false);
    assert.ok(result?.boundaries.includes('open-interface-implementations:Service'));
    // Forbidden targets: the abstract interface member and the unrelated same-name method.
    assert.ok(!targets(result).includes('m:service:run'));
    assert.ok(!targets(result).includes('m:unrelated:run'));
  });

  it('does not treat a single indexed implementation of an open interface as exact', () => {
    const facts = fixture().filter((fact) => !['t:slow', 'm:slow:run', 'h:slow'].includes(fact.factId));
    const result = resolveDispatch(buildResolutionIndexes(facts), { callSiteId: 'cs:2', language: lang, receiver: { text: 'svc', type: nominal('Service') }, memberName: 'run' });
    assert.deepEqual(targets(result), ['m:fast:run']);
    assert.equal(result?.certainty, 'candidate-set');
    assert.equal(result?.complete, false);
  });

  it('expands class overrides and reuses inherited members without duplicating them', () => {
    const result = resolveDispatch(buildResolutionIndexes(fixture()), { callSiteId: 'cs:3', language: lang, receiver: { text: 'b', type: nominal('Base') }, memberName: 'start' });
    assert.deepEqual(targets(result), ['m:base:start', 'm:child:start']);
    assert.equal(result?.complete, true);
    assert.equal(result?.certainty, 'candidate-set');
    assert.ok(!targets(result).includes('m:unrelated:start'));

    const helper = resolveDispatch(buildResolutionIndexes(fixture()), { callSiteId: 'cs:4', language: lang, receiver: { text: 'c', type: nominal('QuietChild') }, memberName: 'helper' });
    assert.deepEqual(targets(helper), ['m:base:helper']);
    assert.equal(helper?.candidates[0]?.inherited, true);
    assert.equal(helper?.certainty, 'exact');
  });

  it('narrows to one target from constructor evidence', () => {
    const result = resolveDispatch(buildResolutionIndexes(fixture()), { callSiteId: 'cs:5', language: lang, receiver: { text: 'new SlowService()' }, memberName: 'run' });
    assert.deepEqual(targets(result), ['m:slow:run']);
    assert.equal(result?.certainty, 'exact');
    assert.equal(result?.strategy, 'constructor-dispatch');
  });

  it('narrows an injected interface only with exact, unique registration evidence', () => {
    const binding = (factId: string, impl: string, exact = true): SemanticFact => ({
      factId, language: Language.CSharp, filePath: 'Startup.cs', sourceRange: range, bindingKind: 'contract-to-implementation', contractRef: 'Service', implementationRef: impl,
      dynamic: false, framework: 'microsoft-di', frameworkEvidence: { frameworkId: 'microsoft-di', adapterVersion: '0.2.0', exact },
    } as SemanticFact);
    const exact = resolveDispatch(buildResolutionIndexes([...fixture(), binding('di:1', 'SlowService')]), { callSiteId: 'cs:6', language: Language.CSharp, receiver: { text: 'svc', type: nominal('Service') }, memberName: 'run' });
    assert.deepEqual(targets(exact), ['m:slow:run']);
    assert.equal(exact?.certainty, 'exact');
    assert.equal(exact?.strategy, 'registration-dispatch');
    assert.deepEqual(exact?.receiverTypes.possibleRuntimeTypes[0]?.evidenceRefs, ['di:1']);

    const ambiguous = resolveDispatch(buildResolutionIndexes([...fixture(), binding('di:1', 'SlowService'), binding('di:2', 'FastService')]), { callSiteId: 'cs:7', language: Language.CSharp, receiver: { text: 'svc', type: nominal('Service') }, memberName: 'run' });
    assert.deepEqual(targets(ambiguous), ['m:fast:run', 'm:slow:run']);
    assert.ok(ambiguous?.boundaries.includes('registration-not-unique:Service'));

    const inexact = resolveDispatch(buildResolutionIndexes([...fixture(), binding('di:1', 'SlowService', false)]), { callSiteId: 'cs:8', language: Language.CSharp, receiver: { text: 'svc', type: nominal('Service') }, memberName: 'run' });
    assert.equal(inexact?.certainty, 'candidate-set');
  });

  it('infers types from self receivers and typed parameters', () => {
    const indexes = buildResolutionIndexes(fixture());
    const self = resolveDispatch(indexes, { callSiteId: 'cs:9', language: lang, receiver: { text: 'this' }, callerRef: 'f:caller', memberName: 'start' });
    assert.deepEqual(targets(self), ['m:base:start', 'm:child:start']);
    assert.equal(self?.receiverTypes.strategy, 'self-receiver');

    const param = inferReceiverTypeSet(indexes, { callSiteId: 'cs:10', language: lang, receiver: { text: 'svc' }, callerRef: 'f:caller' });
    assert.equal(param.strategy, 'local-declaration');
    assert.deepEqual(param.staticTypes.map((item) => item.typeName), ['Service']);
  });

  it('reports unindexed types, unresolved receivers and unmodeled languages as incomplete boundaries', () => {
    const indexes = buildResolutionIndexes(fixture());
    const external = inferReceiverTypeSet(indexes, { callSiteId: 'cs:11', language: lang, receiver: { text: 'x', type: nominal('ExternalClient') } });
    assert.equal(external.complete, false);
    assert.ok(external.boundaries.includes('unindexed-type:ExternalClient'));

    const unknown = inferReceiverTypeSet(indexes, { callSiteId: 'cs:12', language: lang, receiver: { text: 'mystery' } });
    assert.equal(unknown.strategy, 'none');
    assert.ok(unknown.boundaries.includes('unresolved-receiver-type'));

    const ruby = resolveDispatch(indexes, { callSiteId: 'cs:13', language: Language.Ruby, receiver: { text: 'b', type: nominal('Base') }, memberName: 'helper' });
    assert.equal(ruby?.complete, false);
    assert.notEqual(ruby?.certainty, 'exact');
    assert.ok(ruby?.boundaries.includes('dispatch-adapter-unavailable:ruby'));
  });

  it('caps runtime types, hierarchy depth and emitted candidates with explicit incompleteness', () => {
    const wide: SemanticFact[] = [decl('t:root', 'Root', 'class'), decl('m:root:go', 'go', 'method', { ownerRef: 't:root' })];
    for (let i = 0; i < 12; i += 1) {
      wide.push(decl(`t:w${i}`, `W${i}`, 'class'), decl(`m:w${i}:go`, 'go', 'method', { ownerRef: `t:w${i}` }), heritage(`h:w${i}`, `t:w${i}`, 'Root', 'extends'));
    }
    const indexes = buildResolutionIndexes(wide);
    const capped = resolveDispatch(indexes, { callSiteId: 'cap:1', language: lang, receiver: { text: 'r', type: nominal('Root') }, memberName: 'go', limits: { maxRuntimeTypes: 4, maxHierarchyDepth: 6 } });
    assert.equal(capped?.complete, false);
    assert.ok(capped?.boundaries.includes('runtime-type-cap:4'));

    const truncated = resolveDispatch(indexes, { callSiteId: 'cap:2', language: lang, receiver: { text: 'r', type: nominal('Root') }, memberName: 'go', dispatchLimit: 3 });
    assert.equal(truncated?.certainty, 'truncated');
    assert.equal(truncated?.candidates.length, 3);
    assert.equal(truncated?.totalKnownCandidates, 13);

    const chain: SemanticFact[] = [decl('t:c0', 'C0', 'class'), decl('m:c0:go', 'go', 'method', { ownerRef: 't:c0' })];
    for (let i = 1; i <= 4; i += 1) chain.push(decl(`t:c${i}`, `C${i}`, 'class'), heritage(`h:c${i}`, `t:c${i}`, `C${i - 1}`, 'extends'));
    const deep = resolveDispatch(buildResolutionIndexes(chain), { callSiteId: 'cap:3', language: lang, receiver: { text: 'r', type: nominal('C0') }, memberName: 'go', limits: { maxRuntimeTypes: 32, maxHierarchyDepth: 2 } });
    assert.ok(deep?.boundaries.includes('hierarchy-depth-cap:2'));
    assert.equal(deep?.complete, false);
  });

  it('feeds resolveReference without collapsing candidates to exact', () => {
    const outcome = resolveReference(buildResolutionIndexes(fixture()), { referenceId: 'ref:1', filePath: 'src/app.ts', name: 'run', receiverType: nominal('Service'), receiverText: 'svc', language: lang });
    assert.equal(outcome.certainty, 'candidate-set');
    assert.equal(outcome.coverage.complete, false);
    assert.deepEqual(outcome.candidates.map((item) => item.targetId).sort(), ['m:fast:run', 'm:slow:run']);
  });
});

describe('dispatch performance guards', () => {
  function workspace(unrelated: number): SemanticFact[] {
    const facts = fixture();
    for (let i = 0; i < unrelated; i += 1) {
      facts.push(decl(`t:noise${i}`, `Noise${i}`, 'class'), decl(`m:noise${i}:run`, 'run', 'method', { ownerRef: `t:noise${i}` }));
      if (i % 2 === 0) facts.push(heritage(`h:noise${i}`, `t:noise${i}`, `Noise${i + 1}`, 'extends'));
    }
    return facts;
  }

  it('uses prepared-index lookups that do not grow with workspace size and never traverse the workspace', () => {
    const lookupsFor = (size: number) => {
      const indexes = buildResolutionIndexes(workspace(size));
      for (let i = 0; i < 50; i += 1) {
        resolveDispatch(indexes, { callSiteId: `perf:${i}`, language: lang, receiver: { text: 'svc', type: nominal('Service') }, memberName: 'run' });
      }
      assert.equal(indexes.instrumentation.fullWorkspaceTraversalCount, 0);
      assert.equal(indexes.instrumentation.indexBuildCount, 1);
      return indexes.instrumentation.dispatchIndexLookupCount ?? 0;
    };
    const small = lookupsFor(10);
    const large = lookupsFor(5000);
    assert.ok(small > 0);
    assert.equal(large, small);
  });

  it('caches receiver type sets per call site', () => {
    const indexes = buildResolutionIndexes(fixture());
    const input = { callSiteId: 'cache:1', language: lang, receiver: { text: 'svc', type: nominal('Service') } };
    inferReceiverTypeSet(indexes, input);
    inferReceiverTypeSet(indexes, input);
    assert.equal(indexes.instrumentation.receiverTypeInferenceCount, 1);
    assert.equal(indexes.instrumentation.receiverTypeCacheHitCount, 1);
  });
});

describe('dispatch edges persist and reopen through the normal graph/evidence path', () => {
  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]!;
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else field += ch;
    }
    return rows;
  }

  it('round-trips candidate dispatch certainty, strategy, ambiguity and evidence', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-reopen-'));
    const graph = createKnowledgeGraph();
    const node = (id: string, factId: string, kind: 'method' | 'class' | 'interface', startLine: number) =>
      graph.addNode({ id, kind, name: id, filePath: 'src/app.ts', startLine, endLine: startLine, metadata: { semantic: { factId, anchors: { render: { startLine, endLine: startLine } } } } });
    graph.addNode({ id: 'file:src/app.ts:src/app.ts', kind: 'file', name: 'src/app.ts', filePath: 'src/app.ts' });
    node('n:caller', 'f:caller', 'method', 40);
    node('n:fast', 'm:fast:run', 'method', 10);
    node('n:slow', 'm:slow:run', 'method', 20);
    node('n:unrelated', 'm:unrelated:run', 'method', 30);

    const callFact: SemanticFact = {
      factId: 'call:1', language: lang, filePath: 'src/app.ts', sourceRange: { filePath: 'src/app.ts', startLine: 40, startColumn: 2, endLine: 40, endColumn: 12 },
      callerRef: 'f:caller', calleeText: 'svc.run', receiver: { text: 'svc', type: nominal('Service') },
    } as SemanticFact;
    const facts = [...fixture(), callFact];
    const evidenceStore = createEvidenceStore(repo);
    materializeSemanticRelationships({ graph, facts: [callFact], indexes: buildResolutionIndexes(facts), evidenceStore, resolverVersion: 'evidence-based-v1' });
    evidenceStore.close();

    const written = [...graph.allEdges()].filter((edge) => edge.kind === 'calls');
    assert.deepEqual(written.map((edge) => edge.target).sort(), ['n:fast', 'n:slow']);

    const csvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-csv-'));
    const groups = writeEdgeCSV(graph, csvDir);
    const [header, ...rows] = groups.flatMap((group) => parseCsv(fs.readFileSync(group.filePath, 'utf8'))).filter((row, index, all) => index === 0 || row[0] !== all[0]![0]);
    const column = (name: string) => header!.indexOf(name);
    const dbRows = rows.map((row) => ({
      'a.id': row[column('from_id')], 'b.id': row[column('to_id')], 'e.id': row[column('id')], 'e.kind': row[column('kind')],
      'e.weight': row[column('weight')], 'e.label': row[column('label')], 'e.callsite_id': row[column('callsite_id')],
      'e.confidence': row[column('confidence')], 'e.certainty': row[column('certainty')], 'e.strategy': row[column('strategy')],
      'e.resolver_version': row[column('resolver_version')], 'e.evidence_ref': row[column('evidence_ref')],
      'e.ambiguous': row[column('ambiguous')] === '' ? null : row[column('ambiguous')] === 'true', 'e.metadata': row[column('metadata')],
    }));

    const reopened = createKnowledgeGraph();
    for (const item of graph.allNodes()) reopened.addNode(item);
    await loadGraphFromDB(reopened, { query: async (cypher: string) => (cypher.includes('code_edges') ? dbRows : []) } as never);
    const edges = [...reopened.allEdges()].filter((edge) => edge.kind === 'calls').sort((a, b) => a.target.localeCompare(b.target));
    assert.deepEqual(edges.map((edge) => edge.target), ['n:fast', 'n:slow']);
    for (const edge of edges) {
      assert.equal(edge.certainty, 'candidate');
      assert.equal(edge.strategy, 'inheritance-dispatch');
      assert.equal(edge.ambiguous, true);
      assert.equal(edge.callSiteId, written[0]!.callSiteId);
      assert.ok(edge.evidenceRef);
    }

    const store = createEvidenceStore(repo);
    const evidence = store.get(edges[0]!.evidenceRef!);
    store.close();
    assert.deepEqual([...(evidence?.candidateIds ?? [])].sort(), ['m:fast:run', 'm:slow:run']);
    assert.equal(evidence?.coverage?.complete, false);
    assert.ok(evidence?.coverage?.incompleteReasons?.includes('open-interface-implementations:Service'));
  });
});
