import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph, type KnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { detectArchitectureLayers } from '../../../src/analysis/architecture-layers.js';
import {
  ARCHITECTURE_POLICY_RELATIVE_PATH,
  layerOf,
  loadArchitecturePolicy,
  validateArchitecturePolicy,
  type ArchitecturePolicyLoad,
} from '../../../src/governance/policy-schema.js';
import { importCycles, runStructuralCheck, severityAtLeast, type StructuralCheckInput } from '../../../src/governance/structural-check.js';
import { buildStructuralSARIF } from '../../../src/cli/sarif-builder.js';
import type { RenameVerification } from '../../../src/refactoring/verify.js';

const POLICY_DOC = {
  schemaVersion: 1,
  layers: [
    { id: 'api', include: ['src/api/**'] },
    { id: 'domain', include: ['src/domain/**'] },
    { id: 'infra', include: ['src/infra/**'] },
  ],
  rules: [{ from: 'domain', forbid: ['api'] }, { from: 'infra', forbid: ['api'], severity: 'warning' }],
};

function loaded(doc: unknown = POLICY_DOC): ArchitecturePolicyLoad {
  const { policy, errors } = validateArchitecturePolicy(doc);
  assert.ok(policy, errors.join('; '));
  return { status: 'loaded', path: ARCHITECTURE_POLICY_RELATIVE_PATH, policy };
}
const ABSENT: ArchitecturePolicyLoad = { status: 'absent', path: ARCHITECTURE_POLICY_RELATIVE_PATH };

/** Build a file-level graph from `from -> to` import pairs. */
function graphOf(imports: Array<[string, string, string?]>, extraFiles: string[] = []): KnowledgeGraph {
  const graph = createKnowledgeGraph();
  const files = new Set([...imports.flatMap(([a, b]) => [a, b]), ...extraFiles]);
  for (const file of files) graph.addNode({ id: `file:${file}`, kind: 'file', name: path.posix.basename(file), filePath: file });
  imports.forEach(([from, to, certainty], i) => graph.addEdge({
    id: `imp:${i}:${from}->${to}`, source: `file:${from}`, target: `file:${to}`, kind: 'imports', certainty: (certainty ?? 'exact') as 'exact',
  }));
  return graph;
}

const OFFLINE_RULES = ['architecture/policy-invalid', 'architecture/layer-violation', 'graph/new-import-cycle', 'api/breaking-change', 'refactor/verification-failed'] as const;

function check(input: Partial<StructuralCheckInput> & Pick<StructuralCheckInput, 'head' | 'changedFiles'>) {
  return runStructuralCheck({ policy: ABSENT, rules: [...OFFLINE_RULES], ...input });
}

const tmpDirs: string[] = [];
after(() => { for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true }); });
function tmpRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-policy-')));
  tmpDirs.push(dir);
  return dir;
}

describe('architecture policy — explicit config', () => {
  it('validates layers, rules, unknown fields and limits', () => {
    assert.ok(validateArchitecturePolicy(POLICY_DOC).policy);
    const bad = validateArchitecturePolicy({ schemaVersion: 1, layers: [{ id: 'a', include: ['x/**'], extra: 1 }], rules: [{ from: 'a', forbid: ['zzz'] }] });
    assert.equal(bad.policy, undefined);
    assert.ok(bad.errors.some((e) => e.includes('extra')));
    assert.ok(bad.errors.some((e) => e.includes("unknown layer 'zzz'")));
    assert.ok(validateArchitecturePolicy({ schemaVersion: 2, layers: [] }).errors.length > 0);
  });

  it('loads from the fixed repo path, refusing escape, oversize and malformed files', () => {
    const repo = tmpRepo();
    assert.equal(loadArchitecturePolicy(repo).status, 'absent');
    fs.mkdirSync(path.join(repo, '.code-intel'));
    const file = path.join(repo, ARCHITECTURE_POLICY_RELATIVE_PATH);
    fs.writeFileSync(file, JSON.stringify(POLICY_DOC));
    assert.equal(loadArchitecturePolicy(repo).status, 'loaded');
    fs.writeFileSync(file, '{ not json');
    assert.equal(loadArchitecturePolicy(repo).status, 'invalid');
    fs.writeFileSync(file, ' '.repeat(300 * 1024));
    assert.equal(loadArchitecturePolicy(repo).status, 'invalid');
    fs.rmSync(file);
    const outside = path.join(tmpRepo(), 'policy.json');
    fs.writeFileSync(outside, JSON.stringify(POLICY_DOC));
    fs.symlinkSync(outside, file);
    const escaped = loadArchitecturePolicy(repo);
    assert.equal(escaped.status, 'invalid');
    assert.match(escaped.status === 'invalid' ? escaped.errors[0] : '', /outside the repository/);
  });

  it('assigns the first matching layer and honors excludes', () => {
    const policy = loaded({ schemaVersion: 1, layers: [{ id: 'a', include: ['src/**'], exclude: ['src/gen/**'] }, { id: 'b', include: ['src/gen/**'] }] });
    assert.ok(policy.status === 'loaded');
    if (policy.status !== 'loaded') return;
    assert.equal(layerOf(policy.policy, 'src/x.ts'), 'a');
    assert.equal(layerOf(policy.policy, 'src/gen/y.ts'), 'b');
    assert.equal(layerOf(policy.policy, 'test/z.ts'), null);
  });
});

