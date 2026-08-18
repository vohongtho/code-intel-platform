import type { LanguageCapabilityDescriptor } from '../../languages/capability-types.js';
import type { Language } from '../../shared/languages.js';
import type { FactBundle } from '../fact-bundle.js';
import type { FactDiagnostic } from '../diagnostics.js';

export interface AdapterExtractionContext {
  language: Language;
  filePath: string;
  workspaceRoot: string;
  source: string;
}

export interface AdapterValidationResult {
  ok: boolean;
  diagnostics: readonly FactDiagnostic[];
}

export interface LanguageFactAdapter {
  readonly adapterId: string;
  readonly language: Language;
  readonly capabilities: LanguageCapabilityDescriptor['capabilities'];
  extract(context: AdapterExtractionContext): FactBundle;
  validate(bundle: FactBundle): AdapterValidationResult;
}
