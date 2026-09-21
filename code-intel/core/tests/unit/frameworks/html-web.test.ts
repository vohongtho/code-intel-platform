import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { htmlWebFrameworkAdapter } from '../../../src/frameworks/adapters/html-web.js';

describe('html web framework adapter', () => {
  it('extracts form routes, script resources, and inline handlers', () => {
    const source = [
      '<form action="/submit" method="POST">',
      '<button onclick="saveUser()">Save</button>',
      '<script src="/assets/app.js"></script>',
    ].join('\n');

    const detection = htmlWebFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['index.html'],
      fileCache: new Map([['index.html', source]]),
    });
    assert.equal(detection.exact, true);

    const bundle = htmlWebFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['index.html'],
      fileCache: new Map([['index.html', source]]),
    });

    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/submit' && fact.method === 'post'));
    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.registrationKind === 'embedded-script'));
    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.registrationKind === 'inline-handler'));
  });
});
