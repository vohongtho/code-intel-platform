import type { RelationshipCertainty } from '../shared/index.js';
import type { ContextRenderMode } from './render-policy.js';

export type ContextDeliveryMode = 'full' | 'window' | 'pointer' | 'omitted';

export type ContextOmissionReason =
  | 'budget'
  | 'ambiguous'
  | 'missing-source'
  | 'stale-source'
  | 'lower-ranked'
  | 'hard-limit';

export interface ContextAllocationReceipt {
  artifactId: string;
  name: string;
  namedByUser: boolean;
  relevanceScore: number;
  certainty?: RelationshipCertainty;
  reservedTokens: number;
  deliveredTokens: number;
  deliveryMode: ContextDeliveryMode;
  omissionReason?: ContextOmissionReason;
  /** Render mode actually applied (present only when a render plan drove the entry). */
  renderMode?: ContextRenderMode;
  renderReason?: string;
  /** Capability boundary recorded when a requested mode degraded. */
  renderBoundary?: string;
  /** True when body detail was deliberately left out (skeleton/signature). */
  bodyOmitted?: boolean;
}

export interface ContextOmission {
  artifactId: string;
  name: string;
  reason: ContextOmissionReason;
}

/** Rank relationship/edge certainty for deterministic evidence ordering — exact first. */
export function certaintyRank(value: RelationshipCertainty | undefined): number {
  switch (value) {
    case 'exact': return 3;
    case 'candidate': return 2;
    case 'heuristic': return 1;
    default: return 0;
  }
}

/** Derive the compact omission list from allocation receipts (budget-side only; callers add selection-side omissions). */
export function omissionsFromReceipts(receipts: readonly ContextAllocationReceipt[]): ContextOmission[] {
  return receipts
    .filter((receipt) => receipt.deliveryMode === 'omitted')
    .map((receipt) => ({
      artifactId: receipt.artifactId,
      name: receipt.name,
      reason: receipt.omissionReason ?? 'budget',
    }));
}
