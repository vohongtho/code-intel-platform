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
const http = read('code-intel/core/src/http/app.ts');
const languages = read('code-intel/core/src/languages/registry.ts');
const web = read('code-intel/web/src/App.tsx');
const entry = read('guide/v109.html');

const context = vm.createContext({ window: { CODE_INTEL_AUDITED_PAGES: [] } });
for (let index = 1; index <= 6; index += 1) {
  vm.runInContext(read(`guide/audited-content-${index}.js`), context, {
    filename: `audited-content-${index}.js`,
  });
}
const pages = context.window.CODE_INTEL_AUDITED_PAGES;
const guideText = pages.map((page) => `${page.title}\n${page.markdown}`).join('\n');

assert(pkg.name === '@vohongtho.infotech/code-intel', `unexpected package: ${pkg.name}`);
assert(pkg.version === '1.0.9', `unexpected version: ${pkg.version}`);
assert(pages.length === 20, `expected 20 guide pages, found ${pages.length}`);
assert(new Set(pages.map((page) => page.slug)).size === pages.length, 'duplicate guide slug');
assert(pages.some((page) => page.slug === 'runtime-verified'), 'runtime-verified page missing');
assert(entry.includes('audited-content-6.js'), 'entrypoint does not load runtime-verified content');
assert(entry.includes('audited-loader.js'), 'entrypoint does not load audited renderer');
assert(!entry.includes('app-1.0.9.js') && !entry.includes('source-reviewed-reference.js'), 'legacy patched content loaded');

const expectedLanguages = [
  ['TypeScript', 'TypeScript'], ['JavaScript', 'JavaScript'], ['Python', 'Python'],
  ['Java', 'Java'], ['Go', 'Go'], ['C', 'C'], ['C++', 'Cpp'], ['C#', 'CSharp'],
  ['Rust', 'Rust'], ['PHP', 'PHP'], ['Kotlin', 'Kotlin'], ['Ruby', 'Ruby'],
  ['Swift', 'Swift'], ['Dart', 'Dart'], ['HTML', 'HTML'],
];
for (const [label, enumKey] of expectedLanguages) {
  assert(languages.includes(`[Language.${enumKey}]`), `source language missing: ${label}`);
  assert(guideText.includes(label), `guide language missing: ${label}`);
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
assert(JSON.stringify(sourceTools) === JSON.stringify(expectedTools),
  `MCP tool list changed:\n${sourceTools.join(',')}`);
for (const tool of expectedTools) {
  assert(guideText.includes(`\n${tool}\n`) || guideText.includes(`\`${tool}\``),
    `guide missing MCP tool: ${tool}`);
}

for (const suffix of ['/overview', '/clusters', '/flows']) {
  assert(mcp.includes(`codeintel://repo/\${repoName}${suffix}`), `source resource missing: ${suffix}`);
  assert(guideText.includes(`codeintel://repo/<repo-name>${suffix}`), `guide resource missing: ${suffix}`);
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
  [standalone, "command === 'index-status'", 'code-intel index-status'],
  [standalone, "command === 'change-context'", 'code-intel change-context'],
];
for (const [source, sourceNeedle, guideNeedle] of commandEvidence) {
  assert(source.includes(sourceNeedle), `source command missing: ${sourceNeedle}`);
  assert(guideText.includes(guideNeedle), `guide command missing: ${guideNeedle}`);
}

const sourceRoutes = [...http.matchAll(/app\.(get|post|put|delete)\(\s*'([^']+)'/g)]
  .map((match) => `${match[1].toUpperCase()} ${match[2]}`);
const missingRoutes = sourceRoutes.filter((route) => !guideText.includes(route.slice(route.indexOf(' ') + 1)));
assert(missingRoutes.length === 0, `guide missing HTTP routes:\n${missingRoutes.join('\n')}`);

const webRoutes = [...web.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]);
const missingWebRoutes = webRoutes.filter((route) => !guideText.includes(route));
assert(missingWebRoutes.length === 0, `guide missing Web routes:\n${missingWebRoutes.join('\n')}`);

for (const text of [
  'MCP server metadata: `0.1.0`',
  '`scan --format sarif` tool metadata: `0.8.0`',
  'npx code-intel mcp .',
  'does **not** generate Agent Skills',
  'config.json` is not included',
  '100% of the published runtime matrix passed',
  'Registered but not runtime-certified by this matrix',
  'Every tool below completed a real `tools/call` request successfully',
]) {
  assert(guideText.includes(text), `required disclosure missing: ${text}`);
}

const commandDeclarations = [
  ...[...cli.matchAll(/\.command\('([^']+)'\)/g)].map((match) => match[1]),
  ...[...cli.matchAll(/new Command\('([^']+)'\)/g)].map((match) => match[1]),
];

console.log(`[guide-verify] OK: ${pages.length} pages, ${sourceTools.length} MCP tools, ${expectedLanguages.length} languages, ${sourceRoutes.length} HTTP routes, ${webRoutes.length} Web routes, ${commandDeclarations.length} command declarations`);
