/**
 * cache/get-or-compute.ts
 *
 * The integration surface later tasks (internal routing from existing
 * security/context/inspect workflows) call: derive the fingerprint-bound
 * artifact id, serve a verified cache hit, or compute, store, and return.
 */
import { generateProgramAnalysisArtifactId, type ProgramAnalysisCacheKeyInput } from '../contracts.js';
import type { ProgramAnalysisCache } from './contracts.js';

export function getOrComputeArtifact<T>(cache: ProgramAnalysisCache, key: ProgramAnalysisCacheKeyInput, compute: () => T): T {
  const artifactId = generateProgramAnalysisArtifactId(key);
  const cached = cache.get<T>(artifactId);
  if (cached !== undefined) return cached;
  const value = compute();
  cache.set(artifactId, key.kind, value);
  return value;
}