describe('architecture layers — inferred suggestions are advisory only', () => {
  const head = graphOf([['src/domain/user.ts', 'src/api/routes.ts'], ['src/api/routes.ts', 'src/domain/user.ts']]);

  it('suggests layers with confidence and evidence', () => {
    const report = detectArchitectureLayers(head);
    assert.equal(report.advisory, true);
    const domain = report.suggestions.find((s) => s.role === 'domain');
    assert.ok(domain);
    assert.equal(domain.advisory, true);
    assert.ok(domain.confidence > 0 && domain.confidence <= 0.95);
    assert.ok(domain.evidence.some((e) => e.kind === 'path-pattern'));
    assert.ok(domain.evidence.some((e) => e.kind === 'import-direction'));
  });

  it('never produces a blocking finding without an explicit policy', async () => {
    const result = await check({ head, changedFiles: ['src/domain/user.ts'], rules: ['architecture/policy-invalid', 'architecture/layer-violation'] });
    assert.equal(result.findings.length, 0);
    assert.ok(result.advisory.layers.length > 0);
    assert.equal(result.rules.find((r) => r.id === 'architecture/layer-violation')?.status, 'skipped');
    assert.ok(!result.findings.some((f) => severityAtLeast(f.severity, 'note')));
  });

  it('enforces only explicitly declared layers, even when inference disagrees', async () => {
    // Policy covers only `domain`; the inferred `api` directory is not a declared layer.
    const partial = loaded({ schemaVersion: 1, layers: [{ id: 'domain', include: ['src/domain/**'] }, { id: 'web', include: ['src/web/**'] }], rules: [{ from: 'domain', forbid: ['web'] }] });
    const result = await check({ head, changedFiles: ['src/domain/user.ts'], policy: partial, rules: ['architecture/layer-violation'] });
    assert.equal(result.findings.length, 0);
  });
});

describe('structural check — explicit layer violations', () => {
  const head = graphOf([
    ['src/domain/user.ts', 'src/api/routes.ts'],
    ['src/infra/db.ts', 'src/api/routes.ts', 'heuristic'],
    ['src/api/routes.ts', 'src/domain/user.ts'],
  ]);

  it('reports a forbidden import as an exact error with evidence', async () => {
    const result = await check({ head, changedFiles: ['src/domain/user.ts', 'src/infra/db.ts', 'src/api/routes.ts'], policy: loaded() });
    const violations = result.findings.filter((f) => f.ruleId === 'architecture/layer-violation');
    assert.equal(violations.length, 2);
    const domain = violations.find((f) => f.location.filePath === 'src/domain/user.ts')!;
    assert.equal(domain.severity, 'error');
    assert.equal(domain.certainty, 'exact');
    assert.equal(domain.introduced, null);
    assert.ok(domain.evidence.some((e) => e.includes('domain forbids [api]')));
    const infra = violations.find((f) => f.location.filePath === 'src/infra/db.ts')!;
    assert.equal(infra.severity, 'warning', 'rule severity is honored');
    assert.equal(infra.certainty, 'heuristic');
  });

  it('caps non-exact evidence below error', async () => {
    const heuristic = graphOf([['src/domain/user.ts', 'src/api/routes.ts', 'heuristic']]);
    const result = await check({ head: heuristic, changedFiles: ['src/domain/user.ts'], policy: loaded() });
    assert.equal(result.findings[0]?.severity, 'warning');
  });

  it('only checks changed files and downgrades pre-existing violations to notes', async () => {
    const unchanged = await check({ head, changedFiles: ['src/api/routes.ts'], policy: loaded() });
    assert.equal(unchanged.findings.filter((f) => f.ruleId === 'architecture/layer-violation').length, 0);
    const preExisting = await check({ head, base: head, changedFiles: ['src/domain/user.ts'], policy: loaded() });
    const finding = preExisting.findings.find((f) => f.ruleId === 'architecture/layer-violation')!;
    assert.equal(finding.introduced, false);
    assert.equal(finding.severity, 'note');
  });

  it('reports an invalid policy as an error instead of silently skipping', async () => {
    const result = await check({ head, changedFiles: ['src/domain/user.ts'], policy: { status: 'invalid', path: ARCHITECTURE_POLICY_RELATIVE_PATH, errors: ['is not valid JSON'] } });
    assert.equal(result.findings[0]?.ruleId, 'architecture/policy-invalid');
    assert.equal(result.findings[0]?.severity, 'error');
  });
});

