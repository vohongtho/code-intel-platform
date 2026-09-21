import type { Language } from '../shared/languages.js';
import type { SourceRange } from './anchors.js';

export const FACT_DIAGNOSTIC_CODES = {
  missingOwnerIdentity: 'missing-owner-identity',
  missingModuleIdentity: 'missing-module-identity',
  unsupportedSyntax: 'unsupported-syntax',
  partialCapability: 'partial-capability',
  droppedFact: 'dropped-fact',
} as const;

export type FactDiagnosticCode = (typeof FACT_DIAGNOSTIC_CODES)[keyof typeof FACT_DIAGNOSTIC_CODES];

export interface FactDiagnostic {
  code: FactDiagnosticCode;
  severity: 'info' | 'warning' | 'error';
  language: Language;
  affectedCapability: string;
  impact: 'local' | 'cross-file' | 'repository-wide';
  filePath?: string;
  sourceRange?: SourceRange;
  message?: string;
  count?: number;
}

function diagnosticKey(diagnostic: FactDiagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.severity,
    diagnostic.language,
    diagnostic.affectedCapability,
    diagnostic.impact,
    diagnostic.filePath ?? '',
    diagnostic.sourceRange?.filePath ?? '',
    diagnostic.sourceRange?.startLine ?? 0,
    diagnostic.sourceRange?.startColumn ?? 0,
    diagnostic.sourceRange?.endLine ?? 0,
    diagnostic.sourceRange?.endColumn ?? 0,
    diagnostic.message ?? '',
  ]);
}

export function aggregateFactDiagnostics(diagnostics: readonly FactDiagnostic[]): FactDiagnostic[] {
  const byKey = new Map<string, FactDiagnostic>();

  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    const existing = byKey.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      continue;
    }
    byKey.set(key, { ...diagnostic, count: diagnostic.count ?? 1 });
  }

  return [...byKey.values()].sort((left, right) => {
    return diagnosticKey(left).localeCompare(diagnosticKey(right));
  });
}
