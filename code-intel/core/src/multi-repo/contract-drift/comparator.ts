import type { ContractDriftFinding } from '../types.js';
import type { ContractComparatorInput } from './common.js';
import { compareHttpContracts } from './http-comparator.js';
import { compareSchemaContracts } from './schema-comparator.js';
import { compareEventContracts } from './event-comparator.js';
import { compareGraphQLContracts } from './graphql-comparator.js';
import { compareGrpcContracts } from './grpc-comparator.js';
import { makeFinding } from './common.js';

export function compareContractVersions(input: ContractComparatorInput): ContractDriftFinding[] {
  switch (input.kind) {
    case 'route':
      return compareHttpContracts(input);
    case 'schema':
      return compareSchemaContracts(input);
    case 'event':
      return compareEventContracts(input);
    // Schema-backed protocol contracts compare by their versioned model; v1.0.11 flat contracts
    // (no `protocol` payload) degrade inside the comparator to `unknown` + `legacy-schema`.
    case 'graphql':
      return compareGraphQLContracts(input);
    case 'grpc':
      return compareGrpcContracts(input);
    case 'export': {
      const contractId = input.headVersion?.contractId ?? input.baseVersion?.contractId;
      const repositoryId = input.headVersion?.repositoryId ?? input.baseVersion?.repositoryId;
      if (!contractId || !repositoryId) return [];
      return [makeFinding({
        contractId,
        kind: input.kind,
        repositoryId,
        baseVersion: input.baseVersion,
        headVersion: input.headVersion,
        affectedConsumers: input.affectedConsumers ?? [],
        compatibility: 'unknown',
        changeKind: `${input.kind}-unsupported`,
        summary: `${input.kind} contract drift comparison is not implemented`,
        extraCoverageReasons: ['unsupported-contract-kind'],
      })];
    }
    default:
      return [];
  }
}
