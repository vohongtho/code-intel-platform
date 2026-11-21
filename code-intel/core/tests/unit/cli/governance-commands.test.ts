import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CHECK_ERROR_EXIT_CODE, CHECK_FINDINGS_EXIT_CODE, runCheckCommand, runRenameCommand } from '../../../src/cli/governance-commands.js';
import { analyzeWorkspaceInMemory } from '../../../src/refactoring/verify.js';
import { AMBIGUOUS_SYMBOL_EXIT_CODE } from '../../../src/cli/symbol-target.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

const POLICY = {
  schemaVersion: 1,
  layers: [{ id: 'api', include: ['src/api/**'] }, { id: 'domain', include: ['src/domain/**'] }],
  rules: [{ from: 'domain', forbid: ['api'] }],
};

const roots: string[] = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function repo(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gov-cli-')));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

const BASE_FILES = {
  'src/api/routes.ts': "export function listUsers(): string[] { return []; }\n",
  'src/domain/user.ts': "export function userName(id: string): string { return id; }\n",
};

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
}

const fresh = async (root: string) => ({ graph: await analyzeWorkspaceInMemory(root) });

describe('code-intel check', () => {
  it('fails on an explicit layer violation in working-tree changes (JSON + SARIF)', async () => {
    const root = repo({ ...BASE_FILES, '.code-intel/architecture-policy.json': JSON.stringify(POLICY) });
    fs.writeFileSync(path.join(root, 'src/domain/user.ts'), "import { listUsers } from '../api/routes.js';\nexport function userName(id: string): string { return listUsers()[0] ?? id; }\n");

    const json = io();
    const code = await runCheckCommand({ path: root, changed: true, fresh: true, format: 'json' }, fresh, '1.0.12', json.io);
    assert.equal(code, CHECK_FINDINGS_EXIT_CODE);
    const result = JSON.parse(json.out.join('\n'));
    const violation = result.findings.find((f: { ruleId: string }) => f.ruleId === 'architecture/layer-violation');
    assert.ok(violation, json.out.join('\n'));
    assert.equal(violation.location.filePath, 'src/domain/user.ts');
    assert.equal(violation.severity, 'error');
    assert.ok(result.changedFiles.includes('src/domain/user.ts'));

    const sarif = io();
    await runCheckCommand({ path: root, changed: true, fresh: true, format: 'sarif' }, fresh, '1.0.12', sarif.io);
    const report = JSON.parse(sarif.out.join('\n'));
    assert.equal(report.version, '2.1.0');
    assert.equal(report.runs[0].results[0].ruleId, 'architecture/layer-violation');
    assert.equal(report.runs[0].results[0].partialFingerprints['codeIntelFindingId/v1'], violation.id);

    assert.equal(await runCheckCommand({ path: root, changed: true, fresh: true, format: 'json', failOn: 'never' }, fresh, '1.0.12', io().io), 0);
    assert.equal(await runCheckCommand({ path: root, changed: true, fresh: true, format: 'json', rules: 'graph/new-import-cycle' }, fresh, '1.0.12', io().io), 0);
  });

  it('passes the same change when the layers are only inferred', async () => {
    const root = repo(BASE_FILES);
    fs.writeFileSync(path.join(root, 'src/domain/user.ts'), "import { listUsers } from '../api/routes.js';\nexport function userName(): string { return listUsers()[0]; }\n");
    const json = io();
    const code = await runCheckCommand({ path: root, changed: true, fresh: true, format: 'json', failOn: 'warning' }, fresh, '1.0.12', json.io);
    const result = JSON.parse(json.out.join('\n'));
    assert.equal(code, 0, json.out.join('\n'));
    assert.equal(result.findings.filter((f: { ruleId: string }) => f.ruleId.startsWith('architecture/')).length, 0);
    assert.equal(result.policy.status, 'absent');
    assert.ok(result.advisory.layers.length > 0);
  });

  it('classifies a new cycle against --base and reports stale-index coverage', async () => {
    const root = repo(BASE_FILES);
    const base = git(root, 'rev-parse', 'HEAD').trim();
    fs.writeFileSync(path.join(root, 'src/domain/user.ts'), "import { listUsers } from '../api/routes.js';\nexport function userName(): string { return listUsers()[0]; }\n");
    fs.writeFileSync(path.join(root, 'src/api/routes.ts'), "import { userName } from '../domain/user.js';\nexport function listUsers(): string[] { return [userName.name]; }\n");
    git(root, 'commit', '-qam', 'cycle');

    const json = io();
    const code = await runCheckCommand({ path: root, base, format: 'json', failOn: 'warning' }, fresh, '1.0.12', json.io);
    const result = JSON.parse(json.out.join('\n'));
    const cycle = result.findings.find((f: { ruleId: string }) => f.ruleId === 'graph/new-import-cycle');
    assert.ok(cycle, json.out.join('\n'));
    assert.equal(cycle.introduced, true);
    assert.equal(code, CHECK_FINDINGS_EXIT_CODE);
    assert.equal(result.rules.find((r: { id: string }) => r.id === 'api/breaking-change').status, 'ran');
  });

  it('refuses to run without a scope and rejects bad options', async () => {
    const root = repo(BASE_FILES);
    assert.equal(await runCheckCommand({ path: root }, fresh, '1', io().io), CHECK_ERROR_EXIT_CODE);
    assert.equal(await runCheckCommand({ path: root, changed: true, failOn: 'loud' }, fresh, '1', io().io), CHECK_ERROR_EXIT_CODE);
    assert.equal(await runCheckCommand({ path: root, changed: true, rules: 'nope' }, fresh, '1', io().io), CHECK_ERROR_EXIT_CODE);
    assert.equal(await runCheckCommand({ path: root, base: 'no-such-ref' }, fresh, '1', io().io), CHECK_ERROR_EXIT_CODE);
  });

  it('installs the pre-commit hook only on request and never overwrites one', async () => {
    const root = repo(BASE_FILES);
    const hook = path.join(root, '.git/hooks/pre-commit');
    await runCheckCommand({ path: root, changed: true, fresh: true, format: 'json' }, fresh, '1', io().io);
    assert.equal(fs.existsSync(hook), false, 'a normal check never installs a hook');
    assert.equal(await runCheckCommand({ path: root, installHook: true }, fresh, '1', io().io), 0);
    assert.match(fs.readFileSync(hook, 'utf8'), /code-intel check --changed/);
    assert.ok((fs.statSync(hook).mode & 0o111) !== 0);
    fs.writeFileSync(hook, '#!/bin/sh\necho mine\n');
    assert.equal(await runCheckCommand({ path: root, installHook: true }, fresh, '1', io().io), CHECK_ERROR_EXIT_CODE);
    assert.equal(fs.readFileSync(hook, 'utf8'), '#!/bin/sh\necho mine\n');
  });
});

