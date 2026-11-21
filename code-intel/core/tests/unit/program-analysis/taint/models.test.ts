import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTaintModel, DEFAULT_TAINT_MODEL_LIMITS, type TaintModel } from '../../../../src/program-analysis/taint/model-schema.js';
import {
  builtinTaintModelSources,
  createTaintModelRegistry,
  legacyRuleSetToModel,
  matchersForLanguage,
  type TaintModelSource,
} from '../../../../src/program-analysis/taint/model-registry.js';
import { loadProjectTaintModels, loadTaintModelRegistry, PROJECT_TAINT_MODELS_RELATIVE_PATH } from '../../../../src/program-analysis/taint/model-loader.js';
import { callArgumentTexts, calleePath, identifierReads, leadingAccessPath } from '../../../../src/program-analysis/taint/matching.js';
import { loadFrameworkAdapters } from '../../../../src/frameworks/registry.js';
import { Language } from '../../../../src/shared/languages.js';

const baseModel = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'company-input',
  version: '1',
  sources: [{ id: 'header', kind: 'field-read', path: 'ctx.headers' }],
  sinks: [{ id: 'shell', kind: 'qualified-call', callee: 'runner.shell', category: 'command' }],
  sanitizers: [],
  ...overrides,
});

function messages(raw: unknown): string[] {
  const result = validateTaintModel(raw, { origin: 'test' });
  return result.valid ? [] : result.diagnostics.map((item) => `${item.path}: ${item.message}`);
}

