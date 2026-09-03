import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { projectFactBundle } from '../../../src/semantic/graph-projector.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../src/semantic/fact-bundle.js';
import { Language } from '../../../src/shared/languages.js';
import { expressFrameworkAdapter } from '../../../src/frameworks/adapters/express.js';
import { fastifyFrameworkAdapter } from '../../../src/frameworks/adapters/fastify.js';
import { nestFrameworkAdapter } from '../../../src/frameworks/adapters/nest.js';
import { aspnetCoreFrameworkAdapter } from '../../../src/frameworks/adapters/aspnet-core.js';
import { fetchConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/fetch.js';
import { axiosConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/axios.js';
import { angularHttpConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/angular-http.js';
import { collectGraphFacts, matchConsumersToRoutes } from '../../../src/semantic/api-contracts/service.js';
import type { FrameworkAdapter } from '../../../src/frameworks/contracts.js';

/**
 * Task 11.2: exercises all four producer adapters (Express, Fastify, NestJS, ASP.NET Core) and
 * all three consumer adapters (fetch, Axios, Angular HttpClient) together, across multiple
 * files, the same way the real per-repo pipeline runs every registered framework adapter over
 * one shared `RepositoryFactView`. Also proves a same-named DTO in two different files
 * (`UserDto` returned by both the NestJS and ASP.NET Core routes here) never collides, since
 * shape fingerprints are file-scoped.
 */
const FILES: Record<string, string> = {
  'server-express/app.js': [
    "const express = require('express');",
    'const app = express();',
    "app.get('/users/:id', getUser);",
    'function getUser(req, res) {',
    "  res.status(200).json({ id: req.params.id, name: 'x' });",
    '}',
  ].join('\n'),
  'server-fastify/app.js': [
    "const fastify = require('fastify')();",
    "fastify.get('/orders/:id', getOrder);",
    'function getOrder(req, reply) {',
    "  reply.status(200).send({ id: req.params.id, total: 42 });",
    '}',
  ].join('\n'),
  'server-nest/accounts.controller.ts': [
    "import { Controller, Get } from '@nestjs/common';",
    "@Controller('accounts')",
    'export class AccountsController {',
    '  @Get(":id")',
    '  getAccount(): Promise<UserDto> {',
    '    return this.service.find();',
    '  }',
    '}',
  ].join('\n'),
  'server-aspnet/InvoicesController.cs': [
    '[Route("api/invoices")]',
    'public class InvoicesController : ControllerBase {',
    '  [HttpGet("{id}")]',
    '  public ActionResult<UserDto> GetInvoice(int id) {',
    '    return Ok(invoice);',
    '  }',
    '}',
  ].join('\n'),
  'client-fetch/users.js': [
    'async function loadUser(id) {',
    "  const response = await fetch(`/users/${id}`);",
    '  return response.json();',
    '}',
  ].join('\n'),
  'client-axios/orders.ts': [
    "import axios from 'axios';",
    'async function loadOrder(id) {',
    "  const response = await axios.get(`/orders/${id}`);",
    '  return response.data;',
    '}',
  ].join('\n'),
  'client-angular/accounts.service.ts': [
    "import { HttpClient } from '@angular/common/http';",
    'export class AccountService {',
    '  constructor(private http: HttpClient) {}',
    '  loadAccount(id: string) {',
    "    this.http.get<UserDto>('/accounts/' + id).subscribe((account) => {",
    '      this.current = account;',
    '    });',
    '  }',
    '}',
  ].join('\n'),
};

function buildGraph() {
  const view = { workspaceRoot: '/repo', filePaths: Object.keys(FILES), fileCache: new Map(Object.entries(FILES)) };
  const adapters: FrameworkAdapter[] = [
    expressFrameworkAdapter,
    fastifyFrameworkAdapter,
    nestFrameworkAdapter,
    aspnetCoreFrameworkAdapter,
    fetchConsumerAdapter,
    axiosConsumerAdapter,
    angularHttpConsumerAdapter,
  ];
  const facts = adapters.flatMap((adapter) => adapter.extract(view).facts);
  const merged = createFactBundle({ schema: { version: FACT_SCHEMA_VERSION, language: Language.TypeScript, adapterId: 'test' }, facts, diagnostics: [] });
  const graph = createKnowledgeGraph();
  const { nodes, edges } = projectFactBundle(merged);
  for (const node of nodes) graph.addNode(node);
  for (const edge of edges) graph.addEdge(edge);
  return graph;
}

describe('multi-framework API contract extraction (integration)', () => {
  it('extracts a route from every producer adapter, tagged with its own framework', () => {
    const graph = buildGraph();
    const routeNodes = [...graph.allNodes()].filter((n) => n.kind === 'route');
    const frameworksSeen = new Set(routeNodes.map((n) => (n.metadata as { semantic?: { framework?: string } })?.semantic?.framework));
    assert.ok(frameworksSeen.has('express'));
    assert.ok(frameworksSeen.has('fastify'));
    assert.ok(frameworksSeen.has('nest'));
    assert.ok(frameworksSeen.has('aspnet-core'));
  });

  it('extracts a consumer fact for every consumer adapter', () => {
    const graph = buildGraph();
    const consumerNodes = [...graph.allNodes()].filter((n) => n.kind === 'api_consumer');
    const libraries = new Set(consumerNodes.map((n) => (n.metadata as { semantic?: { clientLibrary?: string } })?.semantic?.clientLibrary));
    assert.deepEqual([...libraries].sort(), ['angular-http', 'axios', 'fetch']);
  });

  it('does not collide a same-named DTO ("UserDto") returned by two different files', () => {
    const graph = buildGraph();
    const facts = collectGraphFacts(graph);
    const userDtoShapes = [...facts.shapesByFingerprint.values()].filter(
      (shape) => shape.origin.kind === 'symbol' && shape.origin.symbolName === 'UserDto',
    );
    assert.equal(userDtoShapes.length, 2, 'expected two distinct UserDto shape facts (one per file)');
    const fingerprints = new Set(userDtoShapes.map((s) => s.shapeFingerprint));
    assert.equal(fingerprints.size, 2, 'the two same-named DTOs must not share a fingerprint');
  });

  it('matches each consumer to its own route only, never a same-path-shaped sibling route', () => {
    const graph = buildGraph();
    const facts = collectGraphFacts(graph);
    const matches = matchConsumersToRoutes(facts.routes, facts.consumers, 'repo');

    const fetchConsumer = facts.consumers.find((c) => c.clientLibrary === 'fetch');
    const axiosConsumer = facts.consumers.find((c) => c.clientLibrary === 'axios');
    const angularConsumer = facts.consumers.find((c) => c.clientLibrary === 'angular-http');
    assert.ok(fetchConsumer && axiosConsumer && angularConsumer);

    const usersRoute = facts.routes.find((r) => r.framework === 'express');
    const ordersRoute = facts.routes.find((r) => r.framework === 'fastify');
    const accountsRoute = facts.routes.find((r) => r.framework === 'nest');
    const invoicesRoute = facts.routes.find((r) => r.framework === 'aspnet-core');
    assert.ok(usersRoute && ordersRoute && accountsRoute && invoicesRoute);

    const matchFor = (factId: string) => matches.find((m) => m.referenceId === factId)!;
    assert.deepEqual(matchFor(fetchConsumer.factId).candidates.map((c) => c.targetId), [usersRoute.factId]);
    assert.deepEqual(matchFor(axiosConsumer.factId).candidates.map((c) => c.targetId), [ordersRoute.factId]);
    assert.deepEqual(matchFor(angularConsumer.factId).candidates.map((c) => c.targetId), [accountsRoute.factId]);

    // The ASP.NET Core route has no consumer anywhere in this fixture.
    const invoicesMatch = matches.find((m) => m.candidates.some((c) => c.targetId === invoicesRoute.factId));
    assert.equal(invoicesMatch, undefined);
  });
});
