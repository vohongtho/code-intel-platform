#!/usr/bin/env node
/**
 * Paired benchmark: existing multi-tool agent workflow vs a single `explore` call.
 *
 * BASELINE  search -> inspect (top seeds) -> context   (what clients do today)
 * EXPLORE   explore (one call, same hard token cap as the baseline context call)
 *
 * Both run in-process through the real MCP dispatcher (`dispatchTool`) against
 * the same published index of a deterministic synthetic repository, so the
 * only variable is the workflow. Delivered tokens = estimated tokens of every
 * tool output the agent would have to read.
 *
 * Gates (openspec v1-0-12-adaptive-agent-exploration):
 *   - median delivered-token reduction  >= 25%
 *   - correctness regression            <= 2 percentage points
 *
 * Usage:
 *   node eval/run-explore-bench.mjs [--json] [--no-gate]
 *   node eval/run-agent-bench.mjs --explore
 *
 * Requires `npm --prefix code-intel/core run build` is NOT needed; this uses
 * the compiled test tree: `cd code-intel/core && npx tsc -b tsconfig.test.json`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'code-intel', 'core', 'dist-tests', 'src');
const RESULTS_DIR = path.join(__dirname, 'results');
const jsonOut = process.argv.includes('--json');
const gateEnabled = !process.argv.includes('--no-gate');

const load = (rel) => import(path.join(DIST, rel));
const [{ createKnowledgeGraph }, { DbManager }, { loadGraphToDB }, { saveMetadata }, { Bm25Index, getBm25DbPath }, { CURRENT_SCHEMA_VERSION }, { dispatchTool }, { estimateTokens }] = await Promise.all([
  load('graph/knowledge-graph.js'),
  load('storage/db-manager.js'),
  load('storage/graph-loader.js'),
  load('storage/metadata.js'),
  load('search/bm25-index.js'),
  load('migrations/migration-runner.js'),
  load('mcp-server/server.js'),
  load('context/token-counter.js'),
]);

// ── Deterministic synthetic repository ───────────────────────────────────────
// Fixture and render policy were fixed before the first measurement on this fixture
// (2026-10-01) and are not tuned afterwards: two modules, two orchestrators, twelve handlers
// with three body shapes, routes and one test per handler.
const MODULES = [
  { dir: 'orders', orchestrator: 'processOrder', steps: ['validateOrder', 'reserveStock', 'chargePayment', 'scheduleShipment', 'notifyCustomer', 'recordAudit'], route: 'POST /orders' },
  { dir: 'billing', orchestrator: 'settleInvoice', steps: ['loadInvoice', 'applyCredit', 'calculateTax', 'postLedger', 'issueReceipt', 'archiveInvoice'], route: 'POST /invoices' },
];

function handlerBody(name, shape) {
  const normalize = Array.from({ length: 10 + shape * 3 }, (_, i) => `  const ${name}Part${i} = normalize(input.items[${i % 3}], ${i}) + offset${i};`);
  const guard = shape === 0 ? [`  if (!input.id) {`, `    throw new Error('${name} rejected input');`, `  }`] : [];
  const call = shape === 1
    ? [`  let outcome;`, `  try {`, `    outcome = await gateway.${name}Call(input);`, `  } catch (err) {`, `    metrics.count('${name}.error');`, `    throw err;`, `  }`]
    : [`  const outcome = await gateway.${name}Call(input);`];
  return [
    `export async function ${name}(input: OrderInput): Promise<StepResult> {`,
    ...normalize, ...guard,
    `  logger.info('${name}', input.id);`,
    ...call,
    `  if (!outcome.ok) {`,
    `    throw new Error('${name} failed');`,
    `  }`,
    `  return finishStep('${name}', outcome);`,
    `}`,
  ].join('\n');
}

function orchestratorBody(module) {
  const calls = module.steps.map((step) => `  await ${step}(input);`).join('\n');
  return `export async function ${module.orchestrator}(input: OrderInput): Promise<OrderResult> {\n  const startedAt = Date.now();\n${calls}\n  return summarize${module.orchestrator}(input, startedAt);\n}`;
}

function buildGraph() {
  const graph = createKnowledgeGraph();
  for (const module of MODULES) {
    graph.addNode({ id: module.orchestrator, kind: 'function', name: module.orchestrator, filePath: `src/${module.dir}/${module.orchestrator}.ts`, startLine: 1, exported: true, content: orchestratorBody(module) });
    module.steps.forEach((name, index) => {
      graph.addNode({ id: name, kind: 'function', name, filePath: `src/${module.dir}/steps/${name}.ts`, startLine: 1, exported: true, content: handlerBody(name, index % 3) });
      graph.addEdge({ id: `${module.orchestrator}-${name}`, source: module.orchestrator, target: name, kind: 'calls', certainty: 'exact' });
      graph.addNode({ id: `${name}Test`, kind: 'function', name: `${name}Test`, filePath: `tests/${module.dir}/${name}.test.ts`, startLine: 1, content: `it('${name}', async () => { await ${name}(fixture${index}); });` });
      graph.addEdge({ id: `t-${name}`, source: `${name}Test`, target: name, kind: 'calls', certainty: 'exact' });
    });
    graph.addNode({ id: `${module.dir}Route`, kind: 'route', name: module.route, filePath: `src/routes/${module.dir}.ts`, startLine: 1, content: `router.post('/${module.dir}', ${module.orchestrator});` });
    graph.addEdge({ id: `${module.dir}-handles`, source: `${module.dir}Route`, target: module.orchestrator, kind: 'handles' });
  }
  return graph;
}

// Ground truth is body-level and derived from the task wording, not from any tool output:
// call/throw statements inside the symbols the task names. Symbol-name-only checks cannot tell
// a truncated one-line body from real source, so they would hide the cost of missing code.
const CASES = [
  { id: 'understand-order-flow', intent: 'understand', task: 'how does processOrder reach chargePayment and scheduleShipment', symbols: ['processOrder', 'chargePayment', 'scheduleShipment'],
    groundTruth: ['await chargePayment(input)', 'await scheduleShipment(input)', 'gateway.chargePaymentCall', 'gateway.scheduleShipmentCall'] },
  { id: 'change-add-step', intent: 'change', task: 'what must change to add a step to processOrder after reserveStock', symbols: ['processOrder', 'reserveStock', 'chargePayment'],
    groundTruth: ['await reserveStock(input)', 'await chargePayment(input)', 'summarizeprocessOrder(input, startedAt)', 'gateway.reserveStockCall'] },
  { id: 'debug-charge', intent: 'debug', task: 'why does chargePayment fail inside processOrder', symbols: ['chargePayment', 'processOrder', 'validateOrder'],
    groundTruth: ["throw new Error('chargePayment failed')", 'gateway.chargePaymentCall', 'await chargePayment(input)'] },
  { id: 'review-notify', intent: 'review', task: 'review changes to notifyCustomer and recordAudit in processOrder', symbols: ['notifyCustomer', 'recordAudit', 'processOrder'],
    groundTruth: ["throw new Error('notifyCustomer failed')", "throw new Error('recordAudit failed')", 'gateway.notifyCustomerCall', 'gateway.recordAuditCall'] },
  { id: 'understand-billing', intent: 'understand', task: 'how does settleInvoice reach applyCredit and issueReceipt', symbols: ['settleInvoice', 'applyCredit', 'issueReceipt'],
    groundTruth: ['await applyCredit(input)', 'await issueReceipt(input)', 'gateway.applyCreditCall', 'gateway.issueReceiptCall'] },
  { id: 'debug-ledger', intent: 'debug', task: 'why does postLedger fail inside settleInvoice', symbols: ['postLedger', 'settleInvoice', 'calculateTax'],
    groundTruth: ["throw new Error('postLedger failed')", 'gateway.postLedgerCall', 'await postLedger(input)'] },
];

const MAX_TOKENS = 6000;
const RUNS = 5;

async function publishWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-bench-'));
  fs.mkdirSync(path.join(workspace, '.code-intel'), { recursive: true });
  const graph = buildGraph();
  // The graph store keeps only a 1000-char prefix of each body, so also write the real
  // sources to the workspace: Explore re-reads full bodies from there (drift-checked).
  for (const node of graph.allNodes()) {
    if (!node.content || !node.filePath) continue;
    node.endLine = node.content.split('\n').length;
    fs.mkdirSync(path.dirname(path.join(workspace, node.filePath)), { recursive: true });
    fs.writeFileSync(path.join(workspace, node.filePath), node.content);
  }
  const db = new DbManager(path.join(workspace, '.code-intel', 'graph.db'));
  await db.init();
  await loadGraphToDB(graph, db);
  db.close();
  saveMetadata(workspace, {
    indexedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    indexVersion: `explore-bench-${Date.now()}`,
    stats: { nodes: graph.size.nodes, edges: graph.size.edges, files: 30, duration: 0 },
  });
  new Bm25Index(getBm25DbPath(workspace)).build(graph);
  return workspace;
}

const call = async (workspace, tool, args) => {
  const started = performance.now();
  const result = await dispatchTool(tool, args, createKnowledgeGraph(), 'explore-bench', workspace);
  const text = result.content[0]?.text ?? '';
  return { text, tokens: estimateTokens(text), ms: performance.now() - started, error: result.isError === true };
};

function correctness(text, groundTruth) {
  // Tool outputs are JSON, so quotes inside source appear escaped; compare on the decoded form too.
  const haystacks = [text.toLowerCase(), text.replace(/\\"/g, '"').replace(/\\n/g, '\n').toLowerCase()];
  const hits = groundTruth.filter((term) => haystacks.some((h) => h.includes(term.toLowerCase()))).length;
  return Math.round((hits / groundTruth.length) * 100);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Today's tool sequence only: search -> inspect (top 3) -> context. */
