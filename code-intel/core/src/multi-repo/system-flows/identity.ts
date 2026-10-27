/**
 * identity.ts
 *
 * Deterministic, content-derived system-flow identity:
 *   hash(SYSTEM_FLOW_VERSION + ordered segment identities + ordered boundary identities)
 *
 * A segment is identified by its repository plus its stable local flow
 * fingerprint (or canonical entry/exit IDs when no local flow exists); a
 * boundary by its contract ID and consumer ID. Nothing machine-local,
 * time-based or enumeration-based participates, so equal group semantics
 * yield equal identities across runs and machines, and any segment or
 * boundary change yields a different fingerprint.
 */

import crypto from 'node:crypto';
import { SYSTEM_FLOW_VERSION, type SystemFlowSegment } from './types.js';

export function systemFlowIdentity(segments: readonly SystemFlowSegment[]): { id: string; fingerprint: string } {
  const canonical = {
    version: SYSTEM_FLOW_VERSION,
    segments: segments.map((segment) => ({
      repositoryId: segment.repositoryId,
      local: segment.localFlowFingerprint ?? segment.localFlowId ?? null,
      entry: segment.localFlowFingerprint || segment.localFlowId ? null : segment.entrySymbolId,
      exit: segment.localFlowFingerprint || segment.localFlowId ? null : segment.exitSymbolId ?? null,
    })),
    boundaries: segments
      .map((segment) => segment.boundaryToNext)
      .filter((boundary) => boundary !== undefined)
      .map((boundary) => ({ contractId: boundary.contractId, consumerId: boundary.consumerId })),
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return { id: `sysflow:${fingerprint.slice(0, 24)}`, fingerprint };
}
