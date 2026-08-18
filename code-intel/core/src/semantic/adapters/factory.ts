import { getLanguageCapabilityDescriptor } from '../../languages/capability-registry.js';
import type { Language } from '../../shared/languages.js';
import { FACT_DIAGNOSTIC_CODES, type FactDiagnostic } from '../diagnostics.js';
import { FACT_SCHEMA_VERSION, createFactBundle, type FactBundle } from '../fact-bundle.js';
import type { AdapterExtractionContext, AdapterValidationResult, LanguageFactAdapter } from './adapter.js';

export function createCapabilityAdapter(language: Language): LanguageFactAdapter {
  const descriptor = getLanguageCapabilityDescriptor(language);

  return {
    adapterId: descriptor.adapterId,
    language,
    capabilities: descriptor.capabilities,
    extract(context: AdapterExtractionContext): FactBundle {
      const unsupported = Object.entries(descriptor.capabilities)
        .filter(([, state]) => state !== 'supported')
        .map(([capability, state]) => ({
          code: FACT_DIAGNOSTIC_CODES.partialCapability,
          severity: state === 'not-applicable' ? 'info' : 'warning',
          language,
          affectedCapability: capability,
          impact: capability === 'imports' || capability === 'exports' || capability === 'calls' || capability === 'heritage'
            ? 'cross-file'
            : 'local',
          filePath: context.filePath,
          message: `Adapter capability ${capability} is ${state}`,
        } satisfies FactDiagnostic));

      return createFactBundle({
        schema: {
          version: FACT_SCHEMA_VERSION,
          language,
          adapterId: descriptor.adapterId,
        },
        facts: [],
        diagnostics: unsupported,
      });
    },
    validate(bundle: FactBundle): AdapterValidationResult {
      return {
        ok: bundle.diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
        diagnostics: bundle.diagnostics,
      };
    },
  };
}
