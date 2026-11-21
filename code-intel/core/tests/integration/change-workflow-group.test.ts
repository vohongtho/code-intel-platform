import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  startWorkflow,
  workflowVerify,
  type ChangeWorkflowServiceDeps,
  type WorkflowGroupRuntime,
} from '../../src/agents/workflows/session-service.js';
import { defaultRepoRuntime } from '../../src/agents/workflows/repo-runtime.js';
import type { KnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { loadMetadata } from '../../src/storage/metadata.js';
import type { GroupSyncResult, RepoGroup } from '../../src/multi-repo/types.js';
import type { StitchResult } from '../../src/multi-repo/system-flows/types.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');

function ensureDistTestsPackageJson() {
  const target = path.join(CORE_ROOT, 'dist-tests', 'package.json');
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), target);
}

function git(repoDir: string, ...args: string[]) {
  execFileSync('git', ['-C', repoDir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
}

function analyze(repoDir: string, home: string) {
  ensureDistTestsPackageJson();
  const child = spawnSync(process.execPath, [CLI_MAIN, 'analyze', repoDir, '--skip-agents-md'], {
    cwd: CORE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', HOME: home, USERPROFILE: home },
    timeout: 180000,
  });
  if (child.status !== 0) throw new Error(`analyze failed (${child.status})\n${child.stdout}\n${child.stderr}`);
}

function makeRepo(name: string, files: Record<string, string>, pkg: Record<string, unknown>, home: string): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), `wf-group-${name}-`));
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name, private: true, ...pkg }));
  fs.writeFileSync(path.join(repoDir, '.gitignore'), '.code-intel/\nAGENTS.md\nCLAUDE.md\n');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repoDir, file)), { recursive: true });
    fs.writeFileSync(path.join(repoDir, file), content);
  }
  git(repoDir, 'init', '-q', '-b', 'main');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-q', '-m', 'init');
  analyze(repoDir, home);
  return repoDir;
}

const PROVIDER = (body: string) => [
  'export function getUser(id: string) {',
  `  ${body}`,
  '}',
  '',
].join('\n');

const CONSUMER = (field: string) => [
  "import { getUser } from 'api';",
  '',
  'export function loadUser(id: string) {',
  `  return getUser(id).${field};`,
  '}',
  '',
].join('\n');

function nodeNamed(graph: KnowledgeGraph, name: string) {
  const node = [...graph.allNodes()].find((n) => n.name === name && n.kind === 'function');
  assert.ok(node, `fixture symbol ${name}`);
  return node;
}

