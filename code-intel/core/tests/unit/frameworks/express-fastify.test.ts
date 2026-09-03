import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expressFrameworkAdapter } from '../../../src/frameworks/adapters/express.js';
import { fastifyFrameworkAdapter } from '../../../src/frameworks/adapters/fastify.js';

describe('express and fastify framework adapters', () => {
  it('extracts express routes and middleware', () => {
    const source = [
      "const express = require('express')",
      'app.use(auth)',
      "app.get('/users', listUsers)",
    ].join('\n');

    const detection = expressFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['package.json', 'src/app.js'],
      fileCache: new Map([
        ['package.json', '{"dependencies":{"express":"^5.0.0"}}'],
        ['src/app.js', source],
      ]),
    });
    assert.equal(detection.exact, true);

    const bundle = expressFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/app.js'],
      fileCache: new Map([['src/app.js', source]]),
    });
    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/users'));
    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.registrationKind === 'middleware'));
  });

  it('extracts fastify routes and hooks', () => {
    const source = [
      "import Fastify from 'fastify'",
      "fastify.addHook('preHandler', auth)",
      "fastify.get('/users', listUsers)",
    ].join('\n');

    const detection = fastifyFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['package.json', 'src/app.ts'],
      fileCache: new Map([
        ['package.json', '{"dependencies":{"fastify":"^4.0.0"}}'],
        ['src/app.ts', source],
      ]),
    });
    assert.equal(detection.exact, true);

    const bundle = fastifyFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/app.ts'],
      fileCache: new Map([['src/app.ts', source]]),
    });
    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/users'));
    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.targetText === 'preHandler'));
  });

  it('does not detect a plain Express app (bare app.get, no fastify identifier/import/dependency) as fastify', () => {
    // Regression test: this exact shape used to score high enough on fastify's old
    // registration signal (which accepted a bare `app.` receiver) to make plain Express
    // routes silently get mislabeled as fastify wherever framework facts merge by node id.
    const source = [
      "const express = require('express');",
      'const app = express();',
      "app.get('/users/:id', getUser);",
    ].join('\n');

    const detection = fastifyFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['src/app.js'],
      fileCache: new Map([['src/app.js', source]]),
    });
    assert.equal(detection.confidence, 'none');
  });
});
