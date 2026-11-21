import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { buildRenamePlan, selectRenameTarget } from '../../../src/refactoring/rename-plan.js';
import { applyRenamePlan, RenameApplyError } from '../../../src/refactoring/apply.js';
import { analyzeWorkspaceInMemory, verifyAppliedRename, verifyRenameResult } from '../../../src/refactoring/verify.js';
import { REFACTORING_CAPABILITIES, getRefactoringCapability, type RenamePlan } from '../../../src/refactoring/contracts.js';
import { Language } from '../../../src/shared/languages.js';

const FIXTURE: Record<string, string> = {
  'src/user-service.ts': [
    'export class UserService {',
    '  find(id: string): string { return id; }',
    '}',
    'export function makeUserService(): UserService {',
    '  return new UserService();',
    '}',
    '',
  ].join('\n'),
  'src/consumer.ts': [
    "import { UserService } from './user-service.js';",
    "import { UserService as Svc } from './user-service.js';",
    '// UserService is documented here',
    "const label = 'UserService';",
    'export function useIt(): string {',
    '  const a = new UserService();',
    '  const b = new Svc();',
    '  return a.find(label) + b.find(label);',
    '}',
    '',
  ].join('\n'),
  'src/index.ts': "export { UserService } from './user-service.js';\n",
  'src/override.ts': [
    "import { UserService } from './user-service.js';",
    'export class AdminService extends UserService {',
    '  find(id: string): string { return `admin:${id}`; }',
    '}',
    '',
  ].join('\n'),
  'src/dup-a.ts': 'export function load(): number { return 1; }\n',
  'src/dup-b.ts': 'export function load(): number { return 2; }\n',
  'config/settings.json': '{ "service": "UserService" }\n',
  'tools/helper.py': 'def helper():\n    return 1\n\ndef run():\n    return helper()\n',
};

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args], { cwd, stdio: 'pipe' });

function makeRepo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-rename-')));
  for (const [file, text] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return root;
}

function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(Object.keys(FIXTURE).map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
}

async function plan(root: string, selector: string, newName: string): Promise<RenamePlan> {
  const graph = await analyzeWorkspaceInMemory(root);
  const result = await buildRenamePlan({ graph, workspaceRoot: root, selector, newName });
  assert.equal(result.status, 'planned', JSON.stringify(result));
  return (result as { plan: RenamePlan }).plan;
}

function expectApplyError(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof RenameApplyError && error.code === code);
}

const roots: string[] = [];
const freshRepo = () => {
  const root = makeRepo();
  roots.push(root);
  return root;
};
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe('refactoring — capability matrix', () => {
  it('publishes one row for each of the 15 languages', () => {
    const languages = new Set(REFACTORING_CAPABILITIES.map((row) => row.language));
    assert.equal(languages.size, REFACTORING_CAPABILITIES.length);
    assert.equal(REFACTORING_CAPABILITIES.length, 15);
    for (const language of Object.values(Language)) assert.ok(languages.has(language), `missing row for ${language}`);
  });
  it('grants apply only to the tested TS/JS adapter', () => {
    assert.deepEqual(REFACTORING_CAPABILITIES.filter((row) => row.rename === 'apply').map((row) => row.language).sort(), ['javascript', 'typescript']);
    assert.equal(getRefactoringCapability(Language.Python).rename, 'preview-only');
    assert.equal(getRefactoringCapability(undefined).rename, 'unsupported');
  });
});

describe('refactoring — canonical selector resolution', () => {
  it('refuses an ambiguous simple name and lists disambiguation candidates', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'function:load@src/dup-a.ts:1', kind: 'function', name: 'load', filePath: 'src/dup-a.ts', startLine: 1 });
    graph.addNode({ id: 'function:load@src/dup-b.ts:1', kind: 'function', name: 'load', filePath: 'src/dup-b.ts', startLine: 1 });
    const result = selectRenameTarget(graph, 'load');
    assert.equal(result.status, 'ambiguous');
    assert.deepEqual(result.status === 'ambiguous' && result.candidates.map((c) => c.filePath), ['src/dup-a.ts', 'src/dup-b.ts']);
    const exact = selectRenameTarget(graph, 'function:load@src/dup-b.ts');
    assert.equal(exact.status === 'exact' && exact.target.filePath, 'src/dup-b.ts');
    assert.equal(selectRenameTarget(graph, 'function:load@src/dup-b.ts:1').status, 'exact');
    assert.equal(selectRenameTarget(graph, 'nope').status, 'missing');
  });

  it('keeps same-file overloads apart when the selector pins a line', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'method:run@src/a.ts:2', kind: 'method', name: 'run', filePath: 'src/a.ts', startLine: 2 });
    graph.addNode({ id: 'method:run@src/a.ts:3', kind: 'method', name: 'run', filePath: 'src/a.ts', startLine: 3 });
    assert.equal(selectRenameTarget(graph, 'method:run@src/a.ts').status, 'ambiguous');
    const pinned = selectRenameTarget(graph, 'method:run@src/a.ts:3');
    assert.equal(pinned.status === 'exact' && pinned.target.id, 'method:run@src/a.ts:3');
    assert.equal(selectRenameTarget(graph, 'run').status, 'ambiguous');
  });

  it('ignores non-symbol nodes that share the name', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'file:load', kind: 'file', name: 'load', filePath: 'load' });
    graph.addNode({ id: 'function:load@src/a.ts:1', kind: 'function', name: 'load', filePath: 'src/a.ts', startLine: 1 });
    const result = selectRenameTarget(graph, 'load');
    assert.equal(result.status === 'exact' && result.target.kind, 'function');
  });
});

