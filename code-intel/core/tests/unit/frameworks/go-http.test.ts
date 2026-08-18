import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { goHttpFrameworkAdapter } from '../../../src/frameworks/adapters/go-http.js';

describe('go http framework adapter', () => {
  it('extracts stdlib and router method registrations', () => {
    const source = [
      'package main',
      'import "net/http"',
      'http.HandleFunc("/health", health)',
      'r.Get("/users", listUsers)',
    ].join('\n');

    const detection = goHttpFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['go.mod', 'main.go'],
      fileCache: new Map([
        ['go.mod', 'module demo\nrequire github.com/go-chi/chi/v5 v5.0.0'],
        ['main.go', source],
      ]),
    });
    assert.equal(detection.exact, true);

    const bundle = goHttpFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['main.go'],
      fileCache: new Map([['main.go', source]]),
    });

    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/health'));
    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/users' && fact.method === 'get'));
  });
});
