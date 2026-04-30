/**
 * Epic 7 — API Stability & Error Model
 *
 * Tests:
 *   ✅  OpenAPI spec validates against 3.1 schema (structural)
 *   ✅  Every /api/v1/ route appears in the OpenAPI spec
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openApiSpec } from '../../../src/http/openapi.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Collect every key inside an object that passes the predicate,
 * recursively walking plain objects.
 */
function collectValues<T>(obj: unknown, predicate: (v: unknown) => v is T): T[] {
  const results: T[] = [];
  if (typeof obj !== 'object' || obj === null) return results;
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (predicate(value)) results.push(value);
    else results.push(...collectValues(value, predicate));
  }
  return results;
}

const isString = (v: unknown): v is string => typeof v === 'string';

// ── OpenAPI 3.1 Structural Validation ─────────────────────────────────────────

describe('OpenAPI spec — validates against OpenAPI 3.1 structure', () => {
  const spec = openApiSpec as Record<string, unknown>;

  it('openapi field is exactly "3.1.0"', () => {
    assert.equal(spec['openapi'], '3.1.0');
  });

  it('info object has title and version strings', () => {
    const info = spec['info'] as Record<string, unknown>;
    assert.ok(typeof info === 'object' && info !== null, 'info must be an object');
    assert.ok(typeof info['title'] === 'string' && info['title'].length > 0, 'info.title must be a non-empty string');
    assert.ok(typeof info['version'] === 'string' && info['version'].length > 0, 'info.version must be a non-empty string');
  });

  it('paths object exists and is a non-empty object', () => {
    const paths = spec['paths'] as Record<string, unknown>;
    assert.ok(typeof paths === 'object' && paths !== null, 'paths must be an object');
    assert.ok(Object.keys(paths).length > 0, 'paths must have at least one path');
  });

  it('every path key starts with "/"', () => {
    const paths = spec['paths'] as Record<string, unknown>;
    for (const key of Object.keys(paths)) {
      assert.ok(key.startsWith('/'), `Path key "${key}" must start with "/"`);
    }
  });

  it('every path item has at least one HTTP method object', () => {
    const validMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
    const paths = spec['paths'] as Record<string, Record<string, unknown>>;
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      const methods = Object.keys(pathItem).filter((k) => validMethods.has(k));
      assert.ok(methods.length > 0, `Path "${pathKey}" must have at least one HTTP method`);
    }
  });

  it('every operation has a non-empty responses object', () => {
    const validMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
    const paths = spec['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!validMethods.has(method)) continue;
        const responses = operation['responses'] as Record<string, unknown> | undefined;
        assert.ok(
          typeof responses === 'object' && responses !== null && Object.keys(responses).length > 0,
          `${method.toUpperCase()} ${pathKey} must have a non-empty responses object`,
        );
      }
    }
  });

  it('every operation summary is a non-empty string', () => {
    const validMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
    const paths = spec['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!validMethods.has(method)) continue;
        assert.ok(
          typeof operation['summary'] === 'string' && (operation['summary'] as string).length > 0,
          `${method.toUpperCase()} ${pathKey} must have a non-empty summary`,
        );
      }
    }
  });

  it('every operation tags array contains at least one string', () => {
    const validMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
    const paths = spec['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!validMethods.has(method)) continue;
        const tags = operation['tags'] as unknown[] | undefined;
        assert.ok(
          Array.isArray(tags) && tags.length > 0 && typeof tags[0] === 'string',
          `${method.toUpperCase()} ${pathKey} must have at least one tag`,
        );
      }
    }
  });

  it('all $ref values follow the #/components/... pattern', () => {
    const refs = collectValues(spec['paths'], isString).filter((v) => v.startsWith('#'));
    for (const ref of refs) {
      assert.ok(
        ref.startsWith('#/components/'),
        `$ref "${ref}" must start with "#/components/"`,
      );
    }
  });

  it('components.securitySchemes defines BearerAuth and SessionCookie', () => {
    const components = spec['components'] as Record<string, unknown>;
    assert.ok(typeof components === 'object' && components !== null, 'components must exist');
    const schemes = components['securitySchemes'] as Record<string, unknown>;
    assert.ok('BearerAuth' in schemes, 'BearerAuth security scheme must exist');
    assert.ok('SessionCookie' in schemes, 'SessionCookie security scheme must exist');
  });

  it('components.schemas includes ErrorResponse and CodeNode', () => {
    const components = spec['components'] as Record<string, unknown>;
    const schemas = components['schemas'] as Record<string, unknown>;
    assert.ok('ErrorResponse' in schemas, 'ErrorResponse schema must exist');
    assert.ok('CodeNode' in schemas, 'CodeNode schema must exist');
  });

  it('ErrorResponse schema has required error.code and error.message', () => {
    const components = spec['components'] as Record<string, Record<string, unknown>>;
    const errorResponse = components['schemas']['ErrorResponse'] as Record<string, unknown>;
    const errorProp = (errorResponse['properties'] as Record<string, Record<string, unknown>>)['error'];
    assert.ok(errorProp, 'ErrorResponse must have an error property');
    const required = errorProp['required'] as string[];
    assert.ok(Array.isArray(required), 'error.required must be an array');
    assert.ok(required.includes('code'), 'error.required must include "code"');
    assert.ok(required.includes('message'), 'error.required must include "message"');
  });

  it('all HTTP status codes in responses are string representations of valid codes', () => {
    const validMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
    const paths = spec['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    const validCodes = new Set(['200', '201', '204', '301', '302', '400', '401', '403', '404', '409', '413', '422', '429', '500', '503', 'default']);
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!validMethods.has(method)) continue;
        const responses = operation['responses'] as Record<string, unknown>;
        for (const code of Object.keys(responses)) {
          assert.ok(
            validCodes.has(code),
            `${method.toUpperCase()} ${pathKey} has unexpected status code "${code}"`,
          );
        }
      }
    }
  });
});

