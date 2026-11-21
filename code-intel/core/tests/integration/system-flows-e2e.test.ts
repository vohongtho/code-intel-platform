/**
 * End-to-end system flows and route-level group workflows on real analyzed
 * repositories, driven through the CLI with an isolated HOME:
 *   analyze --name  ->  group create/add/sync  ->  group flows --json
 *   workflow start/verify/checkpoint --group
 * Covers HTTP route facts, event topics, GraphQL operations and gRPC methods,
 * and a same-named decoy that must never be linked.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadMetadata } from '../../src/storage/metadata.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');
const FIXTURES = path.join(CORE_ROOT, 'tests', 'fixtures', 'system-flows', 'build-fixtures.mjs');

interface FlowSegment { repositoryId: string; localFlowId?: string; boundaryToNext?: { evidence: string; kind: string; contractId: string } }
interface FlowsPage { total: number; candidatesTotal: number; flows: Array<{ id: string; certainty: string; segments: FlowSegment[] }>; coverage: { complete: boolean }; cacheHit: boolean }

describe('system flows and group workflows on real analyzed repositories', () => {
  let root: string;
  let home: string;
  const dirs: Record<string, string> = {};
  const ids: Record<string, string> = {};

  function cli(args: string[], allowFailure = false) {
    if (!fs.existsSync(path.join(CORE_ROOT, 'dist-tests', 'package.json'))) fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), path.join(CORE_ROOT, 'dist-tests', 'package.json'));
    const result = spawnSync(process.execPath, [CLI_MAIN, ...args], {
      cwd: CORE_ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', HOME: home, USERPROFILE: home },
      timeout: 180000,
    });
    if (!allowFailure && result.status !== 0) throw new Error(`code-intel ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
    return result;
  }

  function flows(group: string, extra: string[] = []): FlowsPage {
    return JSON.parse(cli(['group', 'flows', group, '--json', ...extra]).stdout) as FlowsPage;
  }

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sysflow-e2e-'));
    home = path.join(root, 'home');
    fs.mkdirSync(home);
    const { writeFixtureRepo } = await import(FIXTURES) as { writeFixtureRepo: (root: string, name: string) => string };
    for (const [group, names] of [['commerce', ['web', 'payments', 'notifications']], ['ordering', ['gateway', 'orders', 'billing', 'decoy']]] as const) {
      cli(['group', 'create', group]);
      for (const name of names) {
        dirs[name] = writeFixtureRepo(root, name);
        cli(['analyze', dirs[name]!, '--skip-agents-md', '--name', name, '--no-group-sync']);
        cli(['group', 'add', group, name, name]);
        ids[name] = loadMetadata(dirs[name]!)!.repoId!;
      }
      cli(['group', 'sync', group]);
    }
  });

  after(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('stitches web -> payments -> notifications across an HTTP route and an event topic', () => {
    const page = flows('commerce', ['--no-cache']);
    assert.equal(page.total, 1, JSON.stringify(page, null, 2));
    const [flow] = page.flows;
    assert.equal(flow!.certainty, 'exact');
    assert.deepEqual(flow!.segments.map((s) => s.repositoryId), [ids.web, ids.payments, ids.notifications]);
    assert.deepEqual(flow!.segments.map((s) => s.boundaryToNext?.evidence), ['http-route-fact', 'event-topic', undefined]);
    assert.ok(flow!.segments.every((s) => s.localFlowId), 'every segment is a stable local flow');
    assert.equal(page.coverage.complete, true);
  });

  it('stitches gateway -> orders -> billing across a GraphQL operation and a gRPC method; the decoy is never linked', () => {
    const page = flows('ordering', ['--no-cache']);
    assert.equal(page.total, 1, JSON.stringify(page, null, 2));
    const [flow] = page.flows;
    assert.equal(flow!.certainty, 'exact');
    assert.deepEqual(flow!.segments.map((s) => s.repositoryId), [ids.gateway, ids.orders, ids.billing]);
    assert.deepEqual(flow!.segments.map((s) => s.boundaryToNext?.evidence), ['graphql-operation', 'grpc-method', undefined]);
    assert.ok(!JSON.stringify(page).includes(ids.decoy!), 'same-named function without protocol evidence is never part of a system flow');
    const sync = JSON.parse(fs.readFileSync(path.join(home, '.code-intel', 'groups', 'ordering.sync.json'), 'utf8')) as { links: Array<{ matchKind: string; providerRepo: string; consumerRepo: string }> };
    assert.ok(sync.links.some((l) => l.matchKind === 'graphql-operation-match' && l.providerRepo === ids.orders && l.consumerRepo === ids.gateway));
    assert.ok(sync.links.some((l) => l.matchKind === 'grpc-method-match' && l.providerRepo === ids.billing && l.consumerRepo === ids.orders));
    assert.ok(!sync.links.some((l) => l.matchKind.endsWith('-match') && l.matchKind !== 'name-match' && (l.providerRepo === ids.decoy || l.consumerRepo === ids.decoy)));
  });

  it('serves a second read from the fingerprinted cache and invalidates when a member is re-analyzed', () => {
    assert.equal(flows('commerce').cacheHit, true);
    fs.appendFileSync(path.join(dirs.notifications!, 'src/receipts.ts'), '\nexport function unused(): number {\n  return 1;\n}\n');
    cli(['analyze', dirs.notifications!, '--skip-agents-md', '--name', 'notifications', '--no-group-sync']);
    assert.equal(flows('commerce').cacheHit, false);
  });

  it('a protocol key change leaves no exact continuation (candidates are not stitched)', () => {
    const file = path.join(dirs.notifications!, 'src/receipts.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("'payment.captured'", "'payment.settled'"));
    cli(['analyze', dirs.notifications!, '--skip-agents-md', '--name', 'notifications', '--no-group-sync']);
    cli(['group', 'sync', 'commerce']);
    const page = flows('commerce');
    assert.equal(page.total, 1);
    assert.deepEqual(page.flows[0]!.segments.map((s) => s.repositoryId), [ids.web, ids.payments], 'the chain stops where the topic no longer matches');
    // Restore for the workflow test.
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("'payment.settled'", "'payment.captured'"));
    cli(['analyze', dirs.notifications!, '--skip-agents-md', '--name', 'notifications', '--no-group-sync']);
    cli(['group', 'sync', 'commerce']);
  });

  it('route-level group workflow: an unplanned breaking route change fails; a declared one with consumer migration passes', () => {
    const start = JSON.parse(cli(['workflow', 'start', '--group', 'commerce', '--task', 'move capture to /payments/charge', '--target', 'POST /payments/capture', '--json']).stdout) as {
      sessionId: string;
      capabilities: { available: string[] };
      plan: { steps: Array<{ id: string; category: string; repositories: string[]; expected: Array<{ id: string; kind: string }> }> };
    };
    const provider = start.plan.steps.find((s) => s.category === 'required' && s.repositories.includes(ids.payments!))!;
    assert.ok(provider, JSON.stringify(start.plan, null, 2));
    const compatible = provider.expected.find((c) => c.kind === 'contract-compatible')!;
    const modified = provider.expected.find((c) => c.kind === 'node-modified')!;
    assert.ok(compatible, 'the route target gets a contract condition from the real route fact');
    assert.ok(start.capabilities.available.includes('system-flows'));
    assert.ok(start.plan.steps.some((s) => s.repositories.includes(ids.web!) && s.expected.some((c) => c.kind === 'consumer-updated')), 'the real fetch consumer is planned from the real group sync consumer index');

    // Breaking change in the provider only, not declared.
    const app = path.join(dirs.payments!, 'src/app.ts');
    fs.writeFileSync(app, fs.readFileSync(app, 'utf8').replace("'/payments/capture'", "'/payments/charge'"));
    cli(['analyze', dirs.payments!, '--skip-agents-md', '--name', 'payments', '--no-group-sync']);
    cli(['group', 'sync', 'commerce']);
    const unplanned = JSON.parse(cli(['workflow', 'verify', start.sessionId, '--group', 'commerce', '--json'], true).stdout) as {
      verification: { outcome: string; conditions: Array<{ conditionId: string; status: string; reason: string }> };
    };
    const compatibleResult = unplanned.verification.conditions.find((c) => c.conditionId === compatible.id)!;
    assert.equal(compatibleResult.status, 'unexpected-change', compatibleResult.reason);
    assert.equal(unplanned.verification.outcome, 'needs-revision');

    // Declare the break and the route identity change, migrate the consumer, reindex, resync, verify.
    const full = JSON.parse(cli(['workflow', 'status', start.sessionId, '--group', 'commerce', '--full']).stdout) as {
      session: { plan: { steps: Array<{ id: string; targets: Array<{ id: string }>; expected: Array<{ id: string; kind: string; contractId?: string; nodeId?: string }> }> } };
    };
    const conditions = full.session.plan.steps.flatMap((s) => s.expected);
    const routeContractId = conditions.find((c) => c.id === compatible.id)!.contractId!;
    const routeNodeId = conditions.find((c) => c.id === modified.id)!.nodeId!;
    cli(['workflow', 'checkpoint', start.sessionId, '--group', 'commerce', '--step', provider.id,
      '--remove-condition', compatible.id, modified.id,
      '--conditions', JSON.stringify([
        { kind: 'contract-expected-breaking', repositoryId: ids.payments, contractId: routeContractId },
        { kind: 'node-absent', repositoryId: ids.payments, nodeId: routeNodeId },
      ]),
      '--note', 'route move is intentional', '--json']);
    const checkout = path.join(dirs.web!, 'src/checkout.ts');
    fs.writeFileSync(checkout, fs.readFileSync(checkout, 'utf8').replace("'/payments/capture'", "'/payments/charge'"));
    cli(['analyze', dirs.web!, '--skip-agents-md', '--name', 'web', '--no-group-sync']);
    cli(['group', 'sync', 'commerce']);
    const planned = JSON.parse(cli(['workflow', 'verify', start.sessionId, '--group', 'commerce', '--json'], true).stdout) as {
      phase: string;
      verification: { outcome: string; conditions: Array<{ kind: string; status: string; reason: string }> };
    };
    const detail = JSON.stringify(planned.verification, null, 2);
    assert.equal(planned.verification.conditions.find((c) => c.kind === 'contract-expected-breaking')!.status, 'satisfied', detail);
    assert.equal(planned.verification.conditions.find((c) => c.kind === 'node-absent')!.status, 'satisfied', detail);
    assert.equal(planned.verification.conditions.find((c) => c.kind === 'consumer-updated')!.status, 'satisfied', detail);
    assert.equal(planned.verification.outcome, 'passed', detail);
    assert.equal(planned.phase, 'review');

    // The migrated chain is stitched again across the new route.
    const page = flows('commerce');
    assert.ok(page.flows.some((f) => f.segments.length === 3 && f.segments[0]!.repositoryId === ids.web), JSON.stringify(page, null, 2));
  });
});
