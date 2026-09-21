import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../src/semantic/fact-bundle.js';
import { Language } from '../../../src/shared/languages.js';

describe('fact bundle', () => {
  it('sorts facts deterministically and keeps schema metadata', () => {
    const bundle = createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.TypeScript,
        adapterId: 'typescript',
        frameworkDetections: ['express', 'nest'],
      },
      facts: [
        {
          factId: 'b',
          language: Language.TypeScript,
          filePath: 'src/b.ts',
          sourceRange: { filePath: 'src/b.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
          declarationKind: 'function',
          name: 'b',
          anchors: {
            identity: { filePath: 'src/b.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
            render: { filePath: 'src/b.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
          },
        },
        {
          factId: 'a',
          language: Language.TypeScript,
          filePath: 'src/a.ts',
          sourceRange: { filePath: 'src/a.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
          declarationKind: 'function',
          name: 'a',
          anchors: {
            identity: { filePath: 'src/a.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
            render: { filePath: 'src/a.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
          },
        },
      ],
      diagnostics: [],
    });

    assert.equal(bundle.schema.version, FACT_SCHEMA_VERSION);
    assert.deepEqual(bundle.schema.frameworkDetections, ['express', 'nest']);
    assert.deepEqual(bundle.facts.map((fact) => fact.factId), ['a', 'b']);
  });
});
