import { hashIdentityPayload, normalizeRepoRelativePath, normalizeIdentityJson } from '../identity/normalization.js';
import type { Contract, ContractKind } from './types.js';

export interface ContractIdentityParts {
  repositoryId: string;
  repositoryName?: string;
  kind: ContractKind;
  name: string;
  method?: string;
  normalizedPath?: string;
  nodeId?: string;
  sourceCanonicalId?: string;
}

function normalizeMethod(method?: string): string | undefined {
  const value = method?.trim().toUpperCase();
  return value || undefined;
}

function normalizePath(path?: string): string | undefined {
  const value = path?.trim().replace(/\/+/g, '/');
  return value || undefined;
}

function normalizeContractName(name: string): string {
  return name.trim();
}

function fallbackCanonicalId(contract: Pick<ContractIdentityParts, 'kind' | 'nodeId' | 'name'>): string {
  if (contract.nodeId?.trim()) return contract.nodeId.trim();
  return `${contract.kind}:${normalizeContractName(contract.name)}`;
}

export function canonicalContractIdentity(parts: ContractIdentityParts): Record<string, unknown> {
  const common = {
    repositoryId: parts.repositoryId,
    kind: parts.kind,
  };

  if (parts.kind === 'route') {
    return normalizeIdentityJson({
      ...common,
      service: parts.sourceCanonicalId ?? parts.repositoryName ?? parts.repositoryId,
      method: normalizeMethod(parts.method) ?? 'ANY',
      normalizedPath: normalizePath(parts.normalizedPath) ?? normalizeContractName(parts.name),
    }) as Record<string, unknown>;
  }

  if (parts.kind === 'schema' || parts.kind === 'event' || parts.kind === 'graphql' || parts.kind === 'grpc') {
    return normalizeIdentityJson({
      ...common,
      declaredIdentity: parts.sourceCanonicalId ?? fallbackCanonicalId(parts),
    }) as Record<string, unknown>;
  }

  return normalizeIdentityJson({
    ...common,
    declaredIdentity: parts.sourceCanonicalId ?? fallbackCanonicalId(parts),
  }) as Record<string, unknown>;
}

export function getStableContractId(parts: ContractIdentityParts): string {
  return `group-contract:${parts.kind}:${hashIdentityPayload(canonicalContractIdentity(parts))}`;
}

export function contractIdentityFromContract(contract: Contract, repositoryId: string): ContractIdentityParts {
  return {
    repositoryId,
    repositoryName: contract.repoName,
    kind: contract.kind,
    name: normalizeContractName(contract.name),
    method: contract.method,
    normalizedPath: contract.normalizedPath,
    nodeId: contract.nodeId,
    sourceCanonicalId: contract.sourceCanonicalId
      ?? contract.nodeId
      ?? (contract.filePath ? `${normalizeRepoRelativePath(contract.filePath)}#${contract.name}` : contract.name),
  };
}
