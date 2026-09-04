/**
 * contracts.ts
 *
 * Shared version/fingerprint/capability/identity contracts for the
 * program-analysis foundation (universal IR, CFG, dominators, data flow,
 * PDG, function summaries, taint). Every downstream module (ir/, cfg/,
 * dataflow/, pdg/, taint/, summaries/, cache/) builds on these types so
 * artifact identity and cache-key shape stay consistent end to end.
 */
import type { Language } from '../shared/languages.js';
import type { CapabilityState } from '../languages/capability-types.js';
import type { ResolutionCertainty } from '../resolution/contracts.js';
import { hashIdentityPayload } from '../identity/normalization.js';

/** Bumped whenever lowering/analysis semantics change in a way that invalidates prior cached artifacts. */
export const PROGRAM_ANALYSIS_VERSION = 'program-analysis-v1';

export type ProgramAnalysisArtifactKind =
  | 'ir'
  | 'cfg'
  | 'dominators'
  | 'control-dependence'
  | 'reaching-definitions'
  | 'def-use'
  | 'function-summary'
  | 'pdg'
  | 'taint-findings';

/**
 * Per-language, per-analysis-axis support. Kept independent from
 * `LanguageCapabilityMatrix` (languages/capability-types.ts) because the
 * axes here are finer-grained than that matrix's single `controlFlow`/
 * `dataFlow` fields and roll out on a different, staged schedule.
 */
export interface ProgramAnalysisCapabilityMatrix {
  ir: CapabilityState;
  cfg: CapabilityState;
  dominators: CapabilityState;
  reachingDefinitions: CapabilityState;
  functionSummary: CapabilityState;
  pdg: CapabilityState;
  taint: CapabilityState;
}

export interface ProgramAnalysisCapabilityDescriptor {
  language: Language;
  adapterId: string;
  loweringVersion: string;
  capabilities: ProgramAnalysisCapabilityMatrix;
}

/**
 * Identifies the compatibility surface an artifact was produced against.
 * Two artifacts are interchangeable only when every field matches exactly;
 * a mismatch on any field means "recompute", never "reuse and hope".
 */
export interface ProgramAnalysisFingerprint {
  programAnalysisVersion: string;
  languageLoweringVersion: string;
  resolverVersion: string;
  semanticGraphFingerprint?: string;
}

export function isProgramAnalysisFingerprintCompatible(
  candidate: ProgramAnalysisFingerprint,
  required: ProgramAnalysisFingerprint,
): boolean {
  return (
    candidate.programAnalysisVersion === required.programAnalysisVersion &&
    candidate.languageLoweringVersion === required.languageLoweringVersion &&
    candidate.resolverVersion === required.resolverVersion &&
    (required.semanticGraphFingerprint === undefined ||
      candidate.semanticGraphFingerprint === required.semanticGraphFingerprint)
  );
}

/** Canonical function identity an artifact is scoped to (the identity-v2 symbol ID) plus its content hash. */
export interface FunctionBodyIdentity {
  canonicalFunctionId: string;
  bodyHash: string;
}

export interface ProgramAnalysisCacheKeyInput extends FunctionBodyIdentity {
  kind: ProgramAnalysisArtifactKind;
  fingerprint: ProgramAnalysisFingerprint;
}

/**
 * Deterministic artifact ID / cache key. Identical inputs always produce the
 * same ID; any change to body hash, lowering version, program-analysis
 * version, or resolver/graph fingerprint mints a new one instead of
 * colliding with (and silently reusing) a stale artifact.
 */
export function generateProgramAnalysisArtifactId(input: ProgramAnalysisCacheKeyInput): string {
  return `pa:v1:${input.kind}:${hashIdentityPayload(input)}`;
}

/** Stable ID for an IR node scoped to its owning function artifact; index order is fixed by deterministic lowering. */
export function generateIrNodeId(functionArtifactId: string, localIndex: number): string {
  return `${functionArtifactId}:n${localIndex}`;
}

const CERTAINTY_RANK: Record<ResolutionCertainty, number> = {
  exact: 5,
  'candidate-set': 4,
  heuristic: 3,
  'external-boundary': 2,
  truncated: 1,
  unresolved: 0,
};

/**
 * Enforces "interprocedural certainty MUST not exceed call-graph certainty":
 * a data-flow/summary result crossing a call relationship can only be as
 * strong as the weakest call relationship it traversed.
 */
export function boundCertaintyByCallRelationship(
  analysisCertainty: ResolutionCertainty,
  callRelationshipCertainty: ResolutionCertainty,
): ResolutionCertainty {
  return CERTAINTY_RANK[analysisCertainty] <= CERTAINTY_RANK[callRelationshipCertainty]
    ? analysisCertainty
    : callRelationshipCertainty;
}
