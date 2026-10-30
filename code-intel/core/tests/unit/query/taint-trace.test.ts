import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { traceTaint } from '../../../src/query/taint-trace.js';
import type { InterproceduralGateResult } from '../../../src/program-analysis/semantic-graph-gate.js';

const trusted: InterproceduralGateResult = { allowed: true, indexTrust: { trusted: true } as never };
const untrusted: InterproceduralGateResult = { allowed: false, reason: 'semantic graph is not trusted (state: missing): no index', indexTrust: { trusted: false } as never };

function repo(files: Record<string, string>, models?: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taint-trace-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  if (models !== undefined) {
    fs.mkdirSync(path.join(dir, '.code-intel'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.code-intel/taint-models.json'), JSON.stringify(models));
  }
  return dir;
}

const APP = `function run() {
  const input = process.argv[2];
  child_process.execSync(input);
}
function clean() {
  const value = 1;
  child_process.execSync(value);
}
function save(record) {
  db.rawQuery(record);
}
function forward() {
  const input = process.argv[2];
  helper(input);
}
`;

function graphFor() {
  const graph = createKnowledgeGraph();
  graph.addNode({ id: 'fn:run', kind: 'function', name: 'run', filePath: 'src/app.ts', startLine: 1, endLine: 4 });
  graph.addNode({ id: 'fn:clean', kind: 'function', name: 'clean', filePath: 'src/app.ts', startLine: 5, endLine: 8 });
  graph.addNode({ id: 'fn:save', kind: 'function', name: 'save', filePath: 'src/app.ts', startLine: 9, endLine: 11, metadata: { parameters: [{ name: 'record' }] } });
  graph.addNode({ id: 'fn:forward', kind: 'function', name: 'forward', filePath: 'src/app.ts', startLine: 12, endLine: 15 });
  graph.addNode({ id: 'fn:page', kind: 'function', name: 'page', filePath: 'src/page.html', startLine: 1, endLine: 2 });
  graph.addNode({ id: 'fn:run2', kind: 'function', name: 'run', filePath: 'src/other.ts', startLine: 1, endLine: 2 });
  return graph;
}

describe('taint-trace service', () => {
  it('returns findings with model ids, source/sink locations, certainty and coverage', async () => {
    const dir = repo({ 'src/app.ts': APP });
    const result = await traceTaint({ repoDir: dir, graph: graphFor(), symbol: 'function:run@src/app.ts:1', gate: trusted });
    assert.equal(result.verdict, 'findings');
    const finding = result.findings[0]!;
    assert.equal(finding.source.modelId, 'node-core');
    assert.equal(finding.source.matcherId, 'process-argv');
    assert.equal(finding.sink.matcherId, 'child-process-exec-sync');
    assert.equal(finding.sink.category, 'command');
    assert.equal(finding.source.line, 2);
    assert.equal(finding.sink.line, 3);
    assert.equal(finding.certainty, 'heuristic');
    assert.ok(result.models.ids.includes('node-core@1'));
    assert.ok(result.models.fingerprint);
    assert.match(result.summary, /not confirmed exploitability/);
  });

  it('never presents a no-finding result as safe when interprocedural analysis is gated off', async () => {
    const dir = repo({ 'src/app.ts': APP });
    const result = await traceTaint({ repoDir: dir, graph: graphFor(), symbol: 'function:clean@src/app.ts:5', gate: untrusted });
    assert.equal(result.verdict, 'no-findings-partial-coverage');
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.interprocedural.allowed, false);
    assert.doesNotMatch(result.summary, /\bis safe\b/i);
    assert.match(result.summary, /must not be read as the code being safe/);
  });

  it('treats taint escaping into a call with no persisted edge as partial coverage, not as no taint', async () => {
    const dir = repo({ 'src/app.ts': APP });
    const result = await traceTaint({ repoDir: dir, graph: graphFor(), symbol: 'forward', gate: trusted });
    assert.equal(result.verdict, 'no-findings-partial-coverage');
    assert.ok(result.coverage.boundaries.includes('tainted-argument-into-unanalyzed-call:helper'));
  });

  it('qualifies even a complete no-finding result as model-scoped', async () => {
    const dir = repo({ 'src/app.ts': APP });
    const result = await traceTaint({ repoDir: dir, graph: graphFor(), symbol: 'function:clean@src/app.ts:5', gate: trusted });
    assert.equal(result.verdict, 'no-findings-complete');
    assert.match(result.summary, /not a proof/);
  });

  it('reports unsupported languages as unsupported, not as no taint', async () => {
    const dir = repo({ 'src/page.html': '<script>run()</script>\n' });
    const result = await traceTaint({ repoDir: dir, graph: graphFor(), symbol: 'page', gate: trusted });
    assert.equal(result.verdict, 'unsupported');
    assert.equal(result.coverage.complete, false);
    assert.ok(result.coverage.notes.some((note) => note.includes('html')));
  });

  it('reports ambiguous and missing symbols explicitly', async () => {
    const dir = repo({ 'src/app.ts': APP });
    const ambiguous = await traceTaint({ repoDir: dir, graph: graphFor(), symbol: 'run', gate: trusted });
    assert.equal(ambiguous.verdict, 'ambiguous');
    assert.equal(ambiguous.candidates?.length, 2);
    const missing = await traceTaint({ repoDir: dir, graph: graphFor(), symbol: 'ghost', gate: trusted });
    assert.equal(missing.verdict, 'not-found');
  });

  it('applies project models and fails closed on an invalid project model', async () => {
    const model = { schemaVersion: 1, id: 'company-db', version: '1', sources: [], sinks: [{ id: 'raw-query', kind: 'qualified-call', callee: 'db.rawQuery', category: 'sql' }], sanitizers: [] };
    const withModel = repo({ 'src/app.ts': APP.replace('db.rawQuery(record)', 'db.rawQuery(process.argv[1])') }, { schemaVersion: 1, models: [model] });
    const found = await traceTaint({ repoDir: withModel, graph: graphFor(), symbol: 'save', gate: trusted, sink: 'sql' });
    assert.equal(found.verdict, 'findings');
    assert.equal(found.findings[0]!.sink.modelId, 'company-db');
    assert.equal(found.models.projectModels.status, 'loaded');

    const invalid = repo({ 'src/app.ts': APP }, { schemaVersion: 1, models: [{ ...model, sinks: [{ id: 'x', kind: 'regex' }] }] });
    const failed = await traceTaint({ repoDir: invalid, graph: graphFor(), symbol: 'save', gate: trusted });
    assert.equal(failed.verdict, 'model-error');
    assert.ok(failed.models.diagnostics.some((item) => item.matcherId === 'x'));
    assert.deepEqual(failed.findings, []);
  });

  it('filters by source/sink selectors and reports scan truncation', async () => {
    const dir = repo({ 'src/app.ts': APP });
    const filtered = await traceTaint({ repoDir: dir, graph: graphFor(), symbol: 'function:run@src/app.ts:1', gate: trusted, sink: 'sql' });
    assert.equal(filtered.verdict, 'no-findings-complete');
    const scan = await traceTaint({ repoDir: dir, graph: graphFor(), gate: trusted, maxFunctions: 2 });
    assert.equal(scan.truncated, true);
    assert.equal(scan.coverage.complete, false);
    assert.equal(scan.coverage.interprocedural.requested, false);
  });
});
