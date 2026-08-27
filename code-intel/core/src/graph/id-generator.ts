import { NodeKind } from '../shared/index.js';
import type { CallSiteIdentityV1, SymbolIdentityV2 } from '../identity/contracts.js';
import { generateCallSiteId } from '../identity/callsite-identity.js';
import { generateSymbolId } from '../identity/symbol-identity.js';

export function generateLegacyNodeId(kind: NodeKind, filePath: string, qualifiedName: string): string {
  return `${kind}:${filePath}:${qualifiedName}`;
}

export function generateNodeId(kind: NodeKind, filePath: string, qualifiedName: string): string {
  return generateLegacyNodeId(kind, filePath, qualifiedName);
}

export function generateNodeIdV2(identity: SymbolIdentityV2): string {
  return generateSymbolId(identity);
}

export function generateLegacyEdgeId(source: string, target: string, kind: string): string {
  return `${kind}:${source}->${target}`;
}

export function generateEdgeId(source: string, target: string, kind: string): string {
  return generateLegacyEdgeId(source, target, kind);
}

export function generateCallSiteEdgeId(source: string, target: string, kind: string, callSite: CallSiteIdentityV1): string {
  return `edge:v2:${kind}:${generateCallSiteId(callSite)}:${target}`;
}
