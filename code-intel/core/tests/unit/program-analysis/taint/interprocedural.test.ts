import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../../src/graph/knowledge-graph.js';
import type { CodeEdge } from '../../../../src/shared/index.js';
import { traceInterproceduralTaint } from '../../../../src/program-analysis/taint/interprocedural.js';
import { builtinTaintModelSources, createTaintModelRegistry } from '../../../../src/program-analysis/taint/model-registry.js';
import type { InterproceduralGateResult } from '../../../../src/program-analysis/semantic-graph-gate.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS } from '../../../../src/program-analysis/limits.js';

const SOURCE = `function handler() {
  const input = process.argv[2];
  runQuery(input);
  child_process.execSync(input);
}
function runQuery(sql) {
  child_process.exec(sql);
}
function viaReturn() {
  const value = readArg();
  child_process.exec(value);
}
function readArg() {
  return process.argv[3];
}
function viaIdentity() {
  const raw = process.argv[2];
  const same = identity(raw);
  child_process.exec(same);
}
function identity(x) {
  return x;
}
function spreadCall() {
  const args = process.argv;
  runQuery(...args);
}
function loopA(v) {
  loopB(v);
}
function loopB(v) {
  loopA(v);
}
`;

const LINES: Record<string, { line: number; params: string[] }> = {
  handler: { line: 1, params: [] },
  runQuery: { line: 6, params: ['sql'] },
  viaReturn: { line: 9, params: [] },
  readArg: { line: 13, params: [] },
  viaIdentity: { line: 16, params: [] },
  identity: { line: 21, params: ['x'] },
  spreadCall: { line: 24, params: [] },
  loopA: { line: 28, params: ['v'] },
  loopB: { line: 31, params: ['v'] },
};

const trusted: InterproceduralGateResult = { allowed: true, indexTrust: { trusted: true } as never };
const untrusted: InterproceduralGateResult = { allowed: false, reason: 'semantic graph is not trusted (state: stale): source changed', indexTrust: { trusted: false } as never };

function setup(edgeOverrides: Partial<CodeEdge> = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'taint-inter-'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/app.ts'), SOURCE);
  const graph = createKnowledgeGraph();
  for (const [name, info] of Object.entries(LINES)) {
    graph.addNode({ id: `fn:${name}`, kind: 'function', name, filePath: 'src/app.ts', startLine: info.line, endLine: info.line + 3, metadata: { parameters: info.params.map((p) => ({ name: p })) } });
  }
  const call = (from: string, to: string, extra: Partial<CodeEdge> = {}) => graph.addEdge({
    id: `e:${from}->${to}`, source: `fn:${from}`, target: `fn:${to}`, kind: 'calls', label: to, certainty: 'exact', strategy: 'lexical-scope', ambiguous: false, ...extra,
  });
  call('handler', 'runQuery', edgeOverrides);
  call('viaReturn', 'readArg');
  call('viaIdentity', 'identity');
  call('spreadCall', 'runQuery');
  call('loopA', 'loopB');
  call('loopB', 'loopA');
  const registry = createTaintModelRegistry(builtinTaintModelSources());
  assert.ok(registry.ok);
  return { repo, graph, registry: registry.registry };
}

