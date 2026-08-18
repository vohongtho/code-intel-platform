import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nestFrameworkAdapter } from '../../../src/frameworks/adapters/nest.js';

describe('nest framework adapter', () => {
  it('detects and extracts controller, route, provider, constructor DI facts', () => {
    const source = [
      "import { Controller, Get, Module, Injectable } from '@nestjs/common'",
      '@Controller("users")',
      'export class UsersController {',
      '  constructor(private readonly service: UsersService) {}',
      '  @Get("list")',
      '  list() {}',
      '}',
      '@Injectable()',
      'export class UsersService {}',
      '@Module({',
      '  providers: [UsersService],',
      '  controllers: [UsersController],',
      '})',
    ].join('\n');

    const detection = nestFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['package.json', 'src/users.controller.ts'],
      fileCache: new Map([
        ['package.json', '{"dependencies":{"@nestjs/common":"^10.0.0"}}'],
        ['src/users.controller.ts', source],
      ]),
    });
    assert.equal(detection.exact, true);

    const bundle = nestFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/users.controller.ts'],
      fileCache: new Map([['src/users.controller.ts', source]]),
    });

    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.registrationKind === 'controller'));
    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === 'list'));
    assert.ok(bundle.facts.some((fact) => 'bindingKind' in fact && 'tokenText' in fact && fact.tokenText === 'UsersService'));
    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.registrationKind === 'provider'));
  });
});
