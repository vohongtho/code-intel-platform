import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/fetch.js';
import { axiosConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/axios.js';
import { angularHttpConsumerAdapter } from '../../../src/semantic/api-contracts/consumers/angular-http.js';
import type { HttpConsumerFact } from '../../../src/semantic/api-contracts/types.js';

function isHttpConsumerFact(fact: unknown): fact is HttpConsumerFact {
  return typeof fact === 'object' && fact !== null && (fact as { consumerFactKind?: string }).consumerFactKind === 'http-consumer';
}

describe('http consumer fact extraction', () => {
  it('extracts a fetch() call with a static URL and tracks destructured response keys', () => {
    const source = [
      "async function loadUser(id) {",
      "  const response = await fetch(`/api/users/${id}`);",
      "  const { name, email } = await response.json();",
      "  return { name, email };",
      "}",
    ].join('\n');

    const bundle = fetchConsumerAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/api.js'],
      fileCache: new Map([['src/api.js', source]]),
    });

    const fact = bundle.facts.find(isHttpConsumerFact);
    assert.ok(fact);
    assert.equal(fact.method, 'GET');
    assert.deepEqual([...fact.url.literalSegments], ['api', 'users', '{}']);
    assert.deepEqual([...fact.url.dynamicSegmentIndices], [2]);
    assert.equal(fact.url.isFullyStatic, false); // template interpolation: path shape known, value is not
    assert.deepEqual([...fact.consumedKeys], ['email', 'name']);
    assert.ok(fact.coverage.boundaryReasons.includes('dynamic-url-expression'));
  });

  it('extracts a POST fetch() with a JSON.stringify body and reports fully static coverage', () => {
    const source = ["fetch('/api/users', { method: 'POST', body: JSON.stringify({ name, age }) });"].join('\n');
    const bundle = fetchConsumerAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/api.js'],
      fileCache: new Map([['src/api.js', source]]),
    });
    const fact = bundle.facts.find(isHttpConsumerFact);
    assert.ok(fact);
    assert.equal(fact.method, 'POST');
    assert.equal(fact.url.isFullyStatic, true);
    assert.equal(fact.coverage.complete, true);
    assert.ok(fact.requestShapeRef);
  });

  it('does not fabricate a path for a dynamic base URL concatenation', () => {
    const source = ["fetch(apiBase + '/users/' + id);"].join('\n');
    const bundle = fetchConsumerAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/api.js'],
      fileCache: new Map([['src/api.js', source]]),
    });
    const fact = bundle.facts.find(isHttpConsumerFact);
    assert.ok(fact);
    assert.equal(fact.url.isFullyStatic, false);
    assert.ok(fact.coverage.boundaryReasons.includes('dynamic-url-expression'));
  });

  it('does not extract anything for a fully opaque URL expression (built by a function call)', () => {
    const source = ["fetch(buildUrl(config));"].join('\n');
    const bundle = fetchConsumerAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/api.js'],
      fileCache: new Map([['src/api.js', source]]),
    });
    const fact = bundle.facts.find(isHttpConsumerFact);
    assert.ok(fact, 'a consumer fact is still emitted (a real call site exists)');
    assert.equal(fact.url.isFullyStatic, false);
    assert.equal(fact.url.literalSegments.length, 0, 'must not guess segments for an opaque expression');
  });

  it('resolves an axios.create() baseURL client and its generic response type', () => {
    const source = [
      "const client = axios.create({ baseURL: 'https://api.example.com' });",
      "async function getUser(id) {",
      "  const response = await client.get<User>('/users/' + id);",
      "  return response.data;",
      "}",
    ].join('\n');
    const bundle = axiosConsumerAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/api.ts'],
      fileCache: new Map([['src/api.ts', source]]),
    });
    const fact = bundle.facts.find(isHttpConsumerFact);
    assert.ok(fact);
    assert.equal(fact.method, 'GET');
    assert.equal(fact.url.basePath, 'https://api.example.com');
    assert.equal(fact.expectedResponseShapeSymbolRef, 'User');
  });

  it('does not treat an unrelated Map#get() call as an axios request', () => {
    const source = ["const cached = cache.get('users');"].join('\n');
    const bundle = axiosConsumerAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/cache.ts'],
      fileCache: new Map([['src/cache.ts', source]]),
    });
    assert.equal(bundle.facts.some(isHttpConsumerFact), false);
  });

  it('extracts an Angular HttpClient call and its subscribe() destructured keys', () => {
    const source = [
      "import { HttpClient } from '@angular/common/http';",
      '@Injectable()',
      'export class UsersService {',
      '  constructor(private http: HttpClient) {}',
      '  loadUser(id: string) {',
      "    this.http.get<UserDto>('/api/users/' + id).subscribe(({ id, name }) => {",
      '      this.userName = name;',
      '    });',
      '  }',
      '}',
    ].join('\n');
    const bundle = angularHttpConsumerAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/users.service.ts'],
      fileCache: new Map([['src/users.service.ts', source]]),
    });
    const fact = bundle.facts.find(isHttpConsumerFact);
    assert.ok(fact);
    assert.equal(fact.method, 'GET');
    assert.equal(fact.expectedResponseShapeSymbolRef, 'UserDto');
    assert.deepEqual([...fact.consumedKeys], ['id', 'name']);
  });

  it('does not extract HttpClient-shaped calls from a file that never imports HttpClient', () => {
    const source = ["this.http.get('/api/users').subscribe((users) => { console.log(users); });"].join('\n');
    const bundle = angularHttpConsumerAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/unrelated.ts'],
      fileCache: new Map([['src/unrelated.ts', source]]),
    });
    assert.equal(bundle.facts.some(isHttpConsumerFact), false);
  });
});
