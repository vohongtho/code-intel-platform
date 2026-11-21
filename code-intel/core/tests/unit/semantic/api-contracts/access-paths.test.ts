import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_PATH_LIMITS, formatAccessPath, parseAccessPath, trackAccessPaths } from '../../../../src/semantic/api-contracts/consumers/access-paths.js';
import { fetchConsumerAdapter } from '../../../../src/semantic/api-contracts/consumers/fetch.js';
import { axiosConsumerAdapter } from '../../../../src/semantic/api-contracts/consumers/axios.js';
import { angularHttpConsumerAdapter } from '../../../../src/semantic/api-contracts/consumers/angular-http.js';
import type { HttpConsumerFact } from '../../../../src/semantic/api-contracts/types.js';

const FETCH_ROOT = { kind: 'expression' as const, patternSource: 'await\\s+res\\.json\\(\\)' };

function paths(lines: string[], fromIndex = 1, root = FETCH_ROOT) {
  const result = trackAccessPaths(lines, fromIndex, root, 'src/a.ts');
  return { ...result, keys: result.paths.map((path) => formatAccessPath(path.path)) };
}

function consumerFact(adapter: typeof fetchConsumerAdapter, source: string): HttpConsumerFact {
  const bundle = adapter.extract({ workspaceRoot: '/repo', filePaths: ['src/a.ts'], fileCache: new Map([['src/a.ts', source]]) });
  const fact = bundle.facts.find((candidate) => (candidate as { consumerFactKind?: string }).consumerFactKind === 'http-consumer');
  assert.ok(fact);
  return fact as HttpConsumerFact;
}

describe('consumer access paths', () => {
  it('round-trips normalized path text', () => {
    assert.equal(formatAccessPath(['items', '[]', 'price']), 'items[].price');
    assert.deepEqual(parseAccessPath('items[].price'), ['items', '[]', 'price']);
    assert.deepEqual(parseAccessPath('user.profile.displayName'), ['user', 'profile', 'displayName']);
  });

  it('follows direct member access through an alias of the response', () => {
    const result = paths([
      'const res = await fetch("/api/users/1");',
      'const data = await res.json();',
      'console.log(data.user.profile.displayName);',
      'const id = data.user.id;',
      '}',
    ]);
    assert.deepEqual(result.keys, ['user.id', 'user.profile.displayName']);
    assert.equal(result.coverage.complete, true);
    assert.ok(result.paths.every((path) => path.certainty === 'exact'));
  });

  it('marks optional chaining and keeps the strictest optionality when mixed', () => {
    const result = paths([
      'const res = await fetch("/a");',
      'const data = await res.json();',
      'render(data?.user?.name);',
      'show(data?.meta?.total);',
      'log(data.meta.total);',
    ]);
    const byKey = new Map(result.paths.map((path) => [formatAccessPath(path.path), path]));
    assert.equal(byKey.get('user.name')?.optional, true);
    assert.equal(byKey.get('meta.total')?.optional, false);
  });

  it('reads renamed, defaulted and nested destructuring', () => {
    const result = paths([
      'const res = await fetch("/a");',
      'const { user: { id, profile: { displayName: name } }, total = 0, items: list } = await res.json();',
      'list.forEach((item) => use(item.price));',
    ]);
    assert.deepEqual(result.keys, ['items', 'items[].price', 'total', 'user', 'user.id', 'user.profile', 'user.profile.displayName']);
    const total = result.paths.find((path) => formatAccessPath(path.path) === 'total');
    assert.equal(total?.optional, true, 'a destructuring default guards absence');
  });

  it('normalizes array element access and for...of bindings to the [] segment', () => {
    const result = paths([
      'const res = await fetch("/a");',
      'const data = await res.json();',
      'const first = data.items[0].sku;',
      'for (const row of data.rows) { total += row.amount; }',
    ]);
    assert.deepEqual(result.keys, ['items[].sku', 'rows', 'rows[].amount']);
  });

  it('ends a path at builtin properties and method calls instead of inventing fields', () => {
    const result = paths([
      'const res = await fetch("/a");',
      'const data = await res.json();',
      'const n = data.items.length;',
      'const label = data.user.name.toUpperCase();',
    ]);
    assert.deepEqual(result.keys, ['items', 'user.name']);
  });

  it('reports a dynamic computed key as a coverage boundary, not a path', () => {
    const result = paths([
      'const res = await fetch("/a");',
      'const data = await res.json();',
      'const value = data.settings[key];',
    ]);
    assert.deepEqual(result.keys, ['settings']);
    assert.equal(result.paths[0]?.wholeValueUse, true);
    assert.equal(result.coverage.complete, false);
    assert.deepEqual(result.coverage.boundaryReasons, ['dynamic-computed-access']);
  });

  it('treats a literal bracket key like member access', () => {
    const result = paths(['const res = await fetch("/a");', 'const data = await res.json();', 'use(data["user"].id);']);
    assert.deepEqual(result.keys, ['user.id']);
  });

  it('caps alias propagation and reports local-data-flow-exceeded', () => {
    const lines = [
      'const res = await fetch("/a");',
      'const a = await res.json();',
      'const b = a.x;',
      'const c = b.y;',
      'const d = c.z;',
      'use(d.w);',
    ];
    const result = paths(lines);
    assert.equal(ACCESS_PATH_LIMITS.maxAliasDepth, 3);
    assert.ok(result.keys.includes('x.y.z'), 'the hop that hits the cap still records its own path');
    assert.ok(!result.keys.includes('x.y.z.w'), 'reads past the cap are not followed');
    assert.ok(result.coverage.boundaryReasons.includes('local-data-flow-exceeded'));
  });

  it('reports the whole response escaping the local scan as a boundary', () => {
    const result = paths(['const res = await fetch("/a");', 'const data = await res.json();', 'return data;']);
    assert.deepEqual(result.keys, []);
    assert.deepEqual(result.coverage.boundaryReasons, ['local-data-flow-exceeded']);
  });

  it('flags a field passed on whole while keeping its path', () => {
    const result = paths(['const res = await fetch("/a");', 'const { user } = await res.json();', 'renderUser(user);']);
    assert.deepEqual(result.keys, ['user']);
    assert.equal(result.paths[0]?.wholeValueUse, true);
    assert.equal(result.coverage.complete, true);
  });

  it('stops following a binding once it is reassigned and stops at the enclosing block end', () => {
    const result = paths([
      'const res = await fetch("/a");',
      'let data = await res.json();',
      'use(data.before);',
      'data = other();',
      'use(data.after);',
      '}',
      'const data2 = 1; use(data.outside);',
    ]);
    assert.deepEqual(result.keys, ['before']);
    assert.equal(result.paths[0]?.certainty, 'candidate', 'a let binding may be reassigned out of view');
  });

  it('ignores identifiers inside string literals and comments', () => {
    const result = paths(['const res = await fetch("/a");', 'const data = await res.json();', 'log("data.quoted", data.ok); // data.hidden']);
    assert.deepEqual(result.keys, ['ok']);
  });
});

