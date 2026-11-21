import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { extractProtocolFacts, graphqlOperationKey } from '../../../src/multi-repo/protocol-facts.js';
import { buildSymbolSpanIndex } from '../../../src/multi-repo/symbol-spans.js';
import { matchProtocolFacts } from '../../../src/multi-repo/group-sync.js';
import { workspaceRelativePath } from '../../../src/frameworks/contracts.js';
import { expressFrameworkAdapter } from '../../../src/frameworks/adapters/express.js';
import { fetchConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/fetch.js';
import { mergeTreeSitterCallables } from '../../../src/pipeline/phases/parse-phase.js';
import type { CodeNode } from '../../../src/shared/index.js';

/** Graph with callables at given [name, startLine, endLine, kind?] for one file. */
function spans(filePath: string, defs: Array<[string, number, number, ('function' | 'method')?]>) {
  const graph = createKnowledgeGraph();
  for (const [name, startLine, endLine, kind] of defs) {
    graph.addNode({ id: `${filePath}#${name}`, identityId: `sym:${filePath}#${name}`, kind: kind ?? 'function', name, filePath, startLine, endLine });
  }
  return buildSymbolSpanIndex(graph);
}

function facts(filePath: string, source: string, defs: Array<[string, number, number, ('function' | 'method')?]>) {
  return extractProtocolFacts([{ filePath, source }], spans(filePath, defs));
}

describe('protocol facts: events', () => {
  it('publish and named subscribe handler resolve to symbols by literal topic', () => {
    const producer = facts('src/pay.ts', [
      'export function publishCaptured(id: string): void {',
      "  bus.publish('payment.captured', { id });",
      '}',
    ].join('\n'), [['publishCaptured', 1, 3]]);
    assert.deepEqual(producer.map((f) => [f.role, f.key, f.symbolId]), [['provider', 'payment.captured', 'sym:src/pay.ts#publishCaptured']]);

    const consumer = facts('src/notify.ts', [
      'export function handleCaptured(event: unknown): void {',
      '  send(event);',
      '}',
      'export function start(bus: Bus): void {',
      "  bus.subscribe('payment.captured', handleCaptured);",
      '}',
    ].join('\n'), [['handleCaptured', 1, 3], ['start', 4, 6]]);
    assert.deepEqual(consumer.map((f) => [f.role, f.key, f.symbolId]), [['consumer', 'payment.captured', 'sym:src/notify.ts#handleCaptured']]);
  });

  it('NestJS @EventPattern resolves to the decorated method; Kafka send({ topic }) is a producer', () => {
    const result = facts('src/consumer.ts', [
      'export class Consumer {',
      "  @EventPattern('order.placed')",
      '  async onPlaced(data: unknown) {',
      '    return data;',
      '  }',
      '  emit() {',
      "    return producer.send({ topic: 'order.shipped', messages: [] });",
      '  }',
      '}',
    ].join('\n'), [['onPlaced', 3, 5, 'method'], ['emit', 6, 8, 'method']]);
    assert.deepEqual(result.map((f) => [f.role, f.key, f.symbolName]), [['consumer', 'order.placed', 'onPlaced'], ['provider', 'order.shipped', 'emit']]);
  });

  it('inline handlers stay unresolved; generic EventEmitter .on/.emit is ignored', () => {
    const result = facts('src/x.ts', [
      'export function wire(bus: Bus, stream: Stream): void {',
      "  bus.subscribe('payment.captured', (e) => console.log(e));",
      "  stream.on('data', handle);",
      "  emitter.emit('payment.captured', 1);",
      '}',
    ].join('\n'), [['wire', 1, 5]]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.symbolId, undefined);
    assert.match(result[0]!.unresolvedReason!, /inline/);
  });

  it('a call site outside any real function span is unresolved (no nearest-preceding guess)', () => {
    const result = facts('src/top.ts', [
      'export function before(): void {}',
      "bus.publish('payment.captured', {});",
    ].join('\n'), [['before', 1, 1]]);
    assert.equal(result[0]!.symbolId, undefined);
  });
});

describe('protocol facts: GraphQL', () => {
  it('derives the root operation field from documents', () => {
    assert.equal(graphqlOperationKey('query GetOrder($id: ID!) { order(id: $id) { id } }'), 'query.order');
    assert.equal(graphqlOperationKey('\n  mutation { placeOrder(input: $i) { id } }'), 'mutation.placeOrder');
    assert.equal(graphqlOperationKey('{ me { id } }'), 'query.me');
    assert.equal(graphqlOperationKey('query { alias: order(id: 1) { id } }'), 'query.order');
  });

  it('resolver-map providers and gql consumers used inside functions', () => {
    const provider = facts('src/resolvers.ts', [
      'const resolvers = {',
      '  Query: {',
      '    order: resolveOrder,',
      '    status() { return "ok"; },',
      '  },',
      '};',
      'export function resolveOrder(parent: unknown, args: Args): unknown {',
      '  return args;',
      '}',
    ].join('\n'), [['status', 4, 4, 'method'], ['resolveOrder', 7, 9]]);
    assert.deepEqual(provider.map((f) => [f.key, f.symbolName ?? null]), [['query.order', 'resolveOrder'], ['query.status', 'status']]);

    const consumer = facts('src/gateway.ts', [
      'const GET_ORDER = gql`',
      '  query GetOrder($id: ID!) { order(id: $id) { id } }',
      '`;',
      'export function loadOrder(id: string): Promise<unknown> {',
      '  return client.query({ query: GET_ORDER, variables: { id } });',
      '}',
    ].join('\n'), [['loadOrder', 4, 6]]);
    assert.deepEqual(consumer.map((f) => [f.role, f.key, f.symbolName]), [['consumer', 'query.order', 'loadOrder']]);
  });

  it('NestJS resolvers only count in files importing @nestjs/graphql (REST @Query params never do)', () => {
    const nest = facts('src/order.resolver.ts', [
      "import { Resolver, Query } from '@nestjs/graphql';",
      '@Resolver()',
      'export class OrderResolver {',
      "  @Query(() => Order, { name: 'order' })",
      '  findOne(id: string) {',
      '    return id;',
      '  }',
      '}',
    ].join('\n'), [['findOne', 5, 7, 'method']]);
    assert.deepEqual(nest.map((f) => [f.key, f.symbolName]), [['query.order', 'findOne']]);

    const rest = facts('src/orders.controller.ts', [
      "import { Controller, Get, Query } from '@nestjs/common';",
      'export class OrdersController {',
      '  @Get()',
      '  list(@Query() q: unknown) { return q; }',
      '}',
    ].join('\n'), [['list', 4, 4, 'method']]);
    assert.deepEqual(rest, []);
  });
});

describe('protocol facts: gRPC', () => {
  it('addService providers, @GrpcMethod providers and client calls', () => {
    const add = facts('src/server.ts', [
      'server.addService(proto.BillingService.service, { charge: chargeImpl, refund });',
      'export function chargeImpl(call: Call, cb: Cb): void {',
      '  cb(null, {});',
      '}',
      'export function refund(call: Call, cb: Cb): void {',
      '  cb(null, {});',
      '}',
    ].join('\n'), [['chargeImpl', 2, 4], ['refund', 5, 7]]);
    assert.deepEqual(add.map((f) => [f.key, f.symbolName]), [['BillingService/charge', 'chargeImpl'], ['BillingService/refund', 'refund']]);

    const nest = facts('src/billing.controller.ts', [
      'export class BillingController {',
      "  @GrpcMethod('BillingService', 'Charge')",
      '  charge(data: unknown) {',
      '    return data;',
      '  }',
      '}',
    ].join('\n'), [['charge', 3, 5, 'method']]);
    assert.deepEqual(nest.map((f) => [f.key, f.symbolName]), [['BillingService/charge', 'charge']]);

    const client = facts('src/orders.ts', [
      "import * as grpc from '@grpc/grpc-js';",
      "const billing = new proto.BillingService('localhost:1', grpc.credentials.createInsecure());",
      'export function chargeFor(id: string): unknown {',
      '  return billing.charge({ id });',
      '}',
    ].join('\n'), [['chargeFor', 3, 5]]);
    assert.deepEqual(client.map((f) => [f.role, f.key, f.symbolName]), [['consumer', 'BillingService/charge', 'chargeFor']]);
  });

  it('a `new X.Y()` without a gRPC import is not a gRPC client', () => {
    const result = facts('src/plain.ts', [
      "const svc = new models.BillingService('x');",
      'export function chargeFor(id: string): unknown {',
      '  return svc.charge({ id });',
      '}',
    ].join('\n'), [['chargeFor', 2, 4]]);
    assert.deepEqual(result, []);
  });
});

describe('protocol links (group sync)', () => {
  const member = (repoId: string, repoFacts: ReturnType<typeof facts>) => ({ repoId, repoName: repoId, repoPath: `/repos/${repoId}`, snapshotId: `${repoId}-gen`, facts: repoFacts });

  it('links equal literal keys across repositories only; exact only with both symbols resolved', () => {
    const producer = facts('src/pay.ts', ['export function p(): void {', "  bus.publish('payment.captured', {});", '}'].join('\n'), [['p', 1, 3]]);
    const consumer = facts('src/n.ts', ['export function h(): void {}', 'export function s(): void {', "  bus.subscribe('payment.captured', h);", '}'].join('\n'), [['h', 1, 1], ['s', 2, 4]]);
    const inline = facts('src/i.ts', ['export function s(): void {', "  bus.subscribe('payment.captured', (e) => e);", '}'].join('\n'), [['s', 1, 3]]);
    const sameRepoConsumer = facts('src/self.ts', ['export function h2(): void {}', 'export function s2(): void {', "  bus.subscribe('payment.captured', h2);", '}'].join('\n'), [['h2', 1, 1], ['s2', 2, 4]]);
    const { links, contracts } = matchProtocolFacts([
      member('payments', [...producer, ...sameRepoConsumer]),
      member('notifications', consumer),
      member('audit', inline),
    ]);
    assert.equal(links.length, 2, 'no same-repository link');
    const exact = links.find((l) => l.consumerRepo === 'notifications')!;
    assert.equal(exact.matchKind, 'event-topic-match');
    assert.equal(exact.certainty, 'exact');
    assert.equal(exact.providerSourceCanonicalId, 'sym:src/pay.ts#p');
    assert.equal(exact.consumerSourceCanonicalId, 'sym:src/n.ts#h');
    assert.ok(exact.consumerContractId);
    const heuristic = links.find((l) => l.consumerRepo === 'audit')!;
    assert.equal(heuristic.certainty, 'heuristic');
    assert.equal(heuristic.consumerContractId, undefined, 'unresolved consumers never enter the exact consumer index');
    assert.ok(contracts.every((c) => c.nodeKind.startsWith('protocol:') && c.contractId));
  });

  it('different keys never link, even with identical symbol names', () => {
    const a = facts('src/a.ts', ['export function charge(): void {', "  bus.publish('billing.charge', {});", '}'].join('\n'), [['charge', 1, 3]]);
    const b = facts('src/b.ts', ['export function charge(): void {}', 'export function s(): void {', "  bus.subscribe('billing.refund', charge);", '}'].join('\n'), [['charge', 1, 1], ['s', 2, 4]]);
    assert.deepEqual(matchProtocolFacts([member('x', a), member('y', b)]).links, []);
  });
});

describe('adapter paths and tree-sitter merge (analyzer fixes)', () => {
  it('workspaceRelativePath relativizes absolute pipeline paths and keeps relative ones', () => {
    assert.equal(workspaceRelativePath('/work/repo', '/work/repo/src/app.js'), 'src/app.js');
    assert.equal(workspaceRelativePath('/repo', 'src/app.js'), 'src/app.js');
    assert.equal(workspaceRelativePath('/tmp/x/code-intel-platform-copy', '/tmp/x/code-intel-platform-copy/src/a.ts'), 'src/a.ts');
  });

  it('framework/consumer adapters emit workspace-relative fact paths for absolute inputs', () => {
    const root = '/tmp/some/other-place';
    const file = `${root}/src/app.js`;
    const source = [
      "const express = require('express');",
      'const app = express();',
      "app.get('/users/:id', getUser);",
      'function getUser(req, res) {',
      "  res.status(200).json({ id: req.params.id, name: 'x' });",
      '}',
      'async function loadUser(id) {',
      '  const response = await fetch(`/users/${id}`);',
      '  const body = await response.json();',
      '  return body.name;',
      '}',
    ].join('\n');
    const view = { workspaceRoot: root, filePaths: [file], fileCache: new Map([[file, source]]) };
    for (const bundle of [expressFrameworkAdapter.extract(view), fetchConsumerAdapter.extract(view)]) {
      assert.ok(bundle.facts.length > 0);
      for (const fact of bundle.facts) assert.equal(fact.filePath, 'src/app.js');
    }
  });

  it('mergeTreeSitterCallables adds missing callables and fills anchor-only spans without replacing identities', () => {
    const graph = createKnowledgeGraph();
    const projected: CodeNode[] = [{ id: 'sym:submit', kind: 'function', name: 'submit', filePath: 'src/a.ts', startLine: 1, endLine: 1 }];
    for (const node of projected) graph.addNode({ ...node });
    graph.addNode({ id: 'file:a', kind: 'file', name: 'a.ts', filePath: 'src/a.ts' });
    const tree = {
      nodes: [
        { id: 'function:src/a.ts:submit', kind: 'function' as const, name: 'submit', filePath: 'src/a.ts', startLine: 1, endLine: 4 },
        { id: 'method:src/a.ts:handle', kind: 'method' as const, name: 'handle', filePath: 'src/a.ts', startLine: 6, endLine: 9 },
        { id: 'class:src/a.ts:H', kind: 'class' as const, name: 'H', filePath: 'src/a.ts', startLine: 5, endLine: 10 },
      ],
      edges: [
        { id: 'e1', source: 'file:a', target: 'function:src/a.ts:submit', kind: 'contains' as const },
        { id: 'e2', source: 'file:a', target: 'method:src/a.ts:handle', kind: 'contains' as const },
      ],
    };
    assert.equal(mergeTreeSitterCallables(graph, projected, tree), 1);
    assert.equal(graph.getNode('sym:submit')!.endLine, 4, 'projected identity kept, body span filled');
    assert.equal(graph.getNode('function:src/a.ts:submit'), undefined, 'no duplicate for a projected callable');
    assert.ok(graph.getNode('method:src/a.ts:handle'));
    assert.equal(graph.getNode('class:src/a.ts:H'), undefined, 'only callables are merged');
    assert.ok([...graph.findEdgesFrom('file:a')].some((e) => e.target === 'method:src/a.ts:handle'));
  });
});