describe('structural check — import cycles', () => {
  it('finds cyclic components only', () => {
    const cycles = importCycles(new Map([
      ['a', new Map([['b', 'exact' as const]])],
      ['b', new Map([['c', 'exact' as const]])],
      ['c', new Map([['a', 'exact' as const]])],
      ['d', new Map([['a', 'exact' as const]])],
      ['e', new Map([['e', 'exact' as const]])],
    ]));
    assert.deepEqual(cycles, [['a', 'b', 'c'], ['e']]);
  });

  it('distinguishes new cycles from pre-existing ones when a base exists', async () => {
    const base = graphOf([['src/a.ts', 'src/b.ts'], ['src/c.ts', 'src/d.ts'], ['src/d.ts', 'src/c.ts']]);
    const head = graphOf([['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/a.ts'], ['src/c.ts', 'src/d.ts'], ['src/d.ts', 'src/c.ts']]);
    const result = await check({ head, base, changedFiles: ['src/b.ts', 'src/c.ts'], rules: ['graph/new-import-cycle'] });
    const cycles = result.findings.filter((f) => f.ruleId === 'graph/new-import-cycle');
    assert.equal(cycles.length, 2);
    const fresh = cycles.find((f) => f.introduced === true)!;
    assert.equal(fresh.severity, 'warning');
    assert.equal(fresh.location.filePath, 'src/b.ts');
    const old = cycles.find((f) => f.introduced === false)!;
    assert.equal(old.severity, 'note');
    assert.equal(result.coverage.complete, true);
  });

  it('a grown cycle counts as new', async () => {
    const base = graphOf([['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/a.ts']]);
    const head = graphOf([['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/c.ts'], ['src/c.ts', 'src/a.ts']]);
    const result = await check({ head, base, changedFiles: ['src/c.ts'] });
    assert.equal(result.findings[0]?.introduced, true);
  });

  it('marks coverage incomplete and never claims "new" without a base', async () => {
    const head = graphOf([['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/a.ts']]);
    const result = await check({ head, changedFiles: ['src/a.ts'] });
    assert.equal(result.findings[0]?.introduced, null);
    assert.equal(result.findings[0]?.severity, 'note');
    assert.equal(result.coverage.complete, false);
    assert.ok(result.coverage.incompleteReasons.some((r) => r.includes('no base graph')));
  });
});