describe('refactoring — rename plan → apply → verify (TypeScript)', () => {
  let root: string;
  before(() => { root = freshRepo(); });

  it('fails an ambiguous name against a real index without touching files', async () => {
    const graph = await analyzeWorkspaceInMemory(root);
    const result = await buildRenamePlan({ graph, workspaceRoot: root, selector: 'load', newName: 'loadAll' });
    assert.equal(result.status, 'ambiguous');
  });

  it('dry-run plans exact edits, candidates and boundaries without writing', async () => {
    const beforeFiles = snapshot(root);
    const p = await plan(root, 'UserService', 'AccountService');
    assert.deepEqual(snapshot(root), beforeFiles);
    assert.equal(p.applicable, true, JSON.stringify(p.boundaries));
    assert.equal(p.capability.rename, 'apply');
    assert.match(p.planId, /^rename:v1:[0-9a-f]{64}$/);
    const editFiles = [...new Set(p.edits.map((e) => e.filePath))].sort();
    assert.deepEqual(editFiles, ['src/consumer.ts', 'src/index.ts', 'src/override.ts', 'src/user-service.ts']);
    assert.ok(p.occurrences.some((o) => o.category === 'candidate-text' && o.role === 'string' && o.filePath === 'src/consumer.ts'));
    assert.ok(p.occurrences.some((o) => o.category === 'candidate-text' && o.role === 'comment'));
    assert.equal(p.expectedDelta.definition.newName, 'AccountService');
    // A second plan over unchanged files is byte-identical (stable ordering).
    const again = await plan(root, 'UserService', 'AccountService');
    assert.equal(again.planId, p.planId);
    assert.deepEqual(again.edits, p.edits);
  });

  it('refuses a dirty tree without acknowledgement, then applies and verifies', async () => {
    const p = await plan(root, 'UserService', 'AccountService');
    fs.appendFileSync(path.join(root, 'src/consumer.ts'), '\n');
    expectApplyError(() => applyRenamePlan({ plan: p, workspaceRoot: root }), 'STALE_PLAN');
    const dirtyPlan = await plan(root, 'UserService', 'AccountService');
    expectApplyError(() => applyRenamePlan({ plan: dirtyPlan, workspaceRoot: root }), 'DIRTY_TREE');

    const beforeGraph = await analyzeWorkspaceInMemory(root);
    const result = applyRenamePlan({ plan: dirtyPlan, workspaceRoot: root, allowDirty: true });
    assert.equal(result.planId, dirtyPlan.planId);
    assert.equal(result.files.length, 4);

    const consumer = fs.readFileSync(path.join(root, 'src/consumer.ts'), 'utf8');
    assert.match(consumer, /import \{ AccountService \} from/);
    assert.match(consumer, /import \{ AccountService as Svc \} from/);
    assert.match(consumer, /new AccountService\(\)/);
    assert.match(consumer, /new Svc\(\)/, 'local alias is untouched');
    assert.match(consumer, /'UserService'/, 'candidate string is untouched');
    assert.match(consumer, /\/\/ UserService is documented/, 'comment is untouched');
    assert.equal(fs.readFileSync(path.join(root, 'config/settings.json'), 'utf8'), FIXTURE['config/settings.json']);
    assert.match(fs.readFileSync(path.join(root, 'src/override.ts'), 'utf8'), /extends AccountService/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'src')).filter((f) => f.includes('code-intel-rename')), []);
    // No commit or staging happens.
    assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }), '');

    const verification = await verifyAppliedRename({ plan: dirtyPlan, workspaceRoot: root, before: beforeGraph });
    assert.equal(verification.verdict, 'verified', JSON.stringify(verification.checks));
    assert.ok(verification.newTargetId);
    assert.deepEqual(verification.checks.map((c) => c.id), [
      'new-definition', 'old-definition-removed', 'references-resolve', 'source-references-resolve', 'api-compatible', 'structural-check',
    ]);
  });
});

describe('refactoring — in-memory analysis', () => {
  it('never writes index artifacts (evidence included) into the workspace', async () => {
    const root = freshRepo();
    const p = await plan(root, 'UserService', 'AccountService');
    const beforeGraph = await analyzeWorkspaceInMemory(root);
    applyRenamePlan({ plan: p, workspaceRoot: root });
    await verifyAppliedRename({ plan: p, workspaceRoot: root, before: beforeGraph });
    assert.equal(fs.existsSync(path.join(root, '.code-intel')), false);
  });
});

