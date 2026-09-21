import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffApiContracts } from '../../../../src/semantic/api-contracts/compatibility.js';
import type {
  HttpRequestShapeFact,
  HttpResponseShapeFact,
  HttpRouteFact,
  HttpShapeFieldFact,
} from '../../../../src/semantic/api-contracts/types.js';
import { Language } from '../../../../src/shared/languages.js';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function route(overrides: Partial<HttpRouteFact> & { normalizedPath: string; method: HttpRouteFact['method'] }): HttpRouteFact {
  return {
    factId: nextId('route'),
    language: Language.TypeScript,
    filePath: 'src/app.ts',
    sourceRange: { filePath: 'src/app.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
    routeFactKind: 'http-route',
    path: overrides.normalizedPath,
    handlerRef: undefined,
    middlewareRefs: [],
    responses: [],
    framework: 'express',
    coverage: { complete: true, boundaryReasons: [] },
    ...overrides,
  };
}

function inlineShape(
  kind: 'http-request-shape' | 'http-response-shape',
  fields: HttpShapeFieldFact[],
  status?: number,
): HttpRequestShapeFact | HttpResponseShapeFact {
  const factId = nextId('shape');
  const base = {
    factId,
    language: Language.TypeScript,
    filePath: 'src/app.ts',
    sourceRange: { filePath: 'src/app.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
    shapeFingerprint: factId,
    origin: { kind: 'inline' as const, fields },
    coverage: { complete: true, boundaryReasons: [] },
  };
  return kind === 'http-request-shape'
    ? { ...base, shapeFactKind: 'http-request-shape' }
    : { ...base, shapeFactKind: 'http-response-shape', status: status ?? 200 };
}

function shapeMap(...shapes: Array<HttpRequestShapeFact | HttpResponseShapeFact>): Map<string, HttpRequestShapeFact | HttpResponseShapeFact> {
  return new Map(shapes.map((shape) => [shape.shapeFingerprint, shape]));
}

describe('diffApiContracts', () => {
  it('flags route-removed as breaking when a known consumer exists', () => {
    const base = route({ normalizedPath: '/users', method: 'GET' });
    const findings = diffApiContracts({
      baseRoutes: [base],
      headRoutes: [],
      shapesByFingerprint: new Map(),
      consumersByRouteFactId: new Map([[base.factId, [{ factId: 'consumer-1', consumedKeys: [] }]]]),
      consumerCoverageComplete: true,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.rule, 'route-removed');
    assert.equal(findings[0]!.verdict, 'breaking');
    assert.deepEqual([...findings[0]!.affectedConsumerFactIds], ['consumer-1']);
  });

  it('reports route-removed as compatible only when consumer coverage is proven complete and empty', () => {
    const base = route({ normalizedPath: '/users', method: 'GET' });
    const complete = diffApiContracts({
      baseRoutes: [base], headRoutes: [], shapesByFingerprint: new Map(),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: true,
    });
    assert.equal(complete[0]!.verdict, 'compatible');

    const incomplete = diffApiContracts({
      baseRoutes: [base], headRoutes: [], shapesByFingerprint: new Map(),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: false,
    });
    assert.equal(incomplete[0]!.verdict, 'unknown');
  });

  it('flags a method change when the (method, path) pair disappears but the path survives under another method', () => {
    const base = route({ normalizedPath: '/users', method: 'DELETE' });
    const head = route({ normalizedPath: '/users', method: 'GET' });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head], shapesByFingerprint: new Map(),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: true,
    });
    assert.equal(findings.some((f) => f.rule === 'method-changed'), true);
  });

  it('flags a required request field addition as breaking when the head shape is fully resolved', () => {
    const baseShape = inlineShape('http-request-shape', [{ key: 'name', required: true }]);
    const headShape = inlineShape('http-request-shape', [{ key: 'name', required: true }, { key: 'email', required: true }]);
    const base = route({ normalizedPath: '/users', method: 'POST', requestShapeRef: baseShape.shapeFingerprint });
    const head = route({ normalizedPath: '/users', method: 'POST', requestShapeRef: headShape.shapeFingerprint });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head],
      shapesByFingerprint: shapeMap(baseShape, headShape),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: true,
    });
    const f = findings.find((x) => x.rule === 'request-field-added-required');
    assert.ok(f);
    assert.equal(f.verdict, 'breaking');
    assert.equal(f.fieldKey, 'email');
  });

  it('flags a request field type change as potentially-breaking', () => {
    const baseShape = inlineShape('http-request-shape', [{ key: 'age', required: true, type: { kind: 'nominal', text: 'number', name: 'number' } }]);
    const headShape = inlineShape('http-request-shape', [{ key: 'age', required: true, type: { kind: 'nominal', text: 'string', name: 'string' } }]);
    const base = route({ normalizedPath: '/users', method: 'POST', requestShapeRef: baseShape.shapeFingerprint });
    const head = route({ normalizedPath: '/users', method: 'POST', requestShapeRef: headShape.shapeFingerprint });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head],
      shapesByFingerprint: shapeMap(baseShape, headShape),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: true,
    });
    const f = findings.find((x) => x.rule === 'request-field-type-changed');
    assert.ok(f);
    assert.equal(f.verdict, 'potentially-breaking');
  });

  it('flags response-field-removed as breaking only for a resolved consumer that actually reads it', () => {
    const baseShape = inlineShape('http-response-shape', [{ key: 'id', required: true }, { key: 'ssn', required: true }], 200);
    const headShape = inlineShape('http-response-shape', [{ key: 'id', required: true }], 200);
    const base = route({ normalizedPath: '/users/{}', method: 'GET', responses: [{ status: 200, responseShapeRef: baseShape.shapeFingerprint, evidence: 'exact' }] });
    const head = route({ normalizedPath: '/users/{}', method: 'GET', factId: base.factId, responses: [{ status: 200, responseShapeRef: headShape.shapeFingerprint, evidence: 'exact' }] });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head],
      shapesByFingerprint: shapeMap(baseShape, headShape),
      consumersByRouteFactId: new Map([[head.factId, [{ factId: 'consumer-1', consumedKeys: ['ssn'] }]]]),
      consumerCoverageComplete: true,
    });
    const f = findings.find((x) => x.rule === 'response-field-removed');
    assert.ok(f);
    assert.equal(f.verdict, 'breaking');
    assert.deepEqual([...f.affectedConsumerFactIds], ['consumer-1']);
  });

  it('does not report response-field-removed as breaking when no known consumer reads it, but does not call it compatible unless coverage is proven complete', () => {
    const baseShape = inlineShape('http-response-shape', [{ key: 'id', required: true }, { key: 'internalFlag', required: true }], 200);
    const headShape = inlineShape('http-response-shape', [{ key: 'id', required: true }], 200);
    const base = route({ normalizedPath: '/users/{}', method: 'GET', responses: [{ status: 200, responseShapeRef: baseShape.shapeFingerprint, evidence: 'exact' }] });
    const head = route({ normalizedPath: '/users/{}', method: 'GET', factId: base.factId, responses: [{ status: 200, responseShapeRef: headShape.shapeFingerprint, evidence: 'exact' }] });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head],
      shapesByFingerprint: shapeMap(baseShape, headShape),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: false,
    });
    const f = findings.find((x) => x.rule === 'response-field-removed');
    assert.ok(f);
    assert.equal(f.verdict, 'unknown');
  });

  it('flags a response field type change and marks it breaking when a known consumer reads that field', () => {
    const baseShape = inlineShape('http-response-shape', [{ key: 'total', required: true, type: { kind: 'nominal', text: 'number', name: 'number' } }], 200);
    const headShape = inlineShape('http-response-shape', [{ key: 'total', required: true, type: { kind: 'nominal', text: 'string', name: 'string' } }], 200);
    const base = route({ normalizedPath: '/orders', method: 'GET', responses: [{ status: 200, responseShapeRef: baseShape.shapeFingerprint, evidence: 'exact' }] });
    const head = route({ normalizedPath: '/orders', method: 'GET', factId: base.factId, responses: [{ status: 200, responseShapeRef: headShape.shapeFingerprint, evidence: 'exact' }] });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head],
      shapesByFingerprint: shapeMap(baseShape, headShape),
      consumersByRouteFactId: new Map([[head.factId, [{ factId: 'consumer-1', consumedKeys: ['total'] }]]]),
      consumerCoverageComplete: true,
    });
    const f = findings.find((x) => x.rule === 'response-field-type-changed');
    assert.ok(f);
    assert.equal(f.verdict, 'breaking');
  });

  it('reports success-status-removed and never calls it compatible even with no known consumer', () => {
    const baseShape = inlineShape('http-response-shape', [{ key: 'id', required: true }], 201);
    const base = route({ normalizedPath: '/users', method: 'POST', responses: [{ status: 201, responseShapeRef: baseShape.shapeFingerprint, evidence: 'exact' }] });
    const head = route({ normalizedPath: '/users', method: 'POST', factId: base.factId, responses: [] });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head],
      shapesByFingerprint: shapeMap(baseShape),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: true,
    });
    const f = findings.find((x) => x.rule === 'success-status-removed');
    assert.ok(f);
    assert.notEqual(f.verdict, 'compatible');
  });

  it('treats an added optional response field as always compatible', () => {
    const baseShape = inlineShape('http-response-shape', [{ key: 'id', required: true }], 200);
    const headShape = inlineShape('http-response-shape', [{ key: 'id', required: true }, { key: 'nickname', required: false }], 200);
    const base = route({ normalizedPath: '/users', method: 'GET', responses: [{ status: 200, responseShapeRef: baseShape.shapeFingerprint, evidence: 'exact' }] });
    const head = route({ normalizedPath: '/users', method: 'GET', factId: base.factId, responses: [{ status: 200, responseShapeRef: headShape.shapeFingerprint, evidence: 'exact' }] });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head],
      shapesByFingerprint: shapeMap(baseShape, headShape),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: true,
    });
    const f = findings.find((x) => x.rule === 'response-field-added-optional');
    assert.ok(f);
    assert.equal(f.verdict, 'compatible');
  });

  it('reports unknown, never compatible, when a response shape cannot be statically resolved', () => {
    const base = route({ normalizedPath: '/users', method: 'GET', responses: [{ status: 200, evidence: 'unknown' }] });
    const head = route({ normalizedPath: '/users', method: 'GET', factId: base.factId, responses: [{ status: 200, evidence: 'unknown' }] });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head],
      shapesByFingerprint: new Map(),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: true,
    });
    // Both sides have a status-200 variant, but neither resolves to a shape: this must be
    // surfaced as unknown, never silently treated as "nothing changed" / safe.
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.verdict, 'unknown');
    assert.notEqual(findings[0]!.verdict, 'compatible');
  });

  it('reports nothing when a status genuinely has no variant on either side', () => {
    const base = route({ normalizedPath: '/users', method: 'GET', responses: [] });
    const head = route({ normalizedPath: '/users', method: 'GET', factId: base.factId, responses: [] });
    const findings = diffApiContracts({
      baseRoutes: [base], headRoutes: [head],
      shapesByFingerprint: new Map(),
      consumersByRouteFactId: new Map(), consumerCoverageComplete: true,
    });
    assert.equal(findings.length, 0);
  });

  it('never accidentally compares an unrelated same-name DTO from a different route', () => {
    // Two unrelated routes each reference a DTO literally named "Result", but the fingerprints
    // are route/file-local (as real producer adapters emit them) so they never collide.
    const routeAResponseBase = inlineShape('http-response-shape', [{ key: 'value', required: true }], 200);
    const routeAResponseHead = inlineShape('http-response-shape', [{ key: 'value', required: true }], 200);
    const routeBResponseBase = inlineShape('http-response-shape', [{ key: 'totallyDifferentField', required: true }], 200);
    const routeBResponseHead = inlineShape('http-response-shape', [{ key: 'totallyDifferentField', required: true }, { key: 'extra', required: true }], 200);

    const routeABase = route({ normalizedPath: '/a', method: 'GET', responses: [{ status: 200, responseShapeRef: routeAResponseBase.shapeFingerprint, evidence: 'exact' }] });
    const routeAHead = route({ normalizedPath: '/a', method: 'GET', factId: routeABase.factId, responses: [{ status: 200, responseShapeRef: routeAResponseHead.shapeFingerprint, evidence: 'exact' }] });
    const routeBBase = route({ normalizedPath: '/b', method: 'GET', responses: [{ status: 200, responseShapeRef: routeBResponseBase.shapeFingerprint, evidence: 'exact' }] });
    const routeBHead = route({ normalizedPath: '/b', method: 'GET', factId: routeBBase.factId, responses: [{ status: 200, responseShapeRef: routeBResponseHead.shapeFingerprint, evidence: 'exact' }] });

    const findings = diffApiContracts({
      baseRoutes: [routeABase, routeBBase],
      headRoutes: [routeAHead, routeBHead],
      shapesByFingerprint: shapeMap(routeAResponseBase, routeAResponseHead, routeBResponseBase, routeBResponseHead),
      consumersByRouteFactId: new Map(),
      consumerCoverageComplete: true,
    });

    // Route A had no shape change at all — must not pick up route B's added field.
    assert.equal(findings.some((f) => f.routeFactId === routeAHead.factId), false);
    // Route B's addition must be attributed only to route B.
    const routeBFinding = findings.find((f) => f.rule === 'response-field-added-optional');
    assert.ok(routeBFinding);
    assert.equal(routeBFinding.routeFactId, routeBHead.factId);
    assert.equal(routeBFinding.fieldKey, 'extra');
  });
});
