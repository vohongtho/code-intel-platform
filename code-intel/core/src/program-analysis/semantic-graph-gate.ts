/**
 * semantic-graph-gate.ts
 *
 * Gates any INTERPROCEDURAL program-analysis result (one that follows a
 * call edge to build a cross-function conclusion) behind the same
 * index-trust verification the rest of the platform already uses
 * (storage/index-trust.ts) — the identity-v2 / evidence-based-resolution /
 * relationship-certainty / Generation-semantic-verification gates this
 * proposal is hard-dependent on, expressed as one existing check rather
 * than a bespoke one.
 *
 * This foundation's own results (IR/CFG/dominators/dataflow/PDG/taint,
 * all intraprocedural — see summaries/build.ts's `calledCallees`, which
 * carries only raw callee text and explicitly no certainty claim) never
 * need this gate: they don't depend on cross-function resolution quality
 * at all. It exists for a FUTURE feature that would follow a call edge to
 * build a cross-function summary/PDG/taint result — that feature must
 * call this first, and default to gated-off when it doesn't get a
 * trusted graph back.
 */
import { verifyIndexTrust, type IndexTrustResult } from '../storage/index-trust.js';
import { boundCertaintyByCallRelationship } from './contracts.js';
import type { ResolutionCertainty } from '../resolution/contracts.js';

export interface InterproceduralGateResult {
  allowed: boolean;
  reason?: string;
  indexTrust: IndexTrustResult;
}

/**
 * `allowed` is false by default — only an explicitly `trusted` index
 * authorizes an interprocedural result; every other state (`stale`,
 * `corrupt`, `legacy`, `missing`) fails closed.
 */
export function gateInterproceduralAnalysis(repoDir: string): InterproceduralGateResult {
  const indexTrust = verifyIndexTrust(repoDir);
  if (!indexTrust.trusted) {
    return {
      allowed: false,
      reason: `semantic graph is not trusted (state: ${indexTrust.state}): ${indexTrust.reasons.join(', ') || 'no further detail available'}`,
      indexTrust,
    };
  }
  return { allowed: true, indexTrust };
}

export { boundCertaintyByCallRelationship };
export type { ResolutionCertainty };
