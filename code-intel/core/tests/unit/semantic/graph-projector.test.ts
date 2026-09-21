import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectFactBundle } from '../../../src/semantic/graph-projector.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../src/semantic/fact-bundle.js';
import { Language } from '../../../src/shared/languages.js';

describe('graph projector', () => {
  it('projects declaration facts into structural nodes and edges', () => {
    const bundle = createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.TypeScript,
        adapterId: 'typescript',
      },
      facts: [
        {
          factId: 'owner',
          language: Language.TypeScript,
          filePath: 'src/a.ts',
          sourceRange: { filePath: 'src/a.ts', startLine: 1, startColumn: 0, endLine: 3, endColumn: 1 },
          declarationKind: 'class',
          name: 'Owner',
          anchors: {
            identity: { filePath: 'src/a.ts', startLine: 1, startColumn: 0, endLine: 3, endColumn: 1 },
            render: { filePath: 'src/a.ts', startLine: 1, startColumn: 0, endLine: 3, endColumn: 1 },
          },
          visibility: { level: 'public' },
        },
        {
          factId: 'child',
          language: Language.TypeScript,
          filePath: 'src/a.ts',
          sourceRange: { filePath: 'src/a.ts', startLine: 2, startColumn: 2, endLine: 2, endColumn: 20 },
          declarationKind: 'method',
          name: 'child',
          ownerRef: 'owner',
          anchors: {
            identity: { filePath: 'src/a.ts', startLine: 2, startColumn: 2, endLine: 2, endColumn: 20 },
            render: { filePath: 'src/a.ts', startLine: 2, startColumn: 2, endLine: 2, endColumn: 20 },
          },
        },
      ],
      diagnostics: [],
    });

    const projected = projectFactBundle(bundle);
    assert.deepEqual(projected.nodes.map((node) => node.name).sort(), ['Owner', 'child']);
    assert.equal(projected.edges.some((edge) => edge.kind === 'contains'), true);
    assert.equal(projected.edges.some((edge) => edge.kind === 'has_member'), true);
  });

  it('projects framework route and binding facts into graph edges with evidence labels', () => {
    const bundle = createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.TypeScript,
        adapterId: 'framework:express',
        frameworkDetections: ['express'],
      },
      facts: [
        {
          factId: 'handler',
          language: Language.TypeScript,
          filePath: 'src/app.ts',
          sourceRange: { filePath: 'src/app.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 7 },
          declarationKind: 'function',
          name: 'listUsers',
          anchors: {
            identity: { filePath: 'src/app.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 7 },
            render: { filePath: 'src/app.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 7 },
          },
        },
        {
          factId: 'route',
          language: Language.TypeScript,
          filePath: 'src/app.ts',
          sourceRange: { filePath: 'src/app.ts', startLine: 2, startColumn: 0, endLine: 2, endColumn: 20 },
          routeKind: 'http',
          path: '/users',
          method: 'get',
          handlerRef: 'handler',
          framework: 'express',
          frameworkEvidence: { frameworkId: 'express', adapterVersion: '0.1.0', registrationText: 'app.get', exact: true },
        },
        {
          factId: 'binding',
          language: Language.TypeScript,
          filePath: 'src/app.ts',
          sourceRange: { filePath: 'src/app.ts', startLine: 3, startColumn: 0, endLine: 3, endColumn: 20 },
          bindingKind: 'contract-to-implementation',
          contractRef: 'IUserService',
          implementationRef: 'UserService',
          framework: 'nest',
          frameworkEvidence: { frameworkId: 'nest', adapterVersion: '0.1.0', registrationText: '@Module', exact: true },
        },
      ],
      diagnostics: [],
    });

    const projected = projectFactBundle(bundle);
    assert.equal(projected.nodes.some((node) => node.kind === 'route' && node.name === 'GET /users'), true);
    assert.equal(projected.edges.some((edge) => edge.kind === 'handles' && edge.label?.includes('express | 0.1.0')), true);
    assert.equal(projected.edges.some((edge) => edge.kind === 'implements' && edge.label?.includes('nest | 0.1.0')), true);
  });

  it('merges an HttpRouteFact onto the same route node as its RouteFact and links inline shapes', () => {
    const sourceRange = { filePath: 'src/app.ts', startLine: 2, startColumn: 0, endLine: 2, endColumn: 20 };
    const bundle = createFactBundle({
      schema: { version: FACT_SCHEMA_VERSION, language: Language.TypeScript, adapterId: 'framework:express', frameworkDetections: ['express'] },
      facts: [
        {
          factId: 'route',
          language: Language.TypeScript,
          filePath: 'src/app.ts',
          sourceRange,
          routeKind: 'http',
          path: '/users',
          method: 'get',
          framework: 'express',
          frameworkEvidence: { frameworkId: 'express', adapterVersion: '0.2.0', registrationText: 'app.get', exact: true },
        },
        {
          factId: 'http-route',
          language: Language.TypeScript,
          filePath: 'src/app.ts',
          sourceRange,
          routeFactKind: 'http-route',
          method: 'GET',
          path: '/users',
          normalizedPath: '/users',
          middlewareRefs: [],
          responses: [{ status: 200, responseShapeRef: 'fp1', evidence: 'exact' }],
          framework: 'express',
          coverage: { complete: true, boundaryReasons: [] },
        },
        {
          factId: 'response-shape',
          language: Language.TypeScript,
          filePath: 'src/app.ts',
          sourceRange,
          shapeFactKind: 'http-response-shape',
          status: 200,
          shapeFingerprint: 'fp1',
          origin: { kind: 'inline', fields: [{ key: 'id', required: true }] },
          coverage: { complete: true, boundaryReasons: [] },
        },
      ],
      diagnostics: [],
    });

    const projected = projectFactBundle(bundle);
    const routeNodes = projected.nodes.filter((node) => node.kind === 'route' && node.name === 'GET /users');
    assert.equal(routeNodes.length, 1, 'HttpRouteFact must merge onto the single existing route node, not duplicate it');
    const routeNode = routeNodes[0]!;
    assert.equal((routeNode.metadata as { apiContract?: { normalizedPath?: string } }).apiContract?.normalizedPath, '/users');

    const shapeNode = projected.nodes.find((node) => node.kind === 'api_shape');
    assert.ok(shapeNode);
    assert.equal(
      projected.edges.some((edge) => edge.kind === 'returns_shape' && edge.source === routeNode.id && edge.target === shapeNode.id),
      true,
    );
  });
});
