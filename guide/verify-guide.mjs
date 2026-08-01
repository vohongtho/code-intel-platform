import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = (message) => { throw new Error(`[guide-verify] ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

const pkg = JSON.parse(read('code-intel/core/package.json'));
const cli = read('code-intel/core/src/cli/app.ts');
const standalone = read('code-intel/core/src/cli/standalone-commands.ts');
const mcp = read('code-intel/core/src/mcp-server/server.ts');
const http = read('code-intel/core/src/http/app.ts');
const languageRegistry = read('code-intel/core/src/languages/registry.ts');
const entry = read('guide/v109.html');

const context = vm.createContext({ window: { CODE_INTEL_AUDITED_PAGES: [] } });
for (let i = 1; i <= 5; i += 1) {
  vm.runInContext(read(`guide/audited-content-${i}.js`), context, { filename: `audited-content-${i}.js` });
}
const pages = context.window.CODE_INTEL_AUDITED_PAGES;
const guideText = pages.map((page) => `${page.title}\n${page.markdown}`).join('\n');

assert(pkg.name === '@vohongtho.infotech/code-intel', `unexpected package name: ${pkg.name}`);
assert(pkg.version === '1.0.9', `unexpected package version: ${pkg.version}`);
assert(guideText.includes(pkg.name), 'guide does not contain package name');
assert(guideText.includes(`Version: ${pkg.version}`), 'overview does not contain audited version');
assert(pages.length === 19, `expected 19 guide pages, found ${pages.length}`);
assert(new Set(pages.map((page) => page.slug)).size === pages.length, 'duplicate guide slug');
assert(entry.includes('audited-loader.js'), 'entrypoint does not load audited renderer');
assert(!entry.includes('app-1.0.9.js') && !entry.includes('source-reviewed-reference.js') && !entry.includes('openspec-integration.js'), 'entrypoint still loads legacy patched content');

const expectedLanguages = [
  'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'C', 'C++', 'C#',
  'Rust', 'PHP', 'Kotlin', 'Ruby', 'Swift', 'Dart', 'HTML',
];
for (const language of expectedLanguages) {
  assert(languageRegistry.includes(`label: '${language}'`), `source language missing: ${language}`);
  assert(guideText.includes(language), `guide language missing: ${language}`);
}

const listToolsStart = mcp.indexOf('server.setRequestHandler(ListToolsRequestSchema');
const callToolsStart = mcp.indexOf('server.setRequestHandler(CallToolRequestSchema');
assert(listToolsStart >= 0 && callToolsStart > listToolsStart, 'cannot locate MCP tool declaration block');
const toolBlock = mcp.slice(listToolsStart, callToolsStart);
const sourceTools = [...toolBlock.matchAll(/\bname:\s*'([a-z_]+)'/g)].map((m) => m[1]);
const expectedTools = [
  'repos','overview','search','inspect','context','blast_radius','file_symbols','find_path','list_exports',
  'routes','clusters','flows','detect_changes','query','raw_query','group_list','group_sync','group_contracts',
  'group_query','group_status','explain_relationship','pr_impact','similar_symbols','health_report','suggest_tests',
  'cluster_summary','deprecated_usage','complexity_hotspots','coverage_gaps','secrets','vulnerability_scan',
];
assert(JSON.stringify(sourceTools) === JSON.stringify(expectedTools), `MCP tool list changed:\nsource=${sourceTools.join(',')}\nexpected=${expectedTools.join(',')}`);
for (const tool of expectedTools) assert(guideText.includes(`\n${tool}\n`) || guideText.includes(`\`${tool}\``), `guide missing MCP tool: ${tool}`);

const expectedResources = ['/overview', '/clusters', '/flows'];
for (const suffix of expectedResources) {
  assert(mcp.includes(`codeintel://repo/\${repoName}${suffix}`), `source MCP resource missing: ${suffix}`);
  assert(guideText.includes(`codeintel://repo/<repo-name>${suffix}`), `guide MCP resource missing: ${suffix}`);
}

const commandEvidence = [
  [cli, ".command('init')", 'code-intel init'],
  [cli, ".command('setup')", 'code-intel setup'],
  [cli, ".command('analyze')", 'code-intel analyze'],
  [cli, ".command('mcp')", 'code-intel mcp'],
  [cli, ".command('serve')", 'code-intel serve'],
  [cli, ".command('watch')", 'code-intel watch'],
  [cli, ".command('repo')", 'code-intel repo list'],
  [cli, ".command('clean')", 'code-intel clean'],
  [cli, ".command('search')", 'code-intel search'],
  [cli, ".command('inspect')", 'code-intel inspect'],
  [cli, ".command('impact')", 'code-intel impact'],
  [cli, ".command('group')", 'code-intel group'],
  [cli, ".command('health')", 'code-intel health'],
  [cli, ".command('query')", 'code-intel query'],
  [cli, ".command('complexity')", 'code-intel complexity'],
  [cli, ".command('coverage')", 'code-intel coverage'],
  [cli, ".command('secrets')", 'code-intel secrets'],
  [cli, ".command('scan')", 'code-intel scan'],
  [cli, ".command('context')", 'code-intel context'],
  [cli, ".command('pr-impact')", 'code-intel pr-impact'],
  [cli, "new Command('rewrite')", 'code-intel rewrite'],
  [cli, "new Command('hook')", 'code-intel hook'],
  [standalone, "command === 'index-status'", 'code-intel index-status'],
  [standalone, "command === 'change-context'", 'code-intel change-context'],
  [standalone, "command === 'change-context-mcp'", 'code-intel change-context-mcp'],
  [standalone, "command === 'change-context-http'", 'code-intel change-context-http'],
];
for (const [source, sourceNeedle, guideNeedle] of commandEvidence) {
  assert(source.includes(sourceNeedle), `source command evidence missing: ${sourceNeedle}`);
  assert(guideText.includes(guideNeedle), `guide command missing: ${guideNeedle}`);
}

const expectedRoutes = [
  'GET /metrics','GET /health/live','GET /health/ready','GET /health/startup',
  'POST /api/v1/search','POST /api/v1/vector-search','POST /api/v1/query',
  'GET  /api/v1/repos','GET  /api/v1/graph/:repo','GET  /api/v1/source',
  'DELETE /api/v1/groups/:name',
];
const routeSourceNeedles = [
  "app.get('/metrics'", "app.get('/health/live'", "app.get('/health/ready'", "app.get('/health/startup'",
  "app.post('/api/v1/search'", "app.post('/api/v1/vector-search'", "app.post('/api/v1/query'",
  "app.get('/api/v1/repos'", "app.get('/api/v1/graph/:repo'", "app.get('/api/v1/source'",
  "app.delete('/api/v1/groups/:name'",
];
routeSourceNeedles.forEach((needle, index) => {
  assert(http.includes(needle), `HTTP source route missing: ${needle}`);
  assert(guideText.includes(expectedRoutes[index]), `guide HTTP route missing: ${expectedRoutes[index]}`);
});

const requiredDisclosures = [
  'MCP server metadata: `0.1.0`',
  '`scan --format sarif` tool metadata: `0.8.0`',
  'npx code-intel mcp .',
  'code-intel repo list',
  'does **not** generate Agent Skills',
  'config.json` is not included',
];
for (const disclosure of requiredDisclosures) assert(guideText.includes(disclosure), `guide disclosure missing: ${disclosure}`);

console.log(`[guide-verify] OK: ${pages.length} pages, ${sourceTools.length} MCP tools, ${expectedLanguages.length} languages`);