describe('consumer adapters emit consumedPaths', () => {
  it('fetch: nested access paths alongside unchanged consumedKeys', () => {
    const fact = consumerFact(fetchConsumerAdapter, [
      'async function load() {',
      '  const response = await fetch("/api/users/1");',
      '  const { user } = await response.json();',
      '  return user.profile?.displayName;',
      '}',
    ].join('\n'));
    assert.deepEqual([...fact.consumedKeys], ['user']);
    assert.deepEqual(fact.consumedPaths?.map((path) => formatAccessPath(path.path)), ['user', 'user.profile.displayName']);
    assert.equal(fact.consumedPaths?.find((path) => path.path.length === 3)?.optional, true);
    assert.equal(fact.consumedPathCoverage?.complete, true);
  });

  it('axios: paths under response.data', () => {
    const fact = consumerFact(axiosConsumerAdapter, [
      "import axios from 'axios';",
      'async function load() {',
      "  const resp = await axios.get('/api/orders');",
      '  return resp.data.items.map((item) => item.price);',
      '}',
    ].join('\n'));
    assert.deepEqual(fact.consumedPaths?.map((path) => formatAccessPath(path.path)), ['items', 'items[].price']);
  });

  it('angular: subscribe callback parameter scoped to the callback body', () => {
    const fact = consumerFact(angularHttpConsumerAdapter, [
      "import { HttpClient } from '@angular/common/http';",
      'export class UserService {',
      '  constructor(private http: HttpClient) {}',
      '  load() {',
      "    this.http.get<User>('/api/users/1').subscribe((user: User) => {",
      '      this.name = user.profile.displayName;',
      '    });',
      '    this.other = user.notTracked;',
      '  }',
      '}',
    ].join('\n'));
    assert.deepEqual(fact.consumedPaths?.map((path) => formatAccessPath(path.path)), ['profile.displayName']);
  });

  it('no response variable: consumedPaths stays absent (unknown), never an empty "reads nothing"', () => {
    const fact = consumerFact(fetchConsumerAdapter, "fetch('/api/ping');");
    assert.equal(fact.consumedPaths, undefined);
  });
});
