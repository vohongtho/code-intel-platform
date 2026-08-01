import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = (message) => { throw new Error(`[guide-verify] ${message}`); };
const assert = (value, message) => { if (!value) fail(message); };

const pkg = JSON.parse(read('code-intel/core/package.json'));
const cli = read('code-intel/core/src/cli/app.ts');
const standalone = read('code-intel/core/src/cli/standalone-commands.ts');
const mcp = read('code-intel/core/src/mcp-server/server.ts');
const runtime = read('guide/verify-runtime.mjs');
const entry = read('guide/v109.html');
const backlog = read('guide/verification-backlog.md');

const context = vm.createContext({ window: { CODE_INTEL_VERIFIED_PAGES: [] } });
vm.runInContext(read('guide/verified-content.js'), context, { filename: 'verified-content.js' });
const pages = context.window.CODE_INTEL_VERIFIED_PAGES;
const guideText = pages.map((page) => `${page.title}\n${page.markdown}`).join('\n');

assert(pkg.name === '@vohongtho.infotech/code-intel', `unexpected package: ${pkg.name}`);
assert(pkg.version === '1.0.9', `unexpected version: ${pkg.version}`);
assert(pages.length === 6, `expected 6 verified pages, found ${pages.length}`);
assert(new Set(pages.map((page) => page.slug)).size === pages.length, 'duplicate guide slug');
assert(entry.includes('verified-content.js'), 'entrypoint does not load verified content');
assert(entry.includes('verified-loader.js'), 'entrypoint does not load verified loader');
assert(!entry.includes('audited-content-') && !entry.includes('audited-loader.js'), 'entrypoint still loads non-certified guide content');
assert(guideText.includes('65 / 65 checks passed'), 'runtime result missing');
assert(guideText.includes('29 CLI happy paths'), 'CLI runtime count missing');
assert(guideText.includes('31 / 31 MCP tools'), 'MCP runtime count missing');

const certifiedCli = [
  'code-intel --version',
  'code-intel init --yes',
  'code-intel config validate',
  'code-intel completion bash',
  'code-intel analyze /absolute/path/to/repository',
  'code-intel status /absolute/path/to/repository',
  'code-intel index-status /absolute/path/to/repository',
  'code-intel repo list',
  'code-intel repo show my-repository',
  'code-intel search "Calculator"',
  'code-intel inspect Calculator',
  'code-intel impact add',
  'code-intel context Calculator',
  'code-intel query "FIND function LIMIT 10"',
  'code-intel health /absolute/path/to/repository',
  'code-intel complexity /absolute/path/to/repository',
  'code-intel coverage /absolute/path/to/repository',
  'code-intel secrets /absolute/path/to/repository',
  'code-intel scan /absolute/path/to/repository',
  'code-intel deprecated /absolute/path/to/repository',
  'code-intel clean /absolute/path/to/repository --dry-run',
  'code-intel group create runtime-group',
  'code-intel group add',
  'code-intel group sync runtime-group',
  'code-intel group status runtime-group',
  'code-intel group contracts runtime-group',
  'code-intel group query runtime-group "Calculator"',
  'code-intel change-context',
  'code-intel serve /absolute/path/to/repository --port 4789',
  'code-intel mcp /absolute/path/to/repository',
];
for (const command of certifiedCli) {
  assert(guideText.includes(command), `certified command missing from guide: ${command}`);
}

const forbiddenGuideText = [
  'code-intel setup',
  'code-intel watch',
  'code-intel stop',
  'repo rename',
  'repo relink',
  'backup restore',
  'auth login',
  'keystore set',
  'change-context-mcp',
  'change-context-http',
  'group init-workspace',
  'code-intel update',
  'code-intel doctor',
  'Claude Code',
  'Codex',
  'OpenSpec',
  'Registered but not runtime-certified',
];
for (const text of forbiddenGuideText) {
  assert(!guideText.includes(text), `non-certified instruction leaked into public guide: ${text}`);
}
for (const text of [
  'code-intel setup', 'code-intel watch', 'code-intel stop', 'repo rename', 'repo relink',
  'backup restore', 'auth login', 'keystore set', 'change-context-mcp',
  'change-context-http', 'group init-workspace', 'code-intel update', 'code-intel doctor',
  'Claude Code', 'Codex', 'OpenSpec'
]) {
  assert(backlog.includes(text), `omitted item not tracked in backlog: ${text}`);
}

const listStart = mcp.indexOf('server.setRequestHandler(ListToolsRequestSchema');
const callStart = mcp.indexOf('server.setRequestHandler(CallToolRequestSchema');
assert(listStart >= 0 && callStart > listStart, 'MCP declaration block missing');
const sourceTools = [...mcp.slice(listStart, callStart).matchAll(/\bname:\s*'([a-z_]+)'/g)]
  .map((match) => match[1]);
const expectedTools = [
  'repos','overview','search','inspect','context','blast_radius','file_symbols','find_path',
  'list_exports','routes','clusters','flows','detect_changes','query','raw_query','group_list',
  'group_sync','group_contracts','group_query','group_status','explain_relationship','pr_impact',
  'similar_symbols','health_report','suggest_tests','cluster_summary','deprecated_usage',
  'complexity_hotspots','coverage_gaps','secrets','vulnerability_scan',
];
assert(JSON.stringify(sourceTools) === JSON.stringify(expectedTools), `MCP tool list changed: ${sourceTools.join(',')}`);
for (const tool of expectedTools) {
  assert(guideText.includes(`"name":"${tool}"`), `verified MCP example missing: ${tool}`);
  assert(runtime.includes(`${tool}:`), `runtime MCP arguments missing: ${tool}`);
}

for (const suffix of ['/overview', '/clusters', '/flows']) {
  assert(mcp.includes(`codeintel://repo/\${repoName}${suffix}`), `source resource missing: ${suffix}`);
  assert(guideText.includes(`codeintel://repo/<repo-name>${suffix}`), `verified resource missing: ${suffix}`);
}

for (const sourceNeedle of [
  ".command('init')", ".command('analyze')", ".command('mcp')", ".command('serve')",
  ".command('search')", ".command('inspect')", ".command('impact')", ".command('context')",
  ".command('query')", ".command('health')", ".command('complexity')", ".command('coverage')",
  ".command('secrets')", ".command('scan')", ".command('deprecated')", ".command('clean')",
  ".command('group')",
]) {
  assert(cli.includes(sourceNeedle), `certified CLI source evidence missing: ${sourceNeedle}`);
}
for (const sourceNeedle of ["command === 'index-status'", "command === 'change-context'"]) {
  assert(standalone.includes(sourceNeedle), `certified standalone source evidence missing: ${sourceNeedle}`);
}

assert(backlog.includes('This file is intentionally **not loaded by the public guide**'), 'backlog publication boundary missing');

console.log(`[guide-verify] OK: ${pages.length} runtime-only pages, ${certifiedCli.length} certified command forms, ${sourceTools.length} MCP tools, 3 MCP resources`);
