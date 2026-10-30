import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Node as TSNode } from 'web-tree-sitter';
import { Language } from '../../../../src/shared/languages.js';
import { getLanguage, parseSource } from '../../../../src/parsing/parser-manager.js';
import { lowerFunctionToIr } from '../../../../src/program-analysis/languages/generic-lowering.js';
import { getLoweringTable } from '../../../../src/program-analysis/languages/lowering-tables.js';
import { buildFunctionCfg } from '../../../../src/program-analysis/cfg/build.js';
import { computeReachingDefinitions } from '../../../../src/program-analysis/dataflow/reaching-definitions.js';
import { computeDefUseChains } from '../../../../src/program-analysis/dataflow/def-use.js';
import { computeTaintFindings } from '../../../../src/program-analysis/taint/build.js';
import { builtinTaintModelSources, createTaintModelRegistry, frameworkContributionSources, type TaintModelRegistry } from '../../../../src/program-analysis/taint/model-registry.js';
import type { TaintFunctionContext } from '../../../../src/program-analysis/taint/matching.js';
import type { TaintModel } from '../../../../src/program-analysis/taint/model-schema.js';
import { expressFrameworkAdapter } from '../../../../src/frameworks/adapters/express.js';
import { springFrameworkAdapter } from '../../../../src/frameworks/adapters/spring.js';
import { pythonWebFrameworkAdapter } from '../../../../src/frameworks/adapters/python-web.js';
import { analyzeFunctionTaint } from '../../../../src/program-analysis/pipeline.js';

function findFirstOfType(node: TSNode, types: readonly string[]): TSNode | null {
  if (types.includes(node.type)) return node;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findFirstOfType(child, types);
    if (found) return found;
  }
  return null;
}

function registryOf(extra: TaintModel[] = []): TaintModelRegistry {
  const result = createTaintModelRegistry([
    ...builtinTaintModelSources(),
    ...frameworkContributionSources([
      ...expressFrameworkAdapter.taintModels!(),
      ...springFrameworkAdapter.taintModels!(),
      ...pythonWebFrameworkAdapter.taintModels!(),
    ]),
    ...extra.map((model) => ({ kind: 'project' as const, model })),
  ]);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.diagnostics));
  return result.registry;
}

async function analyze(language: Language, source: string, options: { registry?: TaintModelRegistry; parameterNames?: string[]; context?: TaintFunctionContext } = {}) {
  assert.ok(await getLanguage(language));
  const tree = await parseSource(language, source);
  assert.ok(tree);
  const table = getLoweringTable(language)!;
  const bodyNode = findFirstOfType(tree!.rootNode as unknown as TSNode, table.blockTypes);
  assert.ok(bodyNode);
  const ir = lowerFunctionToIr({ bodyNode: bodyNode!, language, functionId: 'sym:v2:function:test', filePath: '/src/sample', parameterNames: options.parameterNames });
  const cfg = buildFunctionCfg(ir);
  const reachingDefinitions = computeReachingDefinitions(ir, cfg);
  const defUse = computeDefUseChains(ir, cfg, reachingDefinitions);
  return computeTaintFindings({
    ir, cfg, reachingDefinitions, defUse,
    registry: options.registry ?? registryOf(),
    context: { parameterNames: options.parameterNames, ...options.context },
  });
}