async function runToolsOnly(workspace, testCase) {
  const outputs = [];
  outputs.push(await call(workspace, 'search', { query: testCase.task, limit: 10 }));
  for (const symbol of testCase.symbols.slice(0, 3)) {
    outputs.push(await call(workspace, 'inspect', { symbol_name: symbol }));
  }
  outputs.push(await call(workspace, 'context', { symbols: testCase.symbols, task: testCase.task, max_tokens: MAX_TOKENS }));
  return summarize(outputs);
}

/** Tools plus reading the seed source files: what an agent does when the tool output lacks the bodies. */
async function runToolsPlusReads(workspace, testCase, nodesByName) {
  const outputs = [...(await runToolsOnly(workspace, testCase)).outputs];
  for (const symbol of testCase.symbols) {
    const file = nodesByName.get(symbol);
    const text = fs.readFileSync(path.join(workspace, file), 'utf8');
    outputs.push({ text, tokens: estimateTokens(text), error: false });
  }
  return summarize(outputs);
}

function summarize(outputs) {
  return {
    outputs,
    steps: outputs.length,
    tokens: outputs.reduce((s, o) => s + o.tokens, 0),
    text: outputs.map((o) => o.text).join('\n'),
    errors: outputs.filter((o) => o.error).length,
  };
}