describe('code-intel refactor rename', () => {
  const FILES = {
    'src/a.ts': 'export function load(): number { return 1; }\n',
    'src/b.ts': 'export function load(): number { return 2; }\n',
    'src/use.ts': "import { load } from './a.js';\nexport const v = load();\n",
  };

  it('dry-runs by default, refuses ambiguity, and applies only a matching reviewed plan', async () => {
    const root = repo(FILES);
    const before = Object.fromEntries(Object.keys(FILES).map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));

    const ambiguous = io();
    assert.equal(await runRenameCommand('load', 'loadOne', { path: root }, fresh, ambiguous.io), AMBIGUOUS_SYMBOL_EXIT_CODE);
    assert.ok(ambiguous.err.some((line) => line.includes('function:load@src/a.ts:1')));

    const dry = io();
    assert.equal(await runRenameCommand('function:load@src/a.ts', 'loadOne', { path: root, format: 'json' }, fresh, dry.io), 0);
    const { plan } = JSON.parse(dry.out.join('\n'));
    assert.equal(plan.applicable, true);
    for (const [f, text] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(root, f), 'utf8'), text, `${f} unchanged by dry run`);

    const stale = io();
    assert.equal(await runRenameCommand('function:load@src/a.ts', 'loadOne', { path: root, apply: true, expectPlan: 'rename:v1:deadbeef' }, fresh, stale.io), 1);
    assert.ok(stale.err.some((line) => line.includes('STALE_PLAN')));
    assert.equal(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8'), before['src/a.ts']);

    const applied = io();
    assert.equal(await runRenameCommand('function:load@src/a.ts', 'loadOne', { path: root, apply: true, expectPlan: plan.planId, format: 'json' }, fresh, applied.io), 0);
    const output = JSON.parse(applied.out.join('\n'));
    assert.equal(output.verification.verdict, 'verified');
    assert.match(fs.readFileSync(path.join(root, 'src/use.ts'), 'utf8'), /import \{ loadOne \} from '\.\/a\.js';\nexport const v = loadOne\(\);/);
    assert.equal(fs.readFileSync(path.join(root, 'src/b.ts'), 'utf8'), before['src/b.ts'], 'same-name symbol in another module untouched');
  });

  it('rejects conflicting flags', async () => {
    const root = repo(FILES);
    assert.equal(await runRenameCommand('function:load@src/a.ts', 'x', { path: root, apply: true, dryRun: true }, fresh, io().io), CHECK_ERROR_EXIT_CODE);
    assert.equal(await runRenameCommand('function:load@src/a.ts', 'x', { path: root, expectPlan: 'p' }, fresh, io().io), CHECK_ERROR_EXIT_CODE);
  });
});
