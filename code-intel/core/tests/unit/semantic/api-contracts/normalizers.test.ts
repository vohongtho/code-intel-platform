import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeRoutePrefix, normalizeHttpMethod, normalizeRoutePath, routeMatchKey } from '../../../../src/semantic/api-contracts/route-normalizer.js';
import { computeShapeFingerprint, findAddedFields, findRemovedFields, isSuccessStatus } from '../../../../src/semantic/api-contracts/shape-normalizer.js';
import { parseUrlExpression } from '../../../../src/semantic/api-contracts/consumers/common.js';

describe('route-normalizer', () => {
  it('normalizes :id, {id}, and <id> parameter spellings identically', () => {
    assert.equal(normalizeRoutePath('/users/:id').normalizedPath, '/users/{}');
    assert.equal(normalizeRoutePath('/users/{id}').normalizedPath, '/users/{}');
    assert.equal(normalizeRoutePath('/users/<id>').normalizedPath, '/users/{}');
  });

  it('treats a trailing slash as equivalent to no trailing slash', () => {
    assert.equal(normalizeRoutePath('/users/').normalizedPath, normalizeRoutePath('/users').normalizedPath);
  });

  it('strips a query string before normalizing', () => {
    assert.equal(normalizeRoutePath('/users?active=true').normalizedPath, '/users');
  });

  it('keeps distinct literal prefixes distinct', () => {
    assert.notEqual(normalizeRoutePath('/api/users/:id').normalizedPath, normalizeRoutePath('/users/:id').normalizedPath);
    assert.notEqual(normalizeRoutePath('/v1/users').normalizedPath, normalizeRoutePath('/v2/users').normalizedPath);
  });

  it('normalizes ALL/* method spellings to ANY, and unknown methods to ANY rather than fabricating one', () => {
    assert.equal(normalizeHttpMethod('all'), 'ANY');
    assert.equal(normalizeHttpMethod('*'), 'ANY');
    assert.equal(normalizeHttpMethod('get'), 'GET');
    assert.equal(normalizeHttpMethod(undefined), 'ANY');
  });

  it('composes nested router prefixes without producing double slashes', () => {
    assert.equal(composeRoutePrefix('/api/', '/users'), '/api/users');
    assert.equal(composeRoutePrefix('api', 'list'), 'api/list');
    assert.equal(composeRoutePrefix(undefined, '/users'), '/users');
  });

  it('produces a stable method+path match key', () => {
    assert.equal(routeMatchKey('GET', '/users/{}'), 'GET:/users/{}');
  });
});

describe('shape-normalizer', () => {
  it('produces the same fingerprint for the same fields regardless of declaration order', () => {
    const fpA = computeShapeFingerprint({ kind: 'inline', fields: [{ key: 'b', required: true }, { key: 'a', required: true }] });
    const fpB = computeShapeFingerprint({ kind: 'inline', fields: [{ key: 'a', required: true }, { key: 'b', required: true }] });
    assert.equal(fpA, fpB);
  });

  it('produces a different fingerprint when requiredness differs', () => {
    const fpA = computeShapeFingerprint({ kind: 'inline', fields: [{ key: 'a', required: true }] });
    const fpB = computeShapeFingerprint({ kind: 'inline', fields: [{ key: 'a', required: false }] });
    assert.notEqual(fpA, fpB);
  });

  it('classifies status codes', () => {
    assert.equal(isSuccessStatus(200), true);
    assert.equal(isSuccessStatus(404), false);
    assert.equal(isSuccessStatus('default'), true);
  });

  it('findAddedFields/findRemovedFields diff by key only, ignoring order and unrelated fields', () => {
    const base = [{ key: 'id', required: true }, { key: 'ssn', required: true }];
    const head = [{ key: 'name', required: true }, { key: 'id', required: true }];
    assert.deepEqual(findAddedFields(base, head).map((f) => f.key), ['name']);
    assert.deepEqual(findRemovedFields(base, head).map((f) => f.key), ['ssn']);
  });

  it('findAddedFields/findRemovedFields report nothing for identical field sets', () => {
    const fields = [{ key: 'id', required: true }];
    assert.deepEqual(findAddedFields(fields, fields), []);
    assert.deepEqual(findRemovedFields(fields, fields), []);
  });
});

describe('consumer url-expression parsing', () => {
  it('treats a trailing slash on a static URL the same as no trailing slash', () => {
    const withSlash = parseUrlExpression("'/users/'");
    const withoutSlash = parseUrlExpression("'/users'");
    assert.deepEqual([...withSlash.literalSegments], [...withoutSlash.literalSegments]);
  });

  it('strips a query string before splitting into segments', () => {
    const parsed = parseUrlExpression("'/users?active=true'");
    assert.deepEqual([...parsed.literalSegments], ['users']);
  });

  it('marks a template literal with interpolation as not fully static, but keeps the literal segments', () => {
    const parsed = parseUrlExpression('`/users/${id}`');
    assert.equal(parsed.isFullyStatic, false);
    assert.deepEqual([...parsed.literalSegments], ['users', '{}']);
    assert.deepEqual([...parsed.dynamicSegmentIndices], [1]);
  });
});