describe('taint model schema', () => {
  it('accepts a valid model and normalizes matcher order', () => {
    const result = validateTaintModel(baseModel({
      sinks: [
        { id: 'z-sink', kind: 'qualified-call', callee: 'z.run', category: 'command' },
        { id: 'a-sink', kind: 'literal-call-pattern', text: 'rawQuery(', category: 'sql' },
      ],
    }), { origin: 'test' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.valid && result.model.sinks.map((item) => item.id), ['a-sink', 'z-sink']);
  });

  it('rejects an unknown matcher kind with model/matcher diagnostics instead of ignoring it', () => {
    const result = validateTaintModel(baseModel({ sources: [{ id: 'mystery', kind: 'regex', pattern: '.*' }] }), { origin: 'test' });
    assert.equal(result.valid, false);
    const diagnostic = !result.valid ? result.diagnostics.find((item) => item.path.endsWith('.kind')) : undefined;
    assert.ok(diagnostic);
    assert.equal(diagnostic.modelId, 'company-input');
    assert.equal(diagnostic.matcherId, 'mystery');
    assert.match(diagnostic.message, /unknown matcher kind 'regex'/);
  });

  it('rejects unknown fields, regex/wildcard syntax and missing schema version', () => {
    assert.ok(messages(baseModel({ extra: true })).some((item) => item.includes("unknown field 'extra'")));
    assert.ok(messages(baseModel({ sources: [{ id: 's', kind: 'field-read', path: 'req.*' }] })).some((item) => item.includes('invalid characters')));
    assert.ok(messages(baseModel({ sinks: [{ id: 's', kind: 'qualified-call', callee: '(exec|spawn)', category: 'command' }] })).some((item) => item.includes('invalid characters')));
    assert.ok(messages(baseModel({ schemaVersion: 2 })).some((item) => item.includes('schemaVersion')));
    assert.ok(messages({ ...baseModel(), sources: [{ id: 's', kind: 'field-read', path: 'a', code: 'process.exit()' }] }).some((item) => item.includes("unknown field 'code'")));
  });

  it('enforces role/kind compatibility and category rules', () => {
    assert.ok(messages(baseModel({ sinks: [{ id: 'bad', kind: 'field-read', path: 'x.y', category: 'sql' }] })).some((item) => item.includes('cannot be used as a sink')));
    assert.ok(messages(baseModel({ sinks: [{ id: 'nocat', kind: 'qualified-call', callee: 'db.raw' }] })).some((item) => item.includes('category')));
    assert.ok(messages(baseModel({ sanitizers: [{ id: 'nocat', kind: 'qualified-call', callee: 'clean' }] })).some((item) => item.includes('never assumed to clean every class')));
    assert.ok(messages(baseModel({ sources: [{ id: 's', kind: 'field-read', path: 'a.b', category: 'sql' }] })).some((item) => item.includes('sources do not take')));
  });

  it('enforces size and count bounds', () => {
    const tooMany = Array.from({ length: DEFAULT_TAINT_MODEL_LIMITS.maxMatchersPerModel + 1 }, (_, index) => ({ id: `s${index}`, kind: 'field-read', path: `a.b${index}` }));
    assert.ok(messages(baseModel({ sources: tooMany })).some((item) => item.includes('maximum per model')));
    assert.ok(messages(baseModel({ sinks: [{ id: 'long', kind: 'literal-call-pattern', text: 'x'.repeat(DEFAULT_TAINT_MODEL_LIMITS.maxTextLength + 1), category: 'sql' }] })).some((item) => item.includes('maximum length')));
    assert.ok(messages(baseModel({ id: 'a'.repeat(DEFAULT_TAINT_MODEL_LIMITS.maxIdLength + 1) })).some((item) => item.includes('maximum length')));
  });

  it('rejects duplicate matcher ids within a model', () => {
    assert.ok(messages(baseModel({ sinks: [{ id: 'header', kind: 'qualified-call', callee: 'a.b', category: 'sql' }] })).some((item) => item.includes("duplicate matcher id 'header'")));
  });
});

describe('taint model registry', () => {
  const project = (model: Record<string, unknown>): TaintModelSource => ({ kind: 'project', model: model as unknown as TaintModel, sourcePath: PROJECT_TAINT_MODELS_RELATIVE_PATH });

  it('merges deterministically regardless of input order', () => {
    const a = project(baseModel({ id: 'a-model' }));
    const b = project(baseModel({ id: 'b-model' }));
    const first = createTaintModelRegistry([...builtinTaintModelSources(), b, a]);
    const second = createTaintModelRegistry([a, ...builtinTaintModelSources().reverse(), b]);
    assert.ok(first.ok && second.ok);
    assert.equal(first.registry.fingerprint, second.registry.fingerprint);
    assert.deepEqual(first.registry.matchers.map((item) => `${item.modelId}/${item.matcher.id}`), second.registry.matchers.map((item) => `${item.modelId}/${item.matcher.id}`));
    assert.equal(first.registry.models.at(-1)?.id, 'b-model');
  });

  it('fails on duplicate ids with different content and never lets a project model replace a built-in', () => {
    const conflicting = createTaintModelRegistry([project(baseModel()), project(baseModel({ version: '2' }))]);
    assert.equal(conflicting.ok, false);
    const shadowing = createTaintModelRegistry([...builtinTaintModelSources(), project(baseModel({ id: 'node-core' }))]);
    assert.equal(shadowing.ok, false);
    assert.match(!shadowing.ok ? shadowing.diagnostics[0]!.message : '', /cannot replace built-in/);
    const identical = createTaintModelRegistry([project(baseModel()), project(baseModel())]);
    assert.equal(identical.ok, true);
  });

  it('changes the fingerprint when a model or an adapter version changes', () => {
    const one = createTaintModelRegistry([project(baseModel())]);
    const two = createTaintModelRegistry([project(baseModel({ sinks: [{ id: 'shell', kind: 'qualified-call', callee: 'runner.exec', category: 'command' }] }))]);
    assert.ok(one.ok && two.ok);
    assert.notEqual(one.registry.fingerprint, two.registry.fingerprint);

    const adapter = (adapterVersion: string): TaintModelSource => ({ kind: 'framework-adapter', adapterId: 'x', adapterVersion, model: baseModel({ id: 'x-input' }) as unknown as TaintModel });
    const v1 = createTaintModelRegistry([adapter('1.0.0')]);
    const v2 = createTaintModelRegistry([adapter('1.1.0')]);
    assert.ok(v1.ok && v2.ok);
    assert.notEqual(v1.registry.fingerprint, v2.registry.fingerprint);
  });

  it('adapts legacy text rules as explicit text-fallback matchers that clean every category', () => {
    const model = legacyRuleSetToModel({ version: 'rules v1', sources: [{ id: 'in', textPattern: 'getInput(' }], sinks: [{ id: 'out', textPattern: 'run(' }], sanitizers: [{ id: 'clean', textPattern: 'clean(' }] });
    assert.equal(model.id, 'legacy-rules-v1');
    assert.equal(model.sources[0]?.kind, 'literal-call-pattern');
    assert.deepEqual(model.sanitizers[0]?.categories, ['*']);
    assert.equal(validateTaintModel(model, { origin: 'legacy' }).valid, true);
  });

  it('scopes matchers by model language', () => {
    const result = createTaintModelRegistry(builtinTaintModelSources());
    assert.ok(result.ok);
    const python = matchersForLanguage(result.registry, Language.Python).map((item) => item.modelId);
    assert.ok(python.includes('python-stdlib'));
    assert.ok(!python.includes('node-core'));
  });

  it('validates every built-in and framework adapter contribution', async () => {
    const adapters = await loadFrameworkAdapters();
    const contributions = adapters.flatMap((adapter) => [...(adapter.taintModels?.() ?? [])]);
    assert.ok(contributions.length >= 6);
    for (const contribution of contributions) {
      const adapter = adapters.find((item) => item.id === contribution.adapterId);
      assert.equal(contribution.adapterVersion, adapter?.version);
      assert.equal(validateTaintModel(contribution.model, { origin: contribution.adapterId }).valid, true, contribution.model.id);
    }
    const loaded = await loadTaintModelRegistry(fs.mkdtempSync(path.join(os.tmpdir(), 'taint-none-')), { frameworkContributions: contributions });
    assert.ok(loaded.registry);
    assert.ok(loaded.registry.models.some((model) => model.origin.startsWith('framework-adapter:express@')));
  });
});

describe('project taint model loader', () => {
  function repoWith(content?: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taint-models-'));
    if (content !== undefined) {
      fs.mkdirSync(path.join(dir, '.code-intel'), { recursive: true });
      fs.writeFileSync(path.join(dir, PROJECT_TAINT_MODELS_RELATIVE_PATH), content);
    }
    return dir;
  }

  it('reports absent, loaded and invalid states', async () => {
    assert.equal(loadProjectTaintModels(repoWith()).status, 'absent');
    const loaded = await loadTaintModelRegistry(repoWith(JSON.stringify({ schemaVersion: 1, models: [baseModel()] })), { frameworkContributions: [] });
    assert.equal(loaded.projectModels.status, 'loaded');
    assert.ok(loaded.registry?.models.some((model) => model.origin === `project:${PROJECT_TAINT_MODELS_RELATIVE_PATH}`));

    const badJson = loadProjectTaintModels(repoWith('{ not json'));
    assert.equal(badJson.status, 'invalid');
    assert.match(badJson.diagnostics[0]!.message, /not valid JSON/);
  });

  it('does not silently fall back to built-ins when a project model is invalid', async () => {
    const loaded = await loadTaintModelRegistry(repoWith(JSON.stringify({ schemaVersion: 1, models: [baseModel({ sinks: [{ id: 'x', kind: 'nope' }] })] })), { frameworkContributions: [] });
    assert.equal(loaded.registry, undefined);
    assert.equal(loaded.projectModels.status, 'invalid');
    assert.ok(loaded.diagnostics.some((item) => item.matcherId === 'x' && /unknown matcher kind/.test(item.message)));
  });

  it('enforces file size, model count, and repository containment', () => {
    const oversized = loadProjectTaintModels(repoWith(' '.repeat(DEFAULT_TAINT_MODEL_LIMITS.maxFileBytes + 1)));
    assert.equal(oversized.status, 'invalid');
    const tooMany = loadProjectTaintModels(repoWith(JSON.stringify({ schemaVersion: 1, models: Array.from({ length: DEFAULT_TAINT_MODEL_LIMITS.maxModels + 1 }, () => ({})) })));
    assert.match(tooMany.diagnostics[0]!.message, /maximum is/);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'taint-outside-'));
    fs.writeFileSync(path.join(outside, 'models.json'), JSON.stringify({ schemaVersion: 1, models: [baseModel()] }));
    const repo = repoWith();
    fs.mkdirSync(path.join(repo, '.code-intel'));
    fs.symlinkSync(path.join(outside, 'models.json'), path.join(repo, PROJECT_TAINT_MODELS_RELATIVE_PATH));
    const escaped = loadProjectTaintModels(repo);
    assert.equal(escaped.status, 'invalid');
    assert.match(escaped.diagnostics[0]!.message, /outside the repository/);
  });
});

describe('taint matcher text helpers', () => {
  it('extracts callee and access paths at segment boundaries', () => {
    assert.equal(calleePath('await db.query(sql, x)'), 'db.query');
    assert.equal(calleePath('client?.fetch<User>(url)'), 'client.fetch');
    assert.equal(calleePath('req.body.name'), undefined);
    assert.equal(leadingAccessPath("os.environ['HOME']"), 'os.environ');
    assert.equal(leadingAccessPath('request.args.get("q")'), 'request.args.get');
  });

  it('splits top-level call arguments and refuses incomplete calls', () => {
    assert.deepEqual(callArgumentTexts('f(a, g(b, c), "x,y")'), ['a', 'g(b, c)', '"x,y"']);
    assert.deepEqual(callArgumentTexts('f()'), []);
    assert.equal(callArgumentTexts('f(a, b'), undefined);
  });

  it('strips string literals in linear time, including unterminated escape runs', () => {
    assert.deepEqual(identifierReads('a + "b\\"c" + d'), ['a', 'd']);
    const started = Date.now();
    identifierReads(`"${'\\'.repeat(2047)}`);
    assert.ok(Date.now() - started < 500);
  });
});
