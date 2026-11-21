import crypto from 'node:crypto';

export const FLOW_IDENTITY_VERSION = 'flow-identity-v1';

export interface FlowIdentityInput {
  entryPointCanonicalId: string;
  stepCanonicalIds: readonly string[];
  callSiteIds?: readonly string[];
}

export interface FlowIdentity {
  flowId: string;
  flowFingerprint: string;
  algorithmVersion: typeof FLOW_IDENTITY_VERSION;
}

export function buildFlowIdentity(input: FlowIdentityInput): FlowIdentity {
  const flowFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    algorithmVersion: FLOW_IDENTITY_VERSION,
    entryPointCanonicalId: input.entryPointCanonicalId,
    stepCanonicalIds: input.stepCanonicalIds,
    callSiteIds: input.callSiteIds ?? [],
  })).digest('hex');

  return {
    flowId: `flow:${input.entryPointCanonicalId}:${flowFingerprint.slice(0, 16)}`,
    flowFingerprint,
    algorithmVersion: FLOW_IDENTITY_VERSION,
  };
}
