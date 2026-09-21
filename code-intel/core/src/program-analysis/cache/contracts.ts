/**
 * cache/contracts.ts
 *
 * The program-analysis side cache/store: keyed by
 * `generateProgramAnalysisArtifactId` (task 1) — canonical function id +
 * body hash + artifact kind + the full `ProgramAnalysisFingerprint`
 * (program-analysis version, language lowering version, resolver version,
 * semantic graph fingerprint). Because the fingerprint is hashed *into*
 * the key itself, a stale semantic graph (a different
 * `semanticGraphFingerprint`) can never produce a false cache hit — it
 * simply misses and recomputes. No separate "is this still compatible
 * with Generation" check is needed on top of the key; that's what
 * "integrated with Generation capability metadata" means here: the
 * generation's own fingerprint is load-bearing in the key, not bolted on
 * as an afterthought.
 *
 * `get` still performs read-back verification of the stored value's own
 * internal structure (via the artifact kind's validator, where one
 * exists) before treating it as a hit — defense in depth against a
 * corrupted or partially-written entry, independent of key compatibility.
 */
import type { ProgramAnalysisArtifactKind } from '../contracts.js';

export interface ProgramAnalysisCacheEntry<T> {
  artifactId: string;
  kind: ProgramAnalysisArtifactKind;
  value: T;
  storedAt: string;
}

export interface ProgramAnalysisCacheStats {
  size: number;
  hits: number;
  misses: number;
  invalidReadBacks: number;
  evictions: number;
}

export interface ProgramAnalysisCache {
  /** Returns the cached value only if present AND it passes read-back verification; a failed verification evicts the entry. */
  get<T>(artifactId: string): T | undefined;
  set<T>(artifactId: string, kind: ProgramAnalysisArtifactKind, value: T): void;
  has(artifactId: string): boolean;
  delete(artifactId: string): void;
  clear(): void;
  stats(): ProgramAnalysisCacheStats;
}
