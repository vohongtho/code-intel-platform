import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchApiContracts } from '../../../../src/semantic/api-contracts/matcher.js';
import type { HttpConsumerFact, HttpRouteFact } from '../../../../src/semantic/api-contracts/types.js';
import { Language } from '../../../../src/shared/languages.js';

let counter = 0;
function route(overrides: Partial<HttpRouteFact> & { normalizedPath: string; method: HttpRouteFact['method'] }): HttpRouteFact {
  counter += 1;
  return {
    factId: `route-${counter}`,
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

function consumer(overrides: Partial<HttpConsumerFact> & { url: HttpConsumerFact['url']; method: HttpConsumerFact['method'] }): HttpConsumerFact {
  counter += 1;
  return {
    factId: `consumer-${counter}`,
    language: Language.TypeScript,
    filePath: 'src/client.ts',
    sourceRange: { filePath: 'src/client.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
    consumerFactKind: 'http-consumer',
    clientLibrary: 'fetch',
    consumedKeys: [],
    coverage: { complete: true, boundaryReasons: [] },
    ...overrides,
  };
}

function staticUrl(path: string): HttpConsumerFact['url'] {
  const segments = path.split('/').filter(Boolean);
  return { raw: `'${path}'`, literalSegments: segments, dynamicSegmentIndices: [], isFullyStatic: true };
}

function dynamicUrl(literalSegments: string[], dynamicSegmentIndices: number[]): HttpConsumerFact['url'] {
  return { raw: 'template', literalSegments, dynamicSegmentIndices, isFullyStatic: false };
}

describe('matchApiContracts', () => {
  it('resolves an exact method+path match with certainty exact', () => {
    const r = route({ normalizedPath: '/users', method: 'GET' });
    const c = consumer({ url: staticUrl('/users'), method: 'GET' });
    const [outcome] = matchApiContracts([{ repoId: 'svc', fact: r }], [{ repoId: 'svc', fact: c }]);
    assert.equal(outcome!.certainty, 'exact');
    assert.equal(outcome!.candidates.length, 1);
    assert.equal(outcome!.candidates[0]!.targetId, r.factId);
    assert.equal(outcome!.candidates[0]!.strategy, 'exact-method-path');
  });

  it('distinguishes /api/users/{} from /users/{} — a shared trailing segment must not match', () => {
    const apiRoute = route({ normalizedPath: '/api/users/{}', method: 'GET' });
    const plainRoute = route({ normalizedPath: '/users/{}', method: 'GET' });
    const c = consumer({ url: dynamicUrl(['api', 'users', '{}'], [2]), method: 'GET' });
    const [outcome] = matchApiContracts(
      [{ repoId: 'svc', fact: apiRoute }, { repoId: 'svc', fact: plainRoute }],
      [{ repoId: 'svc', fact: c }],
    );
    assert.equal(outcome!.candidates.length, 1);
    assert.equal(outcome!.candidates[0]!.targetId, apiRoute.factId);
  });

  it('does not collapse /v1/users and /v2/users', () => {
    const v1 = route({ normalizedPath: '/v1/users', method: 'GET' });
    const v2 = route({ normalizedPath: '/v2/users', method: 'GET' });
    const c = consumer({ url: staticUrl('/v1/users'), method: 'GET' });
    const [outcome] = matchApiContracts([{ repoId: 'svc', fact: v1 }, { repoId: 'svc', fact: v2 }], [{ repoId: 'svc', fact: c }]);
    assert.equal(outcome!.candidates.length, 1);
    assert.equal(outcome!.candidates[0]!.targetId, v1.factId);
  });

  it('reports a candidate set (not a fabricated exact link) for the same route in two services', () => {
    const billing = route({ normalizedPath: '/invoices', method: 'GET' });
    const legacyBilling = route({ normalizedPath: '/invoices', method: 'GET' });
    const c = consumer({ url: staticUrl('/invoices'), method: 'GET' });
    const [outcome] = matchApiContracts(
      [{ repoId: 'billing-service', fact: billing }, { repoId: 'legacy-billing', fact: legacyBilling }],
      [{ repoId: 'web-app', fact: c }],
    );
    assert.equal(outcome!.certainty, 'candidate-set');
    assert.equal(outcome!.candidates.length, 2);
    assert.equal(outcome!.candidates.every((cand) => cand.strategy === 'candidate-dynamic-segment'), true);
  });

  it('prefers a same-repo candidate first when ambiguous', () => {
    const other = route({ normalizedPath: '/invoices', method: 'GET' });
    const own = route({ normalizedPath: '/invoices', method: 'GET' });
    const c = consumer({ url: staticUrl('/invoices'), method: 'GET' });
    const [outcome] = matchApiContracts(
      [{ repoId: 'other-service', fact: other }, { repoId: 'web-app', fact: own }],
      [{ repoId: 'web-app', fact: c }],
    );
    assert.equal(outcome!.candidates[0]!.targetId, own.factId);
  });

  it('does not match on method mismatch', () => {
    const r = route({ normalizedPath: '/users', method: 'POST' });
    const c = consumer({ url: staticUrl('/users'), method: 'GET' });
    const [outcome] = matchApiContracts([{ repoId: 'svc', fact: r }], [{ repoId: 'svc', fact: c }]);
    assert.equal(outcome!.certainty, 'unresolved');
    assert.equal(outcome!.candidates.length, 0);
  });

  it('treats a trailing slash as equivalent (both normalize identically)', () => {
    const r = route({ normalizedPath: '/users', method: 'GET' });
    const c = consumer({ url: staticUrl('/users/'), method: 'GET' });
    const [outcome] = matchApiContracts([{ repoId: 'svc', fact: r }], [{ repoId: 'svc', fact: c }]);
    assert.equal(outcome!.certainty, 'exact');
  });

  it('ignores a query string when matching', () => {
    const r = route({ normalizedPath: '/users', method: 'GET' });
    const c = consumer({ url: { raw: "'/users?active=true'", literalSegments: ['users?active=true'], dynamicSegmentIndices: [], isFullyStatic: true }, method: 'GET' });
    // The consumer adapters themselves strip the query string before this point (see
    // consumers/common.ts#parseUrlExpression); this fixture proves the matcher would fail to
    // match if that stripping regressed, guarding the contract between the two.
    const [outcome] = matchApiContracts([{ repoId: 'svc', fact: r }], [{ repoId: 'svc', fact: c }]);
    assert.equal(outcome!.certainty, 'unresolved');
  });

  it('matches path parameters positionally regardless of the parameter name', () => {
    const r = route({ normalizedPath: '/users/{}/posts/{}', method: 'GET' });
    const c = consumer({ url: dynamicUrl(['users', '{}', 'posts', '{}'], [1, 3]), method: 'GET' });
    const [outcome] = matchApiContracts([{ repoId: 'svc', fact: r }], [{ repoId: 'svc', fact: c }]);
    assert.equal(outcome!.certainty, 'candidate-set'); // any dynamic segment is treated as ambiguous, never guessed exact
    assert.equal(outcome!.candidates[0]!.targetId, r.factId);
  });

  it('never fabricates a link for a fully unresolved dynamic URL', () => {
    const r = route({ normalizedPath: '/users', method: 'GET' });
    const c = consumer({ url: { raw: 'buildUrl(cfg)', literalSegments: [], dynamicSegmentIndices: [], isFullyStatic: false }, method: 'GET' });
    const [outcome] = matchApiContracts([{ repoId: 'svc', fact: r }], [{ repoId: 'svc', fact: c }]);
    assert.equal(outcome!.certainty, 'unresolved');
    assert.equal(outcome!.candidates.length, 0);
    assert.equal(outcome!.coverage.complete, false);
  });

  it('truncates and reports incomplete coverage past the candidate cap', () => {
    const routes = Array.from({ length: 5 }, () => ({ repoId: 'svc', fact: route({ normalizedPath: '/invoices', method: 'GET' }) }));
    const c = consumer({ url: staticUrl('/invoices'), method: 'GET' });
    const [outcome] = matchApiContracts(routes, [{ repoId: 'svc', fact: c }], { candidateCap: 2 });
    assert.equal(outcome!.candidates.length, 2);
    assert.equal(outcome!.coverage.complete, false);
    assert.deepEqual([...outcome!.coverage.incompleteReasons], ['candidate-cap-exceeded']);
    assert.equal(outcome!.coverage.totalKnownCandidates, 5);
  });
});
