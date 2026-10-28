import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkConsumerResponseShapes, type ShapeCheckConsumer } from '../../../../src/semantic/api-contracts/shape-check.js';
import { parseAccessPath, type ConsumerAccessPath } from '../../../../src/semantic/api-contracts/consumers/access-paths.js';
import { parseInlineObjectKeys } from '../../../../src/semantic/api-contracts/producer-common.js';
import { fullApiCoverage, partialApiCoverage } from '../../../../src/semantic/api-contracts/types.js';
import type { HttpResponseShapeFact, HttpRouteFact, HttpShapeFieldFact } from '../../../../src/semantic/api-contracts/types.js';
import { Language } from '../../../../src/shared/languages.js';

const RANGE = { filePath: 'src/api.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 };

function shape(fingerprint: string, origin: HttpResponseShapeFact['origin'], complete = true): HttpResponseShapeFact {
  return {
    factId: `shape:${fingerprint}`,
    language: Language.TypeScript,
    filePath: 'src/server.ts',
    sourceRange: RANGE,
    shapeFactKind: 'http-response-shape',
    shapeFingerprint: fingerprint,
    origin,
    coverage: complete ? fullApiCoverage() : partialApiCoverage(['unresolved-dto']),
    status: 200,
  };
}

function inline(literal: string): HttpResponseShapeFact['origin'] {
  const parsed = parseInlineObjectKeys(literal);
  assert.ok(parsed);
  return { kind: 'inline', fields: parsed.fields };
}

function route(responses: HttpRouteFact['responses']): HttpRouteFact {
  return {
    factId: 'route:get-user',
    language: Language.TypeScript,
    filePath: 'src/server.ts',
    sourceRange: RANGE,
    routeFactKind: 'http-route',
    method: 'GET',
    path: '/users/:id',
    normalizedPath: '/users/{}',
    middlewareRefs: [],
    responses,
    framework: 'express',
    coverage: fullApiCoverage(),
  };
}

function access(path: string, extra: Partial<ConsumerAccessPath> = {}): ConsumerAccessPath {
  return { path: parseAccessPath(path), optional: false, sourceRange: { ...RANGE, startLine: 7 }, certainty: 'exact', ...extra };
}

function consumer(paths: ConsumerAccessPath[], extra: Partial<ShapeCheckConsumer> = {}): ShapeCheckConsumer {
  return { factId: 'consumer:1', filePath: 'src/api.ts', sourceRange: RANGE, consumedKeys: [], consumedPaths: paths, consumedPathCoverage: fullApiCoverage(), ...extra };
}

const NESTED = '{ user: { id: u.id, profile: { displayName: u.name } }, total: n }';

describe('checkConsumerResponseShapes', () => {
  it('records nested object literals in producer inline shapes', () => {
    const origin = inline(NESTED);
    assert.equal(origin.kind, 'inline');
    const user = (origin as { fields: readonly HttpShapeFieldFact[] }).fields.find((field) => field.key === 'user');
    assert.deepEqual(user?.nested?.map((field) => field.key), ['id', 'profile']);
  });

  it('exact nested read present in every success response: compatible', () => {
    const shapes = new Map([['s200', shape('s200', inline(NESTED))]]);
    const result = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]), [consumer([access('user.profile.displayName'), access('total')])], shapes);
    assert.equal(result.verdict, 'compatible');
    assert.deepEqual(result.findings.map((finding) => [finding.path, finding.verdict]), [['total', 'compatible'], ['user.profile.displayName', 'compatible']]);
    assert.equal(result.producerCoverage.complete, true);
    assert.equal(result.consumerCoverage.complete, true);
  });

  it('nested field removed with complete producer shape: breaking for an exact read', () => {
    const shapes = new Map([['s200', shape('s200', inline('{ user: { id: u.id, profile: { avatar: u.a } } }'))]]);
    const result = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]), [consumer([access('user.profile.displayName')])], shapes);
    assert.equal(result.verdict, 'breaking');
    assert.equal(result.findings[0]?.verdict, 'breaking');
    assert.deepEqual(result.findings[0]?.missingStatuses, [200]);
    assert.match(result.findings[0]!.reason, /user\.profile\.displayName/);
    assert.deepEqual(result.findings[0]?.evidence, ['src/api.ts:7', 's200']);
  });

  it('optional-chained read of a removed field is still reported as breaking, flagged optional', () => {
    const shapes = new Map([['s200', shape('s200', inline('{ user: { id: u.id } }'))]]);
    const result = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]), [consumer([access('user.nickname', { optional: true })])], shapes);
    assert.equal(result.findings[0]?.verdict, 'breaking');
    assert.equal(result.findings[0]?.optional, true);
  });

  it('non-exact consumer evidence can never prove a break', () => {
    const shapes = new Map([['s200', shape('s200', inline('{ id: x }'))]]);
    const candidateRead = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]), [consumer([access('name', { certainty: 'candidate' })])], shapes);
    assert.equal(candidateRead.findings[0]?.verdict, 'unknown');
    const candidateMatch = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]), [consumer([access('name')], { matchCertainty: 'candidate' })], shapes);
    assert.equal(candidateMatch.findings[0]?.verdict, 'unknown');
    assert.equal(candidateMatch.verdict, 'unknown');
  });

  it('unknown producer shape (symbol, partial or opaque nested value) yields unknown, never a pass', () => {
    const symbolShapes = new Map([['sym', shape('sym', { kind: 'symbol', symbolRef: 'UserDto', symbolName: 'UserDto' })]]);
    const symbolResult = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 'sym', evidence: 'exact' }]), [consumer([access('id')])], symbolShapes);
    assert.equal(symbolResult.verdict, 'unknown');
    assert.ok(symbolResult.producerCoverage.boundaryReasons.includes('unresolved-response-shape'));

    const partialShapes = new Map([['p', shape('p', inline('{ id: x }'), false)]]);
    const partial = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 'p', evidence: 'exact' }]), [consumer([access('name')])], partialShapes);
    assert.equal(partial.findings[0]?.verdict, 'unknown', 'a spread may still supply the field');

    const opaqueShapes = new Map([['o', shape('o', inline('{ user: loadUser() }'))]]);
    const opaque = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 'o', evidence: 'exact' }]), [consumer([access('user.email')])], opaqueShapes);
    assert.equal(opaque.findings[0]?.verdict, 'unknown');
    assert.match(opaque.findings[0]!.reason, /nested shape of "user"/);
  });

  it('path present in only some success variants is unknown; error variants are ignored', () => {
    const shapes = new Map([
      ['ok', shape('ok', inline('{ id: a, name: b }'))],
      ['created', shape('created', inline('{ id: a }'))],
      ['err', shape('err', inline('{ message: m }'))],
    ]);
    const result = checkConsumerResponseShapes(
      route([
        { status: 200, responseShapeRef: 'ok', evidence: 'exact' },
        { status: 201, responseShapeRef: 'created', evidence: 'exact' },
        { status: 404, responseShapeRef: 'err', evidence: 'exact' },
      ]),
      [consumer([access('id'), access('name')])],
      shapes,
    );
    const byPath = new Map(result.findings.map((finding) => [finding.path, finding]));
    assert.equal(byPath.get('id')?.verdict, 'compatible');
    assert.equal(byPath.get('name')?.verdict, 'unknown');
    assert.deepEqual(byPath.get('name')?.matchedStatuses, [200]);
    assert.deepEqual(byPath.get('name')?.missingStatuses, [201]);
    assert.equal(result.verdict, 'unknown');
  });

  it('incomplete consumer coverage keeps an otherwise clean result unknown', () => {
    const shapes = new Map([['s200', shape('s200', inline('{ id: x }'))]]);
    const result = checkConsumerResponseShapes(
      route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]),
      [consumer([access('id')], { consumedPathCoverage: partialApiCoverage(['dynamic-computed-access']) })],
      shapes,
    );
    assert.equal(result.findings[0]?.verdict, 'compatible');
    assert.equal(result.verdict, 'unknown');
    assert.deepEqual(result.consumerCoverage.boundaryReasons, ['dynamic-computed-access']);
  });

  it('a known object passed on whole leaves nested reads unverifiable', () => {
    const shapes = new Map([['s200', shape('s200', inline(NESTED))]]);
    const result = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]), [consumer([access('user', { wholeValueUse: true })])], shapes);
    assert.equal(result.verdict, 'unknown');
    assert.ok(result.consumerCoverage.boundaryReasons.includes('local-data-flow-exceeded'));
  });

  it('legacy consumer facts without consumedPaths fall back to top-level keys at partial coverage', () => {
    const shapes = new Map([['s200', shape('s200', inline('{ id: x }'))]]);
    const legacy: ShapeCheckConsumer = { factId: 'consumer:legacy', filePath: 'src/api.ts', sourceRange: RANGE, consumedKeys: ['name'] };
    const result = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]), [legacy], shapes);
    assert.equal(result.findings[0]?.verdict, 'breaking', 'top-level keys are still exact reads');
    assert.ok(result.consumerCoverage.boundaryReasons.includes('legacy-consumer-facts'));
  });

  it('no consumers or no success response is unknown', () => {
    const shapes = new Map([['s200', shape('s200', inline('{ id: x }'))]]);
    assert.equal(checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]), [], shapes).verdict, 'unknown');
    const noSuccess = checkConsumerResponseShapes(route([]), [consumer([access('id')])], shapes);
    assert.equal(noSuccess.verdict, 'unknown');
    assert.equal(noSuccess.findings[0]?.verdict, 'unknown');
  });

  it('array element paths stay unknown without an element shape', () => {
    const shapes = new Map([['s200', shape('s200', inline('{ items: rows }'))]]);
    const result = checkConsumerResponseShapes(route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]), [consumer([access('items[].price')])], shapes);
    assert.equal(result.findings[0]?.verdict, 'unknown');
  });

  it('orders findings breaking-first and truncates with an exact total', () => {
    const shapes = new Map([['s200', shape('s200', inline('{ a: 1, b: 2 }'))]]);
    const result = checkConsumerResponseShapes(
      route([{ status: 200, responseShapeRef: 's200', evidence: 'exact' }]),
      [consumer([access('a'), access('b'), access('gone')])],
      shapes,
      { maxFindings: 2 },
    );
    assert.equal(result.totalFindings, 3);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.findings.map((finding) => finding.path), ['gone', 'a']);
  });
});
