import type { ContractDriftFinding } from '../types.js';
import type { ContractComparatorInput } from './common.js';
import { compareHttpContracts } from './http-comparator.js';
import { compareSchemaContracts } from './schema-comparator.js';
import { compareEventContracts } from './event-comparator.js';
import { makeFinding } from './common.js';

export function compareContractVersions(input: ContractComparatorInput): ContractDriftFinding[] {
  switch (input.kind) {
    case 'route':
      return compareHttpContracts(input);
    case 'schema':
      return compareSchemaContracts(input);
    case 'event':
      return compareEventContracts(input);
    case 'graphql':
    case 'grpc':
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
        summary: `${input.kind} contract drift comparison is not implemented in 1.0.11`,
        extraCoverageReasons: ['unsupported-contract-kind'],
      })];
    }
    default:
      return [];
  }
}
