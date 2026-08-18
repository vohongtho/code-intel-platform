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
});
