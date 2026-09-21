import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expressFrameworkAdapter } from '../../../src/frameworks/adapters/express.js';
import { fastifyFrameworkAdapter } from '../../../src/frameworks/adapters/fastify.js';
import { nestFrameworkAdapter } from '../../../src/frameworks/adapters/nest.js';
import { aspnetCoreFrameworkAdapter } from '../../../src/frameworks/adapters/aspnet-core.js';
import type { HttpRouteFact, HttpResponseShapeFact } from '../../../src/semantic/api-contracts/types.js';

function isHttpRouteFact(fact: unknown): fact is HttpRouteFact {
  return typeof fact === 'object' && fact !== null && (fact as { routeFactKind?: string }).routeFactKind === 'http-route';
}

function isHttpResponseShapeFact(fact: unknown): fact is HttpResponseShapeFact {
  return typeof fact === 'object' && fact !== null && (fact as { shapeFactKind?: string }).shapeFactKind === 'http-response-shape';
}

describe('http producer fact extraction', () => {
  it('composes Express nested router prefixes and extracts request/response shape evidence', () => {
    const source = [
      "const express = require('express');",
      'const app = express();',
      'const usersRouter = express.Router();',
      "app.use('/api', usersRouter);",
      "usersRouter.get('/:id', authMiddleware, getUser);",
      'function getUser(req, res) {',
      '  const { name } = req.body;',
      "  res.status(200).json({ id: req.params.id, name: name });",
      '}',
    ].join('\n');

    const bundle = expressFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/routes.js'],
      fileCache: new Map([['src/routes.js', source]]),
    });

    const routeFact = bundle.facts.find(isHttpRouteFact);
    assert.ok(routeFact, 'expected an HttpRouteFact');
    assert.equal(routeFact.path, '/api/:id');
    assert.equal(routeFact.normalizedPath, '/api/{}');
    assert.equal(routeFact.method, 'GET');
    assert.ok(routeFact.middlewareRefs.some((ref) => ref.includes('authMiddleware')));
    assert.ok(routeFact.requestShapeRef, 'expected a request shape reference from req.body destructuring');
    assert.equal(routeFact.responses.length, 1);
    assert.equal(routeFact.responses[0]!.status, 200);
    assert.equal(routeFact.responses[0]!.evidence, 'exact');

    const responseShape = bundle.facts.find(isHttpResponseShapeFact);
    assert.ok(responseShape);
    assert.equal(responseShape.origin.kind, 'inline');
    if (responseShape.origin.kind === 'inline') {
      const keys = responseShape.origin.fields.map((field) => field.key).sort();
      assert.deepEqual(keys, ['id', 'name']);
    }
  });

  it('marks a Fastify route with an unresolved (cross-file) handler as reduced coverage', () => {
    const source = ["fastify.get('/health', healthHandler);"].join('\n');
    const bundle = fastifyFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/routes.js'],
      fileCache: new Map([['src/routes.js', source]]),
    });
    const routeFact = bundle.facts.find(isHttpRouteFact);
    assert.ok(routeFact);
    assert.equal(routeFact.coverage.complete, false);
    assert.ok(routeFact.coverage.boundaryReasons.includes('unresolved-response-shape'));
  });

  it('composes NestJS @Controller() prefix into the route and resolves @Body() DTO + guards', () => {
    const source = [
      "import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';",
      '@Controller("api/v1/users")',
      '@UseGuards(AuthGuard)',
      'export class UsersController {',
      '  @Post(":id")',
      '  update(@Body() dto: UpdateUserDto): Promise<UserResponseDto> {',
      '    return this.service.update(dto);',
      '  }',
      '}',
    ].join('\n');

    const bundle = nestFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/users.controller.ts'],
      fileCache: new Map([['src/users.controller.ts', source]]),
    });

    const routeFact = bundle.facts.find(isHttpRouteFact);
    assert.ok(routeFact);
    assert.equal(routeFact.path, 'api/v1/users/:id');
    assert.equal(routeFact.method, 'POST');
    assert.ok(routeFact.requestShapeRef?.includes('UpdateUserDto'));
    assert.equal(routeFact.responses[0]!.status, 201);
    assert.ok(routeFact.responses[0]!.responseShapeRef?.includes('UserResponseDto'));
    assert.ok(routeFact.authEvidence?.some((evidence) => evidence.includes('AuthGuard')));
  });

  it('resolves ASP.NET Core [Route]+[HttpGet] controller prefix and ActionResult<T> shape', () => {
    const source = [
      '[Route("api/[controller]")]',
      'public class UsersController : ControllerBase {',
      '  [HttpGet("{id}")]',
      '  [Authorize]',
      '  public ActionResult<UserDto> GetUser(int id) {',
      '    return Ok(user);',
      '  }',
      '}',
    ].join('\n');

    const bundle = aspnetCoreFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['Controllers/UsersController.cs'],
      fileCache: new Map([['Controllers/UsersController.cs', source]]),
    });

    const routeFact = bundle.facts.find(isHttpRouteFact);
    assert.ok(routeFact);
    assert.equal(routeFact.method, 'GET');
    assert.ok(routeFact.path.endsWith('{id}'));
    assert.equal(routeFact.responses[0]!.evidence, 'heuristic');
    assert.ok(routeFact.responses[0]!.responseShapeRef?.includes('UserDto'));
    assert.ok(routeFact.authEvidence?.includes('Authorize'));
  });
});
