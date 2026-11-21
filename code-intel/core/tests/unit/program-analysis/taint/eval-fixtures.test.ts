/**
 * Taint true/false-positive fixtures across languages, scored as a set:
 * every expected (source matcher -> sink matcher) pair must be found and
 * nothing else may be reported.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Node as TSNode } from 'web-tree-sitter';
import { Language } from '../../../../src/shared/languages.js';
import { getLanguage, parseSource } from '../../../../src/parsing/parser-manager.js';
import { lowerFunctionToIr } from '../../../../src/program-analysis/languages/generic-lowering.js';
import { getLoweringTable } from '../../../../src/program-analysis/languages/lowering-tables.js';
import { buildFunctionCfg } from '../../../../src/program-analysis/cfg/build.js';
import { computeReachingDefinitions } from '../../../../src/program-analysis/dataflow/reaching-definitions.js';
import { computeDefUseChains } from '../../../../src/program-analysis/dataflow/def-use.js';
import { computeTaintFindings } from '../../../../src/program-analysis/taint/build.js';
import { builtinTaintModelSources, createTaintModelRegistry, frameworkContributionSources } from '../../../../src/program-analysis/taint/model-registry.js';
import { expressFrameworkAdapter } from '../../../../src/frameworks/adapters/express.js';
import { pythonWebFrameworkAdapter } from '../../../../src/frameworks/adapters/python-web.js';
import { goHttpFrameworkAdapter } from '../../../../src/frameworks/adapters/go-http.js';
import type { TaintFunctionContext } from '../../../../src/program-analysis/taint/matching.js';

interface Fixture {
  name: string;
  language: Language;
  source: string;
  params?: string[];
  context?: TaintFunctionContext;
  expected: string[];
}

const FIXTURES: Fixture[] = [
  { name: 'ts: argv into execSync', language: Language.TypeScript, source: `function f() {\n  const a = process.argv[2];\n  child_process.execSync(a);\n}`, expected: ['process-argv->child-process-exec-sync'] },
  { name: 'ts: express body via concatenation into exec', language: Language.TypeScript, params: ['req', 'res'], context: { routeHandlerFrameworks: ['express'] }, source: `function f(req, res) {\n  const id = req.params.id;\n  const cmd = "cat " + id;\n  child_process.exec(cmd);\n}`, expected: ['request-input->child-process-exec'] },
  { name: 'ts: path.basename sanitizes path sink', language: Language.TypeScript, source: `function f() {\n  const p = process.argv[2];\n  const safe = path.basename(p);\n  fs.readFileSync(safe);\n}`, expected: [] },
  { name: 'ts: path.basename does not clean a command sink', language: Language.TypeScript, source: `function f() {\n  const p = process.argv[2];\n  const name = path.basename(p);\n  child_process.execSync(name);\n}`, expected: ['process-argv->child-process-exec-sync'] },
  { name: 'ts: regex exec is not a command sink', language: Language.TypeScript, source: `function f() {\n  const p = process.argv[2];\n  const re = /x/;\n  re.exec(p);\n}`, expected: [] },
  { name: 'ts: express input outside a route handler is not a source', language: Language.TypeScript, params: ['req'], context: { routeHandlerFrameworks: [] }, source: `function f(req) {\n  const id = req.body.id;\n  child_process.exec(id);\n}`, expected: [] },
  { name: 'py: input into os.system', language: Language.Python, source: `def f():\n    v = input()\n    os.system(v)\n`, expected: ['builtin-input->os-system'] },
  { name: 'py: shlex.quote sanitizes command', language: Language.Python, source: `def f():\n    v = input()\n    q = shlex.quote(v)\n    subprocess.run(q)\n`, expected: [] },
  { name: 'py: flask args into pickle.loads', language: Language.Python, source: `def f():\n    data = request.args.get("d")\n    pickle.loads(data)\n`, expected: ['request-args->pickle-loads'] },
  { name: 'py: html.escape does not clean a code sink', language: Language.Python, source: `def f():\n    v = input()\n    e = html.escape(v)\n    eval(e)\n`, expected: ['builtin-input->builtin-eval'] },
  { name: 'py: unrelated variable reaches the sink', language: Language.Python, source: `def f():\n    v = input()\n    w = "ls"\n    os.system(w)\n`, expected: [] },
  { name: 'go: argv into exec.Command', language: Language.Go, source: `package main\nfunc f() {\n\targ := os.Args[1]\n\texec.Command(arg)\n}`, expected: ['os-args->exec-command'] },
  { name: 'go: http request form value into exec.Command', language: Language.Go, params: ['w', 'r'], context: { routeHandlerFrameworks: ['go-http'] }, source: `package main\nfunc f(w http.ResponseWriter, r *http.Request) {\n\tname := r.FormValue("n")\n\texec.Command(name)\n}`, expected: ['request-input->exec-command'] },
  { name: 'go: filepath.Base does not clean a command sink', language: Language.Go, source: `package main\nfunc f() {\n\targ := os.Args[1]\n\tbase := filepath.Base(arg)\n\texec.Command(base)\n}`, expected: ['os-args->exec-command'] },
];

function findFirstOfType(node: TSNode, types: readonly string[]): TSNode | null {
  if (types.includes(node.type)) return node;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findFirstOfType(child, types);
    if (found) return found;
  }
  return null;
}

const registry = (() => {
  const result = createTaintModelRegistry([
    ...builtinTaintModelSources(),
    ...frameworkContributionSources([...expressFrameworkAdapter.taintModels!(), ...pythonWebFrameworkAdapter.taintModels!(), ...goHttpFrameworkAdapter.taintModels!()]),
  ]);
  assert.ok(result.ok);
  return result.registry;
})();

describe('taint true/false-positive fixtures', () => {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const fixture of FIXTURES) {
    it(fixture.name, async () => {
      assert.ok(await getLanguage(fixture.language));
      const tree = await parseSource(fixture.language, fixture.source);
      const table = getLoweringTable(fixture.language)!;
      const body = findFirstOfType(tree!.rootNode as unknown as TSNode, table.blockTypes)!;
      const ir = lowerFunctionToIr({ bodyNode: body, language: fixture.language, functionId: fixture.name, filePath: '/f', parameterNames: fixture.params });
      const cfg = buildFunctionCfg(ir);
      const reachingDefinitions = computeReachingDefinitions(ir, cfg);
      const result = computeTaintFindings({ ir, cfg, reachingDefinitions, defUse: computeDefUseChains(ir, cfg, reachingDefinitions), registry, context: { parameterNames: fixture.params ?? [], ...fixture.context } });
      const found = [...new Set(result.findings.map((finding) => `${finding.sourceMatcherId}->${finding.sinkMatcherId}`))].sort();
      for (const pair of fixture.expected) if (found.includes(pair)) truePositives += 1; else falseNegatives += 1;
      for (const pair of found) if (!fixture.expected.includes(pair)) falsePositives += 1;
      assert.deepEqual(found, [...fixture.expected].sort());
    });
  }

  it('scores full precision and recall over the fixture set', () => {
    assert.equal(falsePositives, 0);
    assert.equal(falseNegatives, 0);
    assert.ok(truePositives >= 8);
  });
});
