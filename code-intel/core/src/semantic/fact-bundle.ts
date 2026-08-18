import type { Language } from '../shared/languages.js';
import type { SemanticFact } from './facts.js';
import type { FactDiagnostic } from './diagnostics.js';
import { aggregateFactDiagnostics } from './diagnostics.js';

export const FACT_SCHEMA_VERSION = '1.0.11';

export interface FactSchemaMetadata {
  version: string;
  language: Language;
  adapterId: string;
  frameworkDetections?: readonly string[];
}

export interface FactBundle {
  schema: FactSchemaMetadata;
  facts: readonly SemanticFact[];
  diagnostics: readonly FactDiagnostic[];
}

function factSortKey(fact: SemanticFact): string {
  return JSON.stringify([fact.filePath, fact.sourceRange.startLine, fact.sourceRange.startColumn, fact.factId]);
}

export function createFactBundle(input: FactBundle): FactBundle {
  return {
    schema: {
      version: input.schema.version,
      language: input.schema.language,
      adapterId: input.schema.adapterId,
      frameworkDetections: input.schema.frameworkDetections ? [...input.schema.frameworkDetections].sort() : undefined,
    },
    facts: [...input.facts].sort((left, right) => factSortKey(left).localeCompare(factSortKey(right))),
    diagnostics: aggregateFactDiagnostics(input.diagnostics),
  };
}
