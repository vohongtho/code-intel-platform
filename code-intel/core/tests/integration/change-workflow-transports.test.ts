import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { createMcpServer, dispatchTool } from '../../src/mcp-server/server.js';
import { MCP_TOOL_DEFINITIONS } from '../../src/mcp-server/tool-definitions.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');

function ensureDistTestsPackageJson() {
  const target = path.join(CORE_ROOT, 'dist-tests', 'package.json');
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), target);
}

function cli(args: string[], home: string) {
  ensureDistTestsPackageJson();
  return spawnSync(process.execPath, [CLI_MAIN, ...args], {
    cwd: CORE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', HOME: home, USERPROFILE: home },
    timeout: 180000,
  });
}

function makeRepo(home: string, name: string): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), `wf-transport-${name}-`));
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name, private: true }));
  fs.writeFileSync(path.join(repoDir, '.gitignore'), '.code-intel/\nAGENTS.md\nCLAUDE.md\n');
  fs.mkdirSync(path.join(repoDir, 'src'));
  fs.writeFileSync(path.join(repoDir, 'src/math.ts'), 'export function double(n: number): number {\n  return n * 2;\n}\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', repoDir, '-c', 'user.email=t@e', '-c', 'user.name=t', ...args]);
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  const analyzed = cli(['analyze', repoDir, '--skip-agents-md'], home);
  if (analyzed.status !== 0) throw new Error(`analyze failed\n${analyzed.stdout}\n${analyzed.stderr}`);
  return repoDir;
}

function parse(result: { content: Array<{ text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('change_workflow transports', () => {
  let home: string;
  let repoA: string;
  let repoB: string;

  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-transport-home-'));
    repoA = makeRepo(home, 'alpha');
    repoB = makeRepo(home, 'beta');
  });
  after(() => {
    for (const dir of [repoA, repoB, home]) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('declares one action-oriented change_workflow tool and a read-only system_flows tool', () => {
    const tool = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'change_workflow')!;
    assert.ok(tool);
    const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
    assert.deepEqual(props['action']!.enum, ['start', 'status', 'checkpoint', 'verify', 'complete', 'list']);
    assert.ok(props['repoId'], 'repo-selectable like every repo tool');
    assert.ok(props['_token'], 'token-gated like every tool');
    assert.ok(MCP_TOOL_DEFINITIONS.find((t) => t.name === 'system_flows'));
    assert.equal(MCP_TOOL_DEFINITIONS.filter((t) => /workflow/.test(t.name)).length, 1, 'no near-duplicate workflow tools');
  });

  it('MCP and CLI drive the same session through one orchestrator', async () => {
    const graph = createKnowledgeGraph();
    const started = parse(await dispatchTool('change_workflow', { action: 'start', task: 'double faster', targets: ['double'] }, graph, 'alpha', repoA));
    const sessionId = started['sessionId'] as string;
    assert.match(sessionId, /^wf_[0-9a-f]{32}$/);
    assert.equal(started['phase'], 'ready-for-change');

    const viaCli = cli(['workflow', 'status', sessionId, '-p', repoA, '--json'], home);
    assert.equal(viaCli.status, 0, viaCli.stderr);
    const cliView = JSON.parse(viaCli.stdout) as Record<string, unknown>;
    assert.equal(cliView['sessionId'], sessionId);
    assert.equal(cliView['phase'], 'ready-for-change');
    assert.deepEqual((cliView['plan'] as { steps: unknown[] }).steps, (started['plan'] as { steps: unknown[] }).steps);

    const listed = cli(['workflow', 'list', '-p', repoA, '--json'], home);
    assert.ok((JSON.parse(listed.stdout) as { sessions: Array<{ id: string }> }).sessions.some((s) => s.id === sessionId));

    // Optimistic concurrency through MCP.
    const stale = await dispatchTool('change_workflow', { action: 'checkpoint', session_id: sessionId, expected_revision: 0, note: 'x' }, graph, 'alpha', repoA);
    assert.equal(stale.isError, true);
    assert.equal(parse(stale)['code'], 'REVISION_CONFLICT');
  });

  it('MCP scope policy: a session is only reachable through the repository that owns it', async () => {
    const graph = createKnowledgeGraph();
    const started = parse(await dispatchTool('change_workflow', { action: 'start', task: 'double faster', targets: ['double'] }, graph, 'alpha', repoA));
    const sessionId = started['sessionId'] as string;
    const fromOtherRepo = await dispatchTool('change_workflow', { action: 'status', session_id: sessionId }, graph, 'beta', repoB);
    assert.equal(fromOtherRepo.isError, true);
    assert.equal(parse(fromOtherRepo)['code'], 'NOT_FOUND');
    const missingGroup = await dispatchTool('change_workflow', { action: 'status', session_id: sessionId, scope: 'group', group: 'no-such-group' }, graph, 'alpha', repoA);
    assert.equal(missingGroup.isError, true);
    const badId = await dispatchTool('change_workflow', { action: 'status', session_id: '../../etc/passwd' }, graph, 'alpha', repoA);
    assert.equal(parse(badId)['code'], 'INVALID_ID');
    const badAction = await dispatchTool('change_workflow', { action: 'commit' }, graph, 'alpha', repoA);
    assert.equal(badAction.isError, true);
  });

  it('MCP token authentication applies to change_workflow like every other tool', async () => {
    const previous = process.env['CODE_INTEL_TOKEN'];
    process.env['CODE_INTEL_TOKEN'] = 'test-token-value';
    const server = createMcpServer(createKnowledgeGraph(), 'alpha', repoA);
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const denied = await client.callTool({ name: 'change_workflow', arguments: { action: 'list' } }) as { content: Array<{ text: string }>; isError?: boolean };
      assert.equal(denied.isError, true);
      assert.match(denied.content[0]!.text, /Unauthorized/);
      const allowed = await client.callTool({ name: 'change_workflow', arguments: { action: 'list', _token: 'test-token-value' } }) as { content: Array<{ text: string }>; isError?: boolean };
      assert.notEqual(allowed.isError, true, allowed.content[0]!.text);
    } finally {
      await client.close();
      await server.close();
      if (previous === undefined) delete process.env['CODE_INTEL_TOKEN'];
      else process.env['CODE_INTEL_TOKEN'] = previous;
    }
  });

  it('system_flows reports a missing group as an error, not as "no flows"', async () => {
    const result = await dispatchTool('system_flows', { name: 'no-such-group' }, createKnowledgeGraph(), 'alpha', repoA);
    assert.equal(result.isError, true);
  });
});