describe('taint engine with declarative models', () => {
  it('flows from an express request input through a declaration and concatenation into a command sink', async () => {
    const result = await analyze(Language.TypeScript, `
function handler(req, res) {
  const name = req.body.name;
  const cmd = "ls " + name;
  child_process.exec(cmd);
}
`, { parameterNames: ['req', 'res'], context: { routeHandlerFrameworks: ['express'] } });
    assert.equal(result.findings.length, 1);
    const finding = result.findings[0]!;
    assert.equal(finding.sourceModelId, 'express-request-input');
    assert.equal(finding.sinkModelId, 'node-core');
    assert.equal(finding.sinkCategory, 'command');
    assert.equal(finding.sourceMatchStrength, 'syntactic');
    assert.equal(finding.certainty, 'heuristic');
    assert.ok(finding.propagationStatementIds.length >= 3);
  });

  it('reports framework-input matchers as unevaluated (not as absence) without route-handler context', async () => {
    const result = await analyze(Language.TypeScript, `
function handler(req, res) {
  const name = req.body.name;
  child_process.exec(name);
}
`, { parameterNames: ['req', 'res'] });
    assert.deepEqual(result.findings, []);
    assert.ok(result.unevaluatedMatcherRefs?.includes('express-request-input/request-input'));
  });

  it('detects a source passed directly as a sink argument', async () => {
    const result = await analyze(Language.TypeScript, `
function run() {
  child_process.execSync(process.argv[2]);
}
`);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.sourceMatcherId, 'process-argv');
  });

  it('applies category-specific sanitizers: shlex.quote cleans command sinks but not code sinks', async () => {
    const result = await analyze(Language.Python, `
def run():
    value = input()
    quoted = shlex.quote(value)
    os.system(quoted)
    eval(quoted)
`);
    assert.deepEqual(result.findings.map((finding) => finding.sinkMatcherId), ['builtin-eval']);
  });

  it('keeps an unsanitized reaching definition reportable next to a sanitized sibling path', async () => {
    const result = await analyze(Language.Python, `
def run(flag):
    value = input()
    if flag:
        value = shlex.quote(value)
    os.system(value)
`, { parameterNames: ['flag'] });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.sinkMatcherId, 'os-system');
    assert.equal(result.findings[0]!.sanitizedByStatementIds.length, 1);
  });

  it('flows Flask request proxies into a template-string sink', async () => {
    const result = await analyze(Language.Python, `
def view():
    template = request.args.get("t")
    return render_template_string(template)
`);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.sinkMatcherId, 'render-template-string');
    const direct = await analyze(Language.Python, `
def view():
    template = request.args.get("t")
    render_template_string(template)
`);
    assert.equal(direct.findings.length, 1);
    assert.equal(direct.findings[0]!.sourceModelId, 'flask-request-input');
  });

  it('uses Spring binding annotations from parameter context', async () => {
    const result = await analyze(Language.Java, `
class C {
  void handle(String q) {
    String cmd = q;
    Runtime.exec(cmd);
  }
}
`, {
      parameterNames: ['q'],
      context: { parameterAnnotations: { q: ['RequestParam'] } },
      registry: registryOf([{ schemaVersion: 1, id: 'test-java-sinks', version: '1', sources: [], sinks: [{ id: 'runtime-exec', kind: 'qualified-call', callee: 'Runtime.exec', category: 'command' }], sanitizers: [] }]),
    });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.sourceModelId, 'spring-request-input');
  });

  describe('false-positive controls', () => {
    it('does not treat an unrelated `.exec` method (regex) as a command sink', async () => {
      const result = await analyze(Language.TypeScript, `
function run() {
  const pattern = /a/;
  const input = process.argv[2];
  pattern.exec(input);
}
`);
      assert.deepEqual(result.findings, []);
    });

    it('does not treat a generic validate/sanitize-named helper as a sanitizer', async () => {
      const result = await analyze(Language.Python, `
def run():
    value = input()
    value = validate_input(value)
    os.system(value)
`);
      // validate_input is unmodeled: its result is neither a source nor sanitized — the engine does not guess either way.
      assert.deepEqual(result.findings, []);
      const direct = await analyze(Language.Python, `
def run():
    value = input()
    validate_input(value)
    os.system(value)
`);
      assert.equal(direct.findings.length, 1);
    });

    it('does not report a constant passed to a sink', async () => {
      const result = await analyze(Language.Python, `
def run():
    os.system("ls -la")
`);
      assert.deepEqual(result.findings, []);
    });
  });
});

describe('taint cache identity', () => {
  it('cannot reuse stale findings when only the model changes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taint-cache-'));
    const filePath = path.join(dir, 'app.ts');
    fs.writeFileSync(filePath, `function run() {
  const value = readSecret();
  sendOut(value);
}
`);
    const model = (callee: string): TaintModel => ({
      schemaVersion: 1, id: 'cache-test', version: '1',
      sources: [{ id: 'secret', kind: 'return-of', callee: 'readSecret' }],
      sinks: [{ id: 'out', kind: 'qualified-call', callee, category: 'other' }],
      sanitizers: [],
    });
    const request = (registry: TaintModelRegistry) => ({
      language: Language.TypeScript, filePath, startLine: 1, canonicalFunctionId: `sym:cache:${dir}`, resolverVersion: 'test', registry,
    });

    const first = await analyzeFunctionTaint(request(registryOf([model('sendOut')])));
    assert.equal(first.capability, 'supported');
    assert.equal(first.cacheHit, false);
    assert.equal(first.result?.findings.length, 1);

    const again = await analyzeFunctionTaint(request(registryOf([model('sendOut')])));
    assert.equal(again.cacheHit, true);

    const changed = await analyzeFunctionTaint(request(registryOf([model('sendElsewhere')])));
    assert.equal(changed.cacheHit, false);
    assert.deepEqual(changed.result?.findings, []);
    assert.notEqual(changed.result?.modelFingerprint, first.result?.modelFingerprint);
  });
});
