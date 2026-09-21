import type { ContractDriftFinding } from '../types.js';
import type { ContractComparatorInput } from './common.js';
import { findContractNode, makeFinding, parseStructuredFields, typeCategoryChanged } from './common.js';

function subscribersUsingField(consumers: readonly NonNullable<ContractComparatorInput['affectedConsumers']>[number][], key: string) {
  return consumers.filter((consumer) => (consumer.consumedFields ?? []).includes(key));
}

export function compareEventContracts(input: ContractComparatorInput): ContractDriftFinding[] {
  const baseNode = findContractNode(input.baseGraph, input.baseContract);
  const headNode = findContractNode(input.headGraph, input.headContract);
  const baseParsed = parseStructuredFields(baseNode);
  const headParsed = parseStructuredFields(headNode);
  const baseFields = baseParsed.fields ?? [];
  const headFields = headParsed.fields ?? [];
  const affectedConsumers = input.affectedConsumers ?? [];
  const contractId = input.headVersion?.contractId ?? input.baseVersion?.contractId;
  const repositoryId = input.headVersion?.repositoryId ?? input.baseVersion?.repositoryId;
  if (!contractId || !repositoryId) return [];

  if (input.baseVersion && !input.headVersion) {
    return [makeFinding({
      contractId,
      kind: 'event',
      repositoryId,
      baseVersion: input.baseVersion,
      headVersion: input.headVersion,
      affectedConsumers,
      compatibility: affectedConsumers.length > 0 ? 'breaking' : 'unknown',
      changeKind: 'event-removed',
      summary: `event "${input.baseContract?.name ?? input.baseVersion.contractId}" no longer exists in head`,
      ruleEvidence: [baseNode?.identityId ?? baseNode?.id ?? ''],
      extraCoverageReasons: [...baseParsed.incompleteReasons],
    })];
  }
  if (!input.baseVersion || !input.headVersion) return [];

  const findings: ContractDriftFinding[] = [];
  const headByKey = new Map(headFields.map((field) => [field.key, field] as const));

  for (const baseField of baseFields) {
    const headField = headByKey.get(baseField.key);
    if (!headField) {
      const subscribers = subscribersUsingField(affectedConsumers, baseField.key);
      findings.push(makeFinding({
        contractId,
        kind: 'event',
        repositoryId,
        baseVersion: input.baseVersion,
        headVersion: input.headVersion,
        affectedConsumers: subscribers,
        compatibility: subscribers.length > 0 ? 'breaking' : 'unknown',
        changeKind: 'event-payload-field-removed',
        summary: `event payload field "${baseField.key}" was removed`,
        ruleEvidence: [baseField.key],
        extraCoverageReasons: [...baseParsed.incompleteReasons, ...headParsed.incompleteReasons],
      }));
      continue;
    }
    if (typeCategoryChanged(baseField, headField)) {
      const subscribers = subscribersUsingField(affectedConsumers, baseField.key);
      findings.push(makeFinding({
        contractId,
        kind: 'event',
        repositoryId,
        baseVersion: input.baseVersion,
        headVersion: input.headVersion,
        affectedConsumers: subscribers,
        compatibility: subscribers.length > 0 ? 'breaking' : 'unknown',
        changeKind: 'event-payload-field-type-changed',
        summary: `event payload field "${baseField.key}" changed type category from "${baseField.typeText ?? 'unknown'}" to "${headField.typeText ?? 'unknown'}"`,
        ruleEvidence: [baseField.key],
        extraCoverageReasons: [...baseParsed.incompleteReasons, ...headParsed.incompleteReasons],
      }));
    }
  }

  if (findings.length === 0 && (baseParsed.incompleteReasons.length > 0 || headParsed.incompleteReasons.length > 0)) {
    findings.push(makeFinding({
      contractId,
      kind: 'event',
      repositoryId,
      baseVersion: input.baseVersion,
      headVersion: input.headVersion,
      affectedConsumers,
      compatibility: 'unknown',
      changeKind: 'event-payload-unknown',
      summary: 'event payload could not be statically resolved',
      extraCoverageReasons: [...baseParsed.incompleteReasons, ...headParsed.incompleteReasons],
    }));
  }

  return findings;
}
