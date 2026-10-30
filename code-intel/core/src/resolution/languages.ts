import { Language } from '../shared/languages.js';
import type { CapabilityState } from '../languages/capability-types.js';
import { RECEIVER_TYPE_LANGUAGE_ADAPTERS } from './receiver-types.js';

/**
 * What receiver dispatch (receiver-types.ts / dispatch.ts) can actually do
 * for a language in a real index, split into the engine's modeled
 * semantics and the evidence today's fact producers emit:
 *  - `engine`: a receiver-type language adapter exists (self receivers,
 *    constructor syntax, interface openness are modeled);
 *  - `receiverFacts`: call-site facts carry receiver text/type. No current
 *    semantic adapter emits them (the TypeScript adapter even skips
 *    `obj.method(` calls), so this is `unsupported` everywhere until an
 *    adapter is extended — receiver dispatch then runs only on facts that
 *    carry receiver evidence (e.g. imported fact bundles, tests);
 *  - `heritageFacts`: extends/implements/embedding facts for hierarchy
 *    expansion (regex adapters: C#, Go, Python only);
 *  - `registrationNarrowing`: DI facts with both contract and
 *    implementation (ASP.NET Core `Add*<I, T>()` only; Nest/Spring bindings
 *    name the contract but not the implementation).
 */
export interface DispatchEvidenceCapability {
  engine: CapabilityState;
  receiverFacts: CapabilityState;
  heritageFacts: CapabilityState;
  registrationNarrowing: CapabilityState;
  notes: readonly string[];
}

export interface ResolutionLanguageStrategy {
  language: Language;
  capabilityState: 'semantic-first' | 'partial' | 'legacy-fallback';
  supportedStrategies: readonly string[];
  unsupportedBoundaries: readonly string[];
  dispatchEvidence: DispatchEvidenceCapability;
}

const HERITAGE_FACT_LANGUAGES = new Set<Language>([Language.CSharp, Language.Go, Language.Python]);
const REGISTRATION_NARROWING_LANGUAGES = new Set<Language>([Language.CSharp]);

function dispatchEvidence(language: Language, notes: readonly string[] = []): DispatchEvidenceCapability {
  if (language === Language.HTML) {
    return { engine: 'not-applicable', receiverFacts: 'not-applicable', heritageFacts: 'not-applicable', registrationNarrowing: 'not-applicable', notes: ['no member dispatch'] };
  }
  const engine: CapabilityState = RECEIVER_TYPE_LANGUAGE_ADAPTERS[language] ? 'supported' : 'unsupported';
  return {
    engine,
    receiverFacts: 'unsupported',
    heritageFacts: HERITAGE_FACT_LANGUAGES.has(language) ? 'partial' : 'unsupported',
    registrationNarrowing: engine === 'supported' && REGISTRATION_NARROWING_LANGUAGES.has(language) ? 'partial' : 'unsupported',
    notes: [
      'semantic adapters do not emit call-site receiver facts yet; dispatch over a real index falls back to non-receiver strategies',
      ...(engine === 'unsupported' ? ['no receiver-type adapter: declared receiver types are used but results are never complete'] : []),
      ...notes,
    ],
  };
}

const commonUnsupported = ['reflection', 'eval', 'runtime-generated dispatch'] as const;

export const RESOLUTION_LANGUAGE_STRATEGIES: Record<Language, ResolutionLanguageStrategy> = {
  [Language.TypeScript]: {
    language: Language.TypeScript,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'import-binding', 'public-surface', 'qualified-owner', 'receiver-type', 'inheritance-dispatch', 'registration-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'unproven structural callback dispatch'],
    dispatchEvidence: dispatchEvidence(Language.TypeScript),
  },
  [Language.JavaScript]: {
    language: Language.JavaScript,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'import-binding', 'public-surface', 'qualified-owner', 'receiver-type', 'registration-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'prototype mutation'],
    dispatchEvidence: dispatchEvidence(Language.JavaScript),
  },
  [Language.Python]: {
    language: Language.Python,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'import-binding', 'public-surface', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'monkey patching'],
    dispatchEvidence: dispatchEvidence(Language.Python),
  },
  [Language.Java]: {
    language: Language.Java,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'reflection-heavy framework wiring'],
    dispatchEvidence: dispatchEvidence(Language.Java),
  },
  [Language.Go]: {
    language: Language.Go,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'unsafe dynamic plugin resolution'],
    dispatchEvidence: dispatchEvidence(Language.Go),
  },
  [Language.C]: {
    language: Language.C,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding'],
    unsupportedBoundaries: [...commonUnsupported, 'macro-generated member dispatch'],
    dispatchEvidence: dispatchEvidence(Language.C, ['function-pointer dispatch is unmodeled']),
  },
  [Language.Cpp]: {
    language: Language.Cpp,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'template metaprogramming resolution'],
    dispatchEvidence: dispatchEvidence(Language.Cpp, ['virtual dispatch through templates and function pointers is unmodeled']),
  },
  [Language.CSharp]: {
    language: Language.CSharp,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch', 'registration-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'runtime delegate composition'],
    dispatchEvidence: dispatchEvidence(Language.CSharp),
  },
  [Language.Rust]: {
    language: Language.Rust,
    capabilityState: 'semantic-first',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'macro expansion dependent dispatch'],
    dispatchEvidence: dispatchEvidence(Language.Rust),
  },
  [Language.PHP]: {
    language: Language.PHP,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'magic __call dispatch'],
    dispatchEvidence: dispatchEvidence(Language.PHP, ['magic __call dispatch is unmodeled']),
  },
  [Language.Kotlin]: {
    language: Language.Kotlin,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'reflection-based extension discovery'],
    dispatchEvidence: dispatchEvidence(Language.Kotlin, ['extension and reflection dispatch is unmodeled']),
  },
  [Language.Ruby]: {
    language: Language.Ruby,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'qualified-owner', 'receiver-type'],
    unsupportedBoundaries: [...commonUnsupported, 'method_missing'],
    dispatchEvidence: dispatchEvidence(Language.Ruby, ['method_missing and runtime method definition are unmodeled']),
  },
  [Language.Swift]: {
    language: Language.Swift,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'protocol witness runtime specialization'],
    dispatchEvidence: dispatchEvidence(Language.Swift, ['protocol witness specialization is unmodeled']),
  },
  [Language.Dart]: {
    language: Language.Dart,
    capabilityState: 'partial',
    supportedStrategies: ['lexical-scope', 'import-binding', 'qualified-owner', 'receiver-type', 'inheritance-dispatch'],
    unsupportedBoundaries: [...commonUnsupported, 'mirror-based dispatch'],
    dispatchEvidence: dispatchEvidence(Language.Dart, ['mirror-based dispatch is unmodeled']),
  },
  [Language.HTML]: {
    language: Language.HTML,
    capabilityState: 'partial',
    supportedStrategies: ['public-surface', 'registration-dispatch'],
    unsupportedBoundaries: ['dynamic DOM event delegation outside extracted handlers', 'runtime-generated script bindings'],
    dispatchEvidence: dispatchEvidence(Language.HTML),
  },
};

export function getResolutionLanguageStrategy(language: Language): ResolutionLanguageStrategy {
  return RESOLUTION_LANGUAGE_STRATEGIES[language];
}
