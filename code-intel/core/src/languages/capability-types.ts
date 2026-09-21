import { Language } from '../shared/languages.js';

export type CapabilityState = 'supported' | 'partial' | 'not-applicable' | 'unsupported';

export interface ResolverPerformanceContract {
  maxWorkspaceTraversalsPerPass: number;
  maxPreparedIndexBuildsPerPass: number;
  scalingBudget: number;
  depthScalingBudget?: number;
  candidateLookupBudget?: number;
  truncationBudget?: number;
  retainedHeapMiB?: number;
}

export interface LanguageCapabilityMatrix {
  definitions: CapabilityState;
  ownership: CapabilityState;
  imports: CapabilityState;
  exports: CapabilityState;
  calls: CapabilityState;
  references: CapabilityState;
  heritage: CapabilityState;
  typeHints: CapabilityState;
  controlFlow: CapabilityState;
  dataFlow: CapabilityState;
  embeddedLanguages: CapabilityState;
}

export interface LanguageCapabilityDescriptor {
  language: Language;
  extensions: readonly string[];
  grammarArtifact: string;
  devGrammarPackage: string;
  queryProvider?: () => string;
  adapterId: string;
  capabilities: LanguageCapabilityMatrix;
  resolutionPerformance?: ResolverPerformanceContract;
}
