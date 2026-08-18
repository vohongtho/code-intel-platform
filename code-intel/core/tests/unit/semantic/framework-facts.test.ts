import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../src/semantic/fact-bundle.js';
import { Language } from '../../../src/shared/languages.js';

describe('framework semantic facts', () => {
  it('supports dependency binding facts and framework evidence', () => {
    const bundle = createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.TypeScript,
        adapterId: 'framework:nest',
        frameworkDetections: ['nest'],
      },
      facts: [
        {
          factId: 'binding:1',
          language: Language.TypeScript,
          filePath: 'src/app.ts',
          sourceRange: { filePath: 'src/app.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
          bindingKind: 'contract-to-implementation',
          contractRef: 'iface:Service',
          implementationRef: 'class:ServiceImpl',
          framework: 'nest',
          frameworkEvidence: {
            frameworkId: 'nest',
            adapterVersion: '0.1.0',
            registrationRef: 'reg:1',
            registrationText: '@Module providers',
            exact: true,
          },
        },
      ],
      diagnostics: [],
    });

    const fact = bundle.facts[0];
    assert.equal('bindingKind' in fact && fact.bindingKind, 'contract-to-implementation');
    assert.deepEqual(bundle.schema.frameworkDetections, ['nest']);
    assert.equal(fact.frameworkEvidence?.adapterVersion, '0.1.0');
  });
});