describe('group change workflow', () => {
  let home: string;
  let api: string;
  let web: string;
  let sync: GroupSyncResult;
  let group: RepoGroup;
  let systemFlows: StitchResult;
  let deps: ChangeWorkflowServiceDeps;
  let providerNodeId = '';
  const ids = { api: '', web: '' };

  before(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-group-home-'));
    api = makeRepo('api', { 'src/users.ts': PROVIDER("return { id, name: 'x', ssn: '000' };") }, {}, home);
    web = makeRepo('web', { 'src/client.ts': CONSUMER('ssn') }, { dependencies: { api: '*' } }, home);
    ids.api = loadMetadata(api)!.repoId!;
    ids.web = loadMetadata(web)!.repoId!;

    const getUser = nodeNamed((await defaultRepoRuntime.loadGraph(api)).graph, 'getUser');
    const loadUser = nodeNamed((await defaultRepoRuntime.loadGraph(web)).graph, 'loadUser');
    providerNodeId = getUser.id;

    group = {
      name: 'wf-group-test',
      createdAt: new Date().toISOString(),
      members: [{ groupPath: 'api', repoId: ids.api, registryName: 'api' }, { groupPath: 'web', repoId: ids.web, registryName: 'web' }],
    };
    sync = {
      groupName: group.name,
      syncedAt: new Date(Date.now() + 1000).toISOString(),
      memberCount: 2,
      schemaVersion: '1',
      contracts: [
        { repoName: 'api', repoPath: api, repositoryId: ids.api, kind: 'export', name: 'getUser', nodeId: getUser.id, nodeKind: 'function', filePath: 'src/users.ts', contractId: 'contract:api:getUser', sourceCanonicalId: getUser.identityId ?? getUser.id },
        { repoName: 'web', repoPath: web, repositoryId: ids.web, kind: 'export', name: 'loadUser', nodeId: loadUser.id, nodeKind: 'function', filePath: 'src/client.ts', contractId: 'contract:web:loadUser', sourceCanonicalId: loadUser.identityId ?? loadUser.id },
      ],
      links: [],
      consumerIndex: {
        byContractId: { 'contract:api:getUser': [{ repositoryId: ids.web, consumerId: 'contract:web:loadUser', sourceCanonicalId: loadUser.id, certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } }] },
        bySemanticFingerprint: {},
      },
    };
    systemFlows = {
      stitcherVersion: 'system-flow-stitcher-v1',
      flows: [{ id: 'sysflow:baseline', fingerprint: 'f1', algorithmVersion: 'system-flow-v1', segments: [{ repositoryId: ids.web, entrySymbolId: loadUser.identityId ?? loadUser.id, stepSymbolIds: [loadUser.identityId ?? loadUser.id] }, { repositoryId: ids.api, entrySymbolId: getUser.identityId ?? getUser.id, stepSymbolIds: [getUser.identityId ?? getUser.id] }], certainty: 'exact', coverage: { complete: true, examinedCount: 2, incompleteReasons: [] }, boundaries: [] }],
      candidates: [],
      counters: { localFlows: 2, boundaryEdges: 1, boundaryLookups: 2, segments: 2, repositoryHops: 1, candidates: 0, capHits: 0 },
      coverage: { complete: true, examinedCount: 2, incompleteReasons: [] },
      boundaries: [],
    };
    const groups: WorkflowGroupRuntime = {
      loadGroup: (name) => (name === group.name ? group : null),
      loadSyncResult: () => sync,
      resolveRepoPath: (repositoryId) => (repositoryId === ids.api ? { id: ids.api, name: 'api', path: api } : repositoryId === ids.web ? { id: ids.web, name: 'web', path: web } : null),
    };
    deps = { homeDir: home, groups, systemFlows: async () => systemFlows };
  });

  after(() => {
    for (const dir of [api, web, home]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('plans provider + consumer steps and verifies the consumer migration against group evidence', async () => {
    const started = await startWorkflow({ task: 'stop exposing ssn from getUser', scope: { type: 'group', groupName: group.name }, targets: ['getUser'] }, deps);
    const session = started.session;
    assert.equal(session.scope.type, 'group');
    assert.equal(session.baselines.length, 2);
    assert.ok(fs.existsSync(path.join(home, '.code-intel', 'workflows', 'groups', group.name, 'sessions', `${session.id}.json`)), 'group sessions live under the global group root');
    assert.ok(!fs.existsSync(path.join(api, '.code-intel', 'workflows')), 'group sessions are not duplicated into member repos');
    assert.deepEqual(session.groupBaseline?.systemFlows, [{ id: 'sysflow:baseline', fingerprint: 'f1' }]);
    assert.ok(session.capabilities.available.includes('group-contracts'));
    assert.ok(session.capabilities.available.includes('system-flows'));
    assert.ok(!session.plan.boundaries.some((b) => b.kind === 'unresolved-target'), 'a target resolved in one member is not unresolved for the group');

    const providerStep = session.plan.steps.find((s) => s.category === 'required' && s.repositories.includes(ids.api))!;
    assert.equal(providerStep.targets[0]!.id, providerNodeId);
    const consumerStep = session.plan.steps.find((s) => s.repositories.includes(ids.web) && s.expected.some((c) => c.kind === 'consumer-updated'))!;
    assert.ok(consumerStep, 'exact consumer gets a consumer-updated step');
    assert.equal(consumerStep.certainty, 'exact');

    // External edits in both repositories, then analyze both.
    fs.writeFileSync(path.join(api, 'src/users.ts'), PROVIDER("return { id, name: 'x' };"));
    fs.writeFileSync(path.join(web, 'src/client.ts'), CONSUMER('name'));
    analyze(api, home);
    analyze(web, home);

    // Group sync predates the new analyses: consumer coverage cannot be confirmed.
    sync = { ...sync, syncedAt: new Date(Date.now() - 60_000).toISOString() };
    const stale = await workflowVerify({ sessionId: session.id, groupName: group.name }, deps);
    const staleResult = stale.session.latestVerification!;
    assert.ok(staleResult.boundaries.some((b) => b.kind === 'group-sync-stale'));
    assert.notEqual(staleResult.conditions.find((c) => c.kind === 'consumer-updated')!.status, 'satisfied', 'stale group sync never satisfies a consumer update');
    assert.notEqual(staleResult.outcome, 'passed');

    // After `group sync`, the provider change and the consumer migration are both observed.
    sync = { ...sync, syncedAt: new Date(Date.now() + 60_000).toISOString() };
    const verified = await workflowVerify({ sessionId: session.id, groupName: group.name }, deps);
    const result = verified.session.latestVerification!;
    assert.equal(result.conditions.find((c) => c.kind === 'consumer-updated')!.status, 'satisfied', JSON.stringify(result.conditions, null, 2));
    const providerModified = result.conditions.find((c) => c.kind === 'node-modified' && c.repositoryId === ids.api && providerStep.expected.some((e) => e.id === c.conditionId))!;
    assert.equal(providerModified.status, 'satisfied');
    assert.equal(result.counts.systemFlowsChanged, 0);
    assert.equal(result.outcome, 'passed', JSON.stringify({ conditions: result.conditions, lenses: result.lenses, coverage: result.coverage, boundaries: result.boundaries }, null, 2));

    // A system flow that disappears at verify time is reported as an unplanned change.
    systemFlows = { ...systemFlows, flows: [] };
    const flowsGone = await workflowVerify({ sessionId: session.id, groupName: group.name }, deps);
    assert.equal(flowsGone.session.latestVerification!.counts.systemFlowsChanged, 1);
    assert.ok(flowsGone.session.latestVerification!.unexpected.some((u) => u.change === 'system-flow-changed'));

    // Membership change blocks verification explicitly.
    group = { ...group, members: group.members.slice(0, 1) };
    const blocked = await workflowVerify({ sessionId: session.id, groupName: group.name }, deps);
    assert.equal(blocked.session.latestVerification!.outcome, 'blocked');
    assert.ok(blocked.session.latestVerification!.boundaries.some((b) => b.kind === 'group-membership-changed'));
  });
});