async function runExplore(workspace, testCase) {
  const result = await call(workspace, 'explore', { task: testCase.task, intent: testCase.intent, max_tokens: MAX_TOKENS });
  let parsed = {};
  try { parsed = JSON.parse(result.text); } catch { /* error text */ }
  return { steps: 1, tokens: result.tokens, text: result.text, errors: result.error ? 1 : 0, parsed };
}

const { getSkeletonCapabilityMatrix } = await load('context/skeletonizer.js');
const workspace = await publishWorkspace();
const nodesByName = new Map([...buildGraph().allNodes()].map((node) => [node.name, node.filePath]));
const rows = [];
try {
  for (const testCase of CASES) {
    const toolsOnly = await runToolsOnly(workspace, testCase);
    const withReads = await runToolsPlusReads(workspace, testCase, nodesByName);
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await runExplore(workspace, testCase));
    const explore = runs[0];
    const counters = explore.parsed.counters ?? {};
    const durations = runs.map((r) => r.parsed.durationsMs ?? {});
    const arm = (a) => ({ steps: a.steps, tokens: a.tokens, correctnessPct: correctness(a.text, testCase.groundTruth), errors: a.errors });
    rows.push({
      id: testCase.id,
      intent: testCase.intent,
      toolsOnly: arm(toolsOnly),
      baseline: arm(withReads),
      explore: {
        ...arm(explore),
        renderModes: counters.renderModes,
        skeletonFallbacks: counters.skeletonFallbacks,
        hydratedNodes: counters.hydratedNodes,
        omissions: counters.omissions,
        graphLookups: counters.graphLookups,
        degraded: explore.parsed.capabilities?.degraded,
        medianRerankMs: median(durations.map((d) => d.rerank ?? 0)),
        medianRenderMs: median(durations.map((d) => d.render ?? 0)),
        medianTotalMs: median(durations.map((d) => d.total ?? 0)),
      },
      tokenReductionPct: Math.round(((withReads.tokens - explore.tokens) / withReads.tokens) * 100),
      tokenReductionVsToolsOnlyPct: Math.round(((toolsOnly.tokens - explore.tokens) / toolsOnly.tokens) * 100),
    });
  }
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