describe('interprocedural taint over persisted call edges', () => {
  it('crosses an exact call edge into a callee sink and records the hop', async () => {
    const { repo, graph, registry } = setup();
    const result = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:handler', registry, gate: trusted });
    assert.equal(result.capability, 'supported');
    const cross = result.result!.findings.find((finding) => finding.hops?.length);
    assert.ok(cross, JSON.stringify(result));
    assert.equal(cross.sinkFunctionId, 'fn:runQuery');
    assert.equal(cross.sinkMatcherId, 'child-process-exec');
    assert.equal(cross.hops![0]!.callCertainty, 'exact');
    assert.equal(cross.hops![0]!.transfer, 'argument:0->parameter:0');
    assert.equal(cross.certainty, 'heuristic');
    assert.equal(result.result!.findings.filter((finding) => !finding.hops).length, 1);
    assert.ok(!result.boundaries.some((item) => item.startsWith('tainted-argument-into-unanalyzed-call:runQuery')));
  });

  it('bounds certainty by candidate dispatch and never labels the path exact', async () => {
    const { repo, graph, registry } = setup({ certainty: 'candidate', ambiguous: true, strategy: 'inheritance-dispatch' });
    const result = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:handler', registry, gate: trusted });
    const cross = result.result!.findings.find((finding) => finding.hops?.length)!;
    assert.equal(cross.hops![0]!.callCertainty, 'candidate-set');
    assert.equal(cross.hops![0]!.callComplete, false);
    assert.equal(cross.hops![0]!.strategy, 'inheritance-dispatch');
    assert.notEqual(cross.certainty, 'exact');
  });

  it('returns intraprocedural evidence but gates cross-function propagation off on an untrusted graph', async () => {
    const { repo, graph, registry } = setup();
    const result = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:handler', registry, gate: untrusted });
    assert.equal(result.interprocedural.allowed, false);
    assert.ok(result.boundaries.some((item) => item.startsWith('gated: semantic graph is not trusted')));
    assert.equal(result.result!.findings.length, 1);
    assert.equal(result.result!.findings[0]!.hops, undefined);
  });

  it('propagates through callee return sources and parameter-to-return summaries', async () => {
    const { repo, graph, registry } = setup();
    const viaReturn = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:viaReturn', registry, gate: trusted });
    const fromCallee = viaReturn.result!.findings[0]!;
    assert.equal(fromCallee.sourceFunctionId, 'fn:readArg');
    assert.equal(fromCallee.hops![0]!.transfer, 'return');

    const viaIdentity = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:viaIdentity', registry, gate: trusted });
    assert.equal(viaIdentity.result!.findings.length, 1);
    assert.equal(viaIdentity.result!.findings[0]!.hops![0]!.calleeFunctionId, 'fn:identity');
  });

  it('stops at unknown parameter mappings with a boundary instead of guessing', async () => {
    const { repo, graph, registry } = setup();
    const result = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:spreadCall', registry, gate: trusted });
    assert.deepEqual(result.result!.findings, []);
    assert.ok(result.boundaries.some((item) => item.startsWith('unknown-parameter-mapping:fn:runQuery:spread-or-keyword-arguments')));
  });

  it('marks call-depth truncation and does not follow heuristic edges', async () => {
    const { repo, graph, registry } = setup();
    const truncated = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:handler', registry, gate: trusted, limits: { ...DEFAULT_PROGRAM_ANALYSIS_LIMITS, maxCallSummaryDepth: 0 } });
    assert.equal(truncated.truncated, true);
    assert.ok(truncated.boundaries.some((item) => item.startsWith('call-depth-limit:')));
    assert.ok(!truncated.result!.findings.some((finding) => finding.hops?.length));

    const heuristic = setup({ certainty: 'heuristic', strategy: 'name-fallback' });
    const result = await traceInterproceduralTaint({ repoDir: heuristic.repo, graph: heuristic.graph, rootNodeId: 'fn:handler', registry: heuristic.registry, gate: trusted });
    assert.ok(result.boundaries.includes('heuristic-call-edge-not-followed:fn:runQuery'));
    assert.ok(!result.result!.findings.some((finding) => finding.hops?.length));
  });

  it('marks function-budget and chain-depth exhaustion as truncated, never as complete', async () => {
    const { repo, graph, registry } = setup();
    const budget = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:handler', registry, gate: trusted, limits: { ...DEFAULT_PROGRAM_ANALYSIS_LIMITS, maxAnalyzedFunctionsPerRequest: 1 } });
    assert.equal(budget.truncated, true);
    assert.ok(budget.truncationReasons.some((reason) => reason.startsWith('maxAnalyzedFunctionsPerRequest')));
    assert.ok(budget.boundaries.some((item) => item.startsWith('function-count-limit:fn:runQuery')));

    const shallow = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:viaIdentity', registry, gate: trusted, limits: { ...DEFAULT_PROGRAM_ANALYSIS_LIMITS, maxIntraproceduralChainDepth: 0 } });
    assert.equal(shallow.result!.truncated, true);
    assert.match(shallow.result!.reason ?? '', /maxIntraproceduralChainDepth/);
  });

  it('terminates on recursion with a boundary', async () => {
    const { repo, graph, registry } = setup();
    const result = await traceInterproceduralTaint({ repoDir: repo, graph, rootNodeId: 'fn:loopA', registry, gate: trusted });
    assert.equal(result.capability, 'supported');
    assert.ok(result.boundaries.some((item) => item.startsWith('recursive-call:fn:loopA')));
  });
});