// ── Route Coverage — every /api/v1/ route appears in the spec ─────────────────

describe('OpenAPI spec — every /api/v1/ route appears in paths', () => {
  /**
   * The canonical set of /api/v1/ routes exposed by app.ts.
   * Express :param notation is mapped to OpenAPI {param} notation.
   *
   * Routes excluded intentionally:
   *   - GET /api/v1/openapi.json  → serves the spec itself, not a business route
   *   - GET /api/v1/docs          → dev-only Swagger UI HTML, not a JSON API
   */
  const appRoutes: Array<{ method: string; path: string }> = [
    { method: 'get',    path: '/health' },
    { method: 'get',    path: '/repos' },
    { method: 'get',    path: '/graph/{repo}' },
    { method: 'post',   path: '/search' },
    { method: 'post',   path: '/vector-search' },
    { method: 'get',    path: '/vector-status' },
    { method: 'post',   path: '/files/read' },
    { method: 'post',   path: '/grep' },
    { method: 'post',   path: '/cypher' },
    { method: 'get',    path: '/nodes/{id}' },
    { method: 'post',   path: '/blast-radius' },
    { method: 'get',    path: '/flows' },
    { method: 'get',    path: '/clusters' },
    { method: 'get',    path: '/jobs' },
    { method: 'delete', path: '/jobs/{id}' },
    { method: 'get',    path: '/groups' },
    { method: 'get',    path: '/groups/{name}' },
    { method: 'get',    path: '/groups/{name}/contracts' },
    { method: 'post',   path: '/groups/{name}/sync' },
    { method: 'post',   path: '/groups/{name}/search' },
    { method: 'get',    path: '/groups/{name}/graph' },
    { method: 'post',   path: '/query' },
    { method: 'post',   path: '/query/explain' },
  ];

  const paths = openApiSpec.paths as Record<string, Record<string, unknown>>;

  for (const { method, path } of appRoutes) {
    it(`${method.toUpperCase()} ${path} — path exists in spec`, () => {
      assert.ok(
        path in paths,
        `Path "${path}" is missing from openApiSpec.paths (routes present: ${Object.keys(paths).join(', ')})`,
      );
    });

    it(`${method.toUpperCase()} ${path} — HTTP method documented`, () => {
      const pathItem = paths[path];
      assert.ok(
        pathItem !== undefined,
        `Path "${path}" not found in spec`,
      );
      assert.ok(
        method in pathItem,
        `Method "${method}" not found for path "${path}" (available: ${Object.keys(pathItem).join(', ')})`,
      );
    });
  }

  it('spec has no undocumented paths (all spec paths match a known route)', () => {
    const specPaths = new Set(Object.keys(paths));
    const knownPaths = new Set(appRoutes.map((r) => r.path));
    for (const specPath of specPaths) {
      assert.ok(
        knownPaths.has(specPath),
        `Spec path "${specPath}" is not in the known appRoutes list — add it or remove from spec`,
      );
    }
  });
});