// The gate compares Explore with the arm that reaches the same information (tools + reads); the
// tools-only arm is reported alongside because it is cheaper only by omitting the code.
const medianReduction = median(rows.map((r) => r.tokenReductionPct));
const avg = (pick) => rows.reduce((s, r) => s + pick(r), 0) / rows.length;
const baseCorrectness = avg((r) => r.baseline.correctnessPct);
const exploreCorrectness = avg((r) => r.explore.correctnessPct);
const toolsOnlyCorrectness = avg((r) => r.toolsOnly.correctnessPct);
const regressionPp = Math.round((baseCorrectness - exploreCorrectness) * 10) / 10;
const anyErrors = rows.some((r) => r.toolsOnly.errors > 0 || r.baseline.errors > 0 || r.explore.errors > 0);
const gates = {
  medianTokenReductionPct: { value: medianReduction, threshold: 25, pass: medianReduction >= 25 },
  correctnessRegressionPp: { value: regressionPp, threshold: 2, pass: regressionPp <= 2 },
  noToolErrors: { value: anyErrors ? 'errors' : 'none', pass: !anyErrors },
};
const pass = Object.values(gates).every((g) => g.pass);

const col = (value, width) => String(value).padEnd(width);
console.log('\n  Explore benchmark — tools-only vs tools+reads vs explore (correctness is body-level)\n');
console.log('  ' + col('case', 18) + col('tools tok', 11) + col('tools ok%', 11) + col('reads tok', 11) + col('reads ok%', 11) + col('exp tok', 9) + col('exp ok%', 9) + col('vs reads', 10) + 'modes');
for (const r of rows) {
  console.log('  ' + col(r.id, 18) + col(r.toolsOnly.tokens, 11) + col(r.toolsOnly.correctnessPct, 11) + col(r.baseline.tokens, 11) + col(r.baseline.correctnessPct, 11) + col(r.explore.tokens, 9) + col(r.explore.correctnessPct, 9) + col(`${r.tokenReductionPct}%`, 10) + JSON.stringify(r.explore.renderModes));
}
console.log(`\n  gate baseline = tools+reads (same information as explore). tools-only reaches ${Math.round(toolsOnlyCorrectness)}% body-level correctness; median reduction vs tools-only: ${median(rows.map((r) => r.tokenReductionVsToolsOnlyPct))}%`);
console.log(`  median token reduction: ${medianReduction}% (gate >= 25%) ${gates.medianTokenReductionPct.pass ? 'PASS' : 'FAIL'}`);
console.log(`  correctness regression: ${regressionPp}pp (gate <= 2pp) ${gates.correctnessRegressionPp.pass ? 'PASS' : 'FAIL'}`);
console.log(`  tool errors: ${gates.noToolErrors.value} ${gates.noToolErrors.pass ? 'PASS' : 'FAIL'}\n`);

if (jsonOut) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const summary = { benchmark: 'explore-paired', maxTokens: MAX_TOKENS, runs: RUNS, gateBaseline: 'tools+reads', toolsOnlyCorrectnessPct: Math.round(toolsOnlyCorrectness), medianReductionVsToolsOnlyPct: median(rows.map((r) => r.tokenReductionVsToolsOnlyPct)), gates, pass, skeletonCapabilityMatrix: getSkeletonCapabilityMatrix(), rows };
  fs.writeFileSync(path.join(RESULTS_DIR, 'explore-bench-latest.json'), JSON.stringify(summary, null, 2));
  console.log(`  Results: ${path.join(RESULTS_DIR, 'explore-bench-latest.json')}\n`);
}

if (gateEnabled && !pass) process.exitCode = 1;
