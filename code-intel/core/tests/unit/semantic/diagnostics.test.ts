import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFactDiagnostics, FACT_DIAGNOSTIC_CODES } from '../../../src/semantic/diagnostics.js';
import { Language } from '../../../src/shared/languages.js';

describe('fact diagnostics', () => {
  it('bounds repeated identical failures', () => {
    const aggregated = aggregateFactDiagnostics([
      {
        code: FACT_DIAGNOSTIC_CODES.partialCapability,
        severity: 'warning',
        language: Language.TypeScript,
        affectedCapability: 'calls',
        impact: 'cross-file',
        filePath: 'src/a.ts',
        message: 'Adapter capability calls is partial',
      },
      {
        code: FACT_DIAGNOSTIC_CODES.partialCapability,
        severity: 'warning',
        language: Language.TypeScript,
        affectedCapability: 'calls',
        impact: 'cross-file',
        filePath: 'src/a.ts',
        message: 'Adapter capability calls is partial',
      },
    ]);

    assert.equal(aggregated.length, 1);
    assert.equal(aggregated[0].count, 2);
  });
});
