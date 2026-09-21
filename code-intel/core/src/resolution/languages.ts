import { Language } from '../shared/languages.js';

export interface ResolutionLanguageStrategy {
  language: Language;
  capabilityState: 'semantic-first' | 'partial' | 'legacy-fallback';
  supportedStrategies: readonly string[];
  unsupportedBoundaries: readonly string[];
}

const commonUnsupported = ['reflection', 'eval', 'runtime-generated dispatch'] as const;

export const RESOLUTION_LANGUAGE_STRATEGIES: Record<Language, ResolutionLanguageStrategy> = {
  [Language.TypeScript]: {
    language: Language.TypeScript,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'import-binding', 'public-surface', 'qualified-owner', 'receiver-type', 'inheritance-dispatch', 'registration-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'unproven structural callback dispatch'],
  },
  [Language.JavaScript]: {
    language: Language.JavaScript,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'import-binding', 'public-surface', 'qualified-owner', 'receiver-type', 'registration-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'prototype mutation'],
  },
  [Language.Python]: {
    language: Language.Python,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'import-binding', 'public-surface', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'monkey patching'],
  },
  [Language.Java]: {
    language: Language.Java,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'reflection-heavy framework wiring'],
  },
  [Language.Go]: {
    language: Language.Go,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'unsafe dynamic plugin resolution'],
  },
  [Language.C]: {
    language: Language.C,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding'],
    unsupportedBoundaries: [...commonUnsupported, 'macro-generated member dispatch'],
  },
  [Language.Cpp]: {
    language: Language.Cpp,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'template metaprogramming resolution'],
  },
  [Language.CSharp]: {
    language: Language.CSharp,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch', 'registration-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'runtime delegate composition'],
  },
  [Language.Rust]: {
    language: Language.Rust,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'macro expansion dependent dispatch'],
  },
  [Language.PHP]: {
    language: Language.PHP,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'magic __call dispatch'],
  },
  [Language.Kotlin]: {
    language: Language.Kotlin,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'reflection-based extension discovery'],
  },
  [Language.Ruby]: {
    language: Language.Ruby,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'qualified-owner', 'receiver-type'],
    unsupportedBoundaries: [...commonUnsupported, 'method_missing'],
  },
  [Language.Swift]: {
    language: Language.Swift,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'protocol witness runtime specialization'],
  },
  [Language.Dart]: {
    language: Language.Dart,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'mirror-based dispatch'],
  },
  [Language.HTML]: {
    language: Language.HTML,
    capabilityState: 'partial',
    supportedStrategies: ['public-surface', 'registration-dispatch'],
    unsupportedBoundaries: ['dynamic DOM event delegation outside extracted handlers', 'runtime-generated script bindings'],
  },
};

export function getResolutionLanguageStrategy(language: Language): ResolutionLanguageStrategy {
  return RESOLUTION_LANGUAGE_STRATEGIES[language];
}