describe('refactoring — verification withholds success', () => {
  it('fails when an expected exact reference no longer resolves to the new symbol', async () => {
    const root = freshRepo();
    const p = await plan(root, 'UserService', 'AccountService');
    const beforeGraph = await analyzeWorkspaceInMemory(root);
    applyRenamePlan({ plan: p, workspaceRoot: root });
    // Simulate a reference the rewrite did not carry: point consumer.ts's import elsewhere.
    const file = path.join(root, 'src/consumer.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('AccountService', 'MissingService'));
    const verification = await verifyAppliedRename({ plan: p, workspaceRoot: root, before: beforeGraph });
    assert.equal(verification.verdict, 'failed');
    const failed = verification.checks.find((c) => c.id === 'source-references-resolve');
    assert.equal(failed?.passed, false);
    assert.equal(failed?.filePath, 'src/consumer.ts');
  });

  it('fails when the renamed definition is missing', async () => {
    const root = freshRepo();
    const p = await plan(root, 'UserService', 'AccountService');
    const beforeGraph = await analyzeWorkspaceInMemory(root);
    const verification = verifyRenameResult(p, beforeGraph, beforeGraph);
    assert.equal(verification.verdict, 'failed');
    assert.equal(verification.checks.find((c) => c.id === 'new-definition')?.passed, false);
  });
});

describe('refactoring — apply safety rails', () => {
  it('refuses path escape, symlinks, tampered edits and generated files', async () => {
    const root = freshRepo();
    const p = await plan(root, 'makeUserService', 'createUserService');
    assert.equal(p.applicable, true, JSON.stringify(p.boundaries));

    const escape: RenamePlan = structuredClone(p);
    escape.fingerprint.files = [{ filePath: '../outside.ts', sha256: 'x' }];
    escape.edits = escape.edits.map((e) => ({ ...e, filePath: '../outside.ts' }));
    expectApplyError(() => applyRenamePlan({ plan: escape, workspaceRoot: root }), 'PATH_ESCAPE');

    const tampered: RenamePlan = structuredClone(p);
    tampered.edits[0] = { ...tampered.edits[0], newText: 'evil(); //' };
    expectApplyError(() => applyRenamePlan({ plan: tampered, workspaceRoot: root }), 'NOT_APPLICABLE');

    const uncovered: RenamePlan = structuredClone(p);
    uncovered.edits.push({ ...uncovered.edits[0], filePath: 'src/dup-a.ts' });
    expectApplyError(() => applyRenamePlan({ plan: uncovered, workspaceRoot: root }), 'NOT_APPLICABLE');

    const generated: RenamePlan = structuredClone(p);
    generated.fingerprint.files = [{ filePath: 'node_modules/x/index.ts', sha256: 'x' }];
    generated.edits = generated.edits.map((e) => ({ ...e, filePath: 'node_modules/x/index.ts' }));
    fs.mkdirSync(path.join(root, 'node_modules/x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/x/index.ts'), FIXTURE['src/user-service.ts']);
    expectApplyError(() => applyRenamePlan({ plan: generated, workspaceRoot: root }), 'GENERATED_FILE');

    const target = path.join(root, 'src/user-service.ts');
    const real = path.join(root, 'src/real-user-service.ts');
    fs.renameSync(target, real);
    fs.symlinkSync(real, target);
    expectApplyError(() => applyRenamePlan({ plan: p, workspaceRoot: root }), 'PATH_ESCAPE');
  });

  it('keeps members/overrides and preview-only languages out of apply', async () => {
    const root = freshRepo();
    const method = await plan(root, 'method:find@src/user-service.ts:2', 'lookup');
    assert.equal(method.applicable, false);
    assert.ok(method.boundaries.some((b) => b.kind === 'non-module-scope'));
    expectApplyError(() => applyRenamePlan({ plan: method, workspaceRoot: root }), 'NOT_APPLICABLE');

    const python = await plan(root, 'helper', 'assist');
    assert.equal(python.capability.rename, 'preview-only');
    assert.equal(python.applicable, false);
    assert.deepEqual(python.edits, []);
    assert.ok(python.boundaries.some((b) => b.kind === 'preview-only-language'));
    assert.ok(python.occurrences.every((o) => o.category === 'unsupported' && o.startOffset === undefined));
    expectApplyError(() => applyRenamePlan({ plan: python, workspaceRoot: root }), 'NOT_APPLICABLE');

    const forged: RenamePlan = { ...python, applicable: true, capability: { ...python.capability, rename: 'apply' } };
    expectApplyError(() => applyRenamePlan({ plan: forged, workspaceRoot: root }), 'NOT_APPLICABLE');
  });

  it('rejects invalid and reserved new names at plan time', async () => {
    const root = freshRepo();
    for (const name of ['class', '1abc', 'a-b', 'UserService']) {
      const p = await plan(root, 'UserService', name);
      assert.equal(p.applicable, false, name);
      assert.ok(p.boundaries.some((b) => b.kind === 'invalid-new-name'), name);
    }
  });
});
