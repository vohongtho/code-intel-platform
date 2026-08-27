import type { CallSiteIdentityV1, DeclarationFragment } from './contracts.js';
import { hashIdentityPayload, normalizeRepoRelativePath } from './normalization.js';

export function normalizeCallSiteIdentity(identity: CallSiteIdentityV1): CallSiteIdentityV1 {
  return {
    version: 1,
    filePath: normalizeRepoRelativePath(identity.filePath),
    callerSymbolId: identity.callerSymbolId,
    range: {
      ...identity.range,
      filePath: normalizeRepoRelativePath(identity.range.filePath),
    },
    calleeText: identity.calleeText.trim(),
  };
}

export function generateCallSiteId(identity: CallSiteIdentityV1): string {
  return `callsite:v1:${hashIdentityPayload(normalizeCallSiteIdentity(identity))}`;
}

export function generateDeclarationFragmentId(fragment: Omit<DeclarationFragment, 'fragmentId'>): string {
  return `frag:v1:${hashIdentityPayload({
    symbolId: fragment.symbolId,
    filePath: normalizeRepoRelativePath(fragment.filePath),
    range: {
      ...fragment.range,
      filePath: normalizeRepoRelativePath(fragment.range.filePath),
    },
    partial: fragment.partial,
    hasBody: fragment.hasBody,
    role: fragment.role,
  })}`;
}
