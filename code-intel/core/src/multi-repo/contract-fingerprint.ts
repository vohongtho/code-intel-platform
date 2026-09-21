import { hashIdentityPayload, normalizeIdentityJson, normalizeRepoRelativePath } from '../identity/normalization.js';
import type { CodeNode } from '../shared/index.js';
import { routeFactFromNode } from '../semantic/api-contracts/index.js';
import { parseStructuredFields } from './contract-drift/common.js';
import type { Contract, ContractKind } from './types.js';

export const GROUP_CONTRACT_SCHEMA_VERSION = '1.0.11';

export interface ContractFingerprintParts {
  kind: ContractKind;
  name: string;
  signature?: string;
  parameters?: readonly { name: string; type?: string }[];
  returnType?: string;
  method?: string;
  normalizedPath?: string;
  sourceCanonicalId?: string;
  semantic?: Record<string, unknown>;
}

function normalizeMethod(method?: string): string | undefined {
  const value = method?.trim().toUpperCase();
  return value || undefined;
}

function normalizeParams(parameters?: readonly { name: string; type?: string }[]): readonly { name: string; type?: string }[] | undefined {
  if (!parameters || parameters.length === 0) return undefined;
  return [...parameters]
    .map((parameter) => ({ name: parameter.name.trim(), type: parameter.type?.trim() || undefined }))
    .sort((left, right) => left.name.localeCompare(right.name) || (left.type ?? '').localeCompare(right.type ?? ''));
}

export function canonicalContractFingerprintInput(parts: ContractFingerprintParts): Record<string, unknown> {
  return normalizeIdentityJson({
    schemaVersion: GROUP_CONTRACT_SCHEMA_VERSION,
    kind: parts.kind,
    name: parts.name.trim(),
    signature: parts.signature?.trim() || undefined,
    parameters: normalizeParams(parts.parameters),
    returnType: parts.returnType?.trim() || undefined,
    method: normalizeMethod(parts.method),
    normalizedPath: parts.normalizedPath?.trim() || undefined,
    sourceCanonicalId: parts.sourceCanonicalId ? normalizeRepoRelativePath(parts.sourceCanonicalId) : undefined,
    semantic: parts.semantic ?? undefined,
  }) as Record<string, unknown>;
}

export function computeSemanticContractFingerprint(parts: ContractFingerprintParts): string {
  return `group-contract-fingerprint:${hashIdentityPayload(canonicalContractFingerprintInput(parts))}`;
}

export function contractFingerprintFromContract(contract: Contract): ContractFingerprintParts {
  return {
    kind: contract.kind,
    name: contract.name,
    signature: contract.signature,
    parameters: contract.parameters,
    returnType: contract.returnType,
    method: contract.method,
    normalizedPath: contract.normalizedPath,
    sourceCanonicalId: contract.sourceCanonicalId ?? contract.nodeId ?? contract.filePath,
  };
}

/**
 * Structural payload folded into a contract's fingerprint so an unchanged fingerprint provably
 * implies unchanged comparator output — required for safe incremental recomparison (drift can
 * only skip deep comparison when this, not just the display name/signature, is unchanged).
 * Route contracts fold in the request/response shape fingerprints already computed by
 * semantic/api-contracts (content-derived, evidence-based); schema/event contracts fold in the
 * same statically parsed field list schema-comparator.ts / event-comparator.ts diff against.
 */
export function semanticFingerprintPayloadFromNode(node: CodeNode | undefined, kind: ContractKind): Record<string, unknown> | undefined {
  if (!node) return undefined;
  if (kind === 'route') {
    const route = routeFactFromNode(node);
    if (!route) return undefined;
    return {
      requestShapeRef: route.requestShapeRef ?? null,
      responses: [...route.responses]
        .map((response) => ({ status: response.status ?? null, responseShapeRef: response.responseShapeRef ?? null }))
        .sort((a, b) => String(a.status).localeCompare(String(b.status))),
    };
  }
  if (kind === 'schema' || kind === 'event') {
    const parsed = parseStructuredFields(node);
    return {
      resolved: parsed.incompleteReasons.length === 0,
      fields: [...(parsed.fields ?? [])]
        .map((field) => ({ key: field.key, required: field.required, typeText: field.typeText ?? null, enumValues: [...(field.enumValues ?? [])].sort() }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
  }
  return undefined;
}
