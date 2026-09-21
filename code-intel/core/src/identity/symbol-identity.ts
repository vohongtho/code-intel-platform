import type { SymbolIdentityV2 } from './contracts.js';
import {
  hashIdentityPayload,
  normalizeOwner,
  normalizeRepoRelativePath,
  normalizeSignatureDiscriminator,
} from './normalization.js';

export function normalizeSymbolIdentity(identity: SymbolIdentityV2): SymbolIdentityV2 {
  return {
    version: 2,
    language: identity.language,
    kind: identity.kind,
    filePath: identity.filePath ? normalizeRepoRelativePath(identity.filePath) : undefined,
    qualifiedName: normalizeOwner(identity.qualifiedName) ?? identity.qualifiedName,
    lexicalOwner: normalizeOwner(identity.lexicalOwner),
    signatureDiscriminator: normalizeSignatureDiscriminator(identity.signatureDiscriminator),
    declarationDiscriminator: normalizeSignatureDiscriminator(identity.declarationDiscriminator),
    qualifier: identity.qualifier ? {
      packagePath: identity.qualifier.packagePath ? normalizeRepoRelativePath(identity.qualifier.packagePath) : undefined,
      modulePath: identity.qualifier.modulePath ? normalizeRepoRelativePath(identity.qualifier.modulePath) : undefined,
      namespace: normalizeOwner(identity.qualifier.namespace),
      crate: normalizeOwner(identity.qualifier.crate),
      assembly: normalizeOwner(identity.qualifier.assembly),
      visibilityDomain: normalizeOwner(identity.qualifier.visibilityDomain),
    } : undefined,
  };
}

export function generateSymbolId(identity: SymbolIdentityV2): string {
  const normalized = normalizeSymbolIdentity(identity);
  return `sym:v2:${normalized.kind}:${hashIdentityPayload(normalized)}`;
}