describe('structural check — API drift and refactor verification', () => {
  it('turns breaking API findings into located, deterministic findings', async () => {
    const head = graphOf([], ['src/api/routes.ts']);
    head.addNode({ id: 'route:get-users', kind: 'route', name: '/users', filePath: 'src/api/routes.ts', startLine: 12, metadata: { apiContract: { factId: 'rf-1', method: 'GET', path: '/users', normalizedPath: '/users' } } });
    const api = {
      consumerCoverageComplete: true,
      findings: [
        { rule: 'response-field-removed' as const, verdict: 'breaking' as const, routeFactId: 'rf-1', affectedConsumerFactIds: ['c1', 'c2'], fieldKey: 'email', reason: 'response field email removed', boundaryReasons: [] },
        { rule: 'response-field-added-optional' as const, verdict: 'compatible' as const, routeFactId: 'rf-1', affectedConsumerFactIds: [], reason: 'ok', boundaryReasons: [] },
      ],
    };
    const result = await check({ head, base: head, changedFiles: ['src/api/routes.ts'], api });
    const findings = result.findings.filter((f) => f.ruleId === 'api/breaking-change');
    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0].location, { filePath: 'src/api/routes.ts', startLine: 12 });
    assert.equal(findings[0].severity, 'error');
    assert.equal(findings[0].certainty, 'exact');
    assert.ok(findings[0].evidence.includes('2 known affected consumer(s)'));

    const again = await check({ head, base: head, changedFiles: ['src/api/routes.ts'], api });
    assert.deepEqual(again, result, 'identical input gives identical output');
    const sarif = buildStructuralSARIF(result, '1.0.12');
    assert.deepEqual(buildStructuralSARIF(again, '1.0.12'), sarif);
    const sarifResult = sarif.runs[0].results[0];
    assert.equal(sarifResult.ruleId, 'api/breaking-change');
    assert.equal(sarifResult.level, 'error');
    assert.equal(sarifResult.locations[0].physicalLocation.region.startLine, 12);
    assert.equal(sarifResult.partialFingerprints?.['codeIntelFindingId/v1'], findings[0].id);
    assert.ok(sarif.runs[0].tool.driver.rules.some((r) => r.id === 'graph/new-import-cycle'));
    assert.deepEqual((sarif.runs[0].properties as { coverage: unknown }).coverage, result.coverage);
  });

  it('skips API drift with an explicit coverage gap when no base exists', async () => {
    const result = await check({ head: graphOf([]), changedFiles: [] });
    assert.equal(result.rules.find((r) => r.id === 'api/breaking-change')?.status, 'skipped');
    assert.ok(result.coverage.incompleteReasons.some((r) => r.includes('API contract drift not computed')));
  });

  it('reports failed rename verification checks as errors', async () => {
    const verification: RenameVerification = {
      verdict: 'failed', planId: 'rename:v1:abc', newTargetId: null, warnings: [], tests: [],
      graphDelta: { nodesBefore: 1, nodesAfter: 1, edgesBefore: 0, edgesAfter: 0 },
      checks: [
        { id: 'new-definition', passed: true, detail: 'ok' },
        { id: 'source-references-resolve', passed: false, detail: 'src/c.ts expected 2, found 0', filePath: 'src/c.ts' },
      ],
    };
    const result = await check({ head: graphOf([]), changedFiles: ['src/c.ts'], renameVerification: verification });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].ruleId, 'refactor/verification-failed');
    assert.equal(result.findings[0].location.filePath, 'src/c.ts');
  });

  it('truncates with an explicit marker', async () => {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < 5; i++) pairs.push([`src/x${i}.ts`, `src/y${i}.ts`], [`src/y${i}.ts`, `src/x${i}.ts`]);
    const result = await check({ head: graphOf(pairs), changedFiles: pairs.map(([a]) => a), maxFindings: 2 });
    assert.equal(result.findings.length, 2);
    assert.equal(result.totalFindings, 5);
    assert.equal(result.truncated, true);
    assert.equal(result.coverage.complete, false);
  });
});

describe('structural check — changed high-risk behavior', () => {
  it('flags a changed HIGH-risk symbol without tests as a heuristic warning', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'fn:core', kind: 'function', name: 'core', filePath: 'src/core.ts', startLine: 3 });
    for (let i = 0; i < 60; i++) {
      graph.addNode({ id: `fn:caller${i}`, kind: 'function', name: `caller${i}`, filePath: `src/c${i}.ts`, startLine: 1 });
      graph.addEdge({ id: `call:${i}`, source: `fn:caller${i}`, target: 'fn:core', kind: 'calls', certainty: 'exact' });
    }
    const result = await runStructuralCheck({ head: graph, changedFiles: ['src/core.ts'], policy: ABSENT, rules: ['risk/untested-change'] });
    const finding = result.findings.find((f) => f.ruleId === 'risk/untested-change');
    assert.ok(finding, JSON.stringify(result));
    assert.equal(finding.severity, 'warning');
    assert.equal(finding.certainty, 'heuristic');
    assert.deepEqual(finding.location, { filePath: 'src/core.ts', startLine: 3 });
  });
});
