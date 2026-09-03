import type { ContractDriftFinding } from '../types.js';
import type { ContractComparatorInput, ParsedField } from './common.js';
import { findContractNode, makeFinding, parseStructuredFields, typeCategoryChanged } from './common.js';

function consumersUsingField(consumers: readonly NonNullable<ContractComparatorInput['affectedConsumers']>[number][], key: string) {
  return consumers.filter((consumer) => (consumer.consumedFields ?? []).includes(key));
}

export function compareSchemaContracts(input: ContractComparatorInput): ContractDriftFinding[] {
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

  if (!input.baseVersion || !input.headVersion) {
    return [];
  }

  const findings: ContractDriftFinding[] = [];
  const baseByKey = new Map(baseFields.map((field) => [field.key, field] as const));
  const headByKey = new Map(headFields.map((field) => [field.key, field] as const));

  for (const baseField of baseFields) {
    const headField = headByKey.get(baseField.key);
    if (!headField) {
      const readers = consumersUsingField(affectedConsumers, baseField.key);
      findings.push(makeFinding({
        contractId,
        kind: 'schema',
        repositoryId,
        baseVersion: input.baseVersion,
        headVersion: input.headVersion,
        affectedConsumers: readers,
        compatibility: readers.length > 0 ? 'breaking' : affectedConsumers.length > 0 ? 'potentially-breaking' : 'unknown',
        changeKind: 'schema-property-removed',
        summary: `schema field "${baseField.key}" was removed`,
        ruleEvidence: [baseNode?.identityId ?? baseNode?.id ?? '', baseField.key],
        extraCoverageReasons: [...baseParsed.incompleteReasons, ...headParsed.incompleteReasons],
      }));
      continue;
    }
    if (!baseField.required && headField.required) {
      findings.push(makeFinding({
        contractId,
        kind: 'schema',
        repositoryId,
        baseVersion: input.baseVersion,
        headVersion: input.headVersion,
        affectedConsumers,
        compatibility: 'potentially-breaking',
        changeKind: 'schema-property-became-required',
        summary: `schema field "${baseField.key}" became required`,
        ruleEvidence: [headNode?.identityId ?? headNode?.id ?? '', baseField.key],
        extraCoverageReasons: [...baseParsed.incompleteReasons, ...headParsed.incompleteReasons],
      }));
    }
    if (typeCategoryChanged(baseField, headField)) {
      const readers = consumersUsingField(affectedConsumers, baseField.key);
      findings.push(makeFinding({
        contractId,
        kind: 'schema',
        repositoryId,
        baseVersion: input.baseVersion,
        headVersion: input.headVersion,
        affectedConsumers: readers.length > 0 ? readers : affectedConsumers,
        compatibility: readers.length > 0 ? 'breaking' : 'potentially-breaking',
        changeKind: 'schema-property-type-changed',
        summary: `schema field "${baseField.key}" changed type category from "${baseField.typeText ?? 'unknown'}" to "${headField.typeText ?? 'unknown'}"`,
        ruleEvidence: [baseField.key],
        extraCoverageReasons: [...baseParsed.incompleteReasons, ...headParsed.incompleteReasons],
      }));
    }
    if ((baseField.enumValues?.length ?? 0) > 0 && (headField.enumValues?.length ?? 0) > 0) {
      const removedValues = (baseField.enumValues ?? []).filter((value) => !(headField.enumValues ?? []).includes(value));
      if (removedValues.length > 0) {
        const readers = consumersUsingField(affectedConsumers, baseField.key);
        findings.push(makeFinding({
          contractId,
          kind: 'schema',
          repositoryId,
          baseVersion: input.baseVersion,
          headVersion: input.headVersion,
          affectedConsumers: readers.length > 0 ? readers : affectedConsumers,
          compatibility: readers.length > 0 ? 'breaking' : 'potentially-breaking',
          changeKind: 'schema-enum-narrowed',
          summary: `schema field "${baseField.key}" removed enum value(s): ${removedValues.join(', ')}`,
          ruleEvidence: [baseField.key, ...removedValues],
          extraCoverageReasons: [...baseParsed.incompleteReasons, ...headParsed.incompleteReasons],
        }));
      }
    }
  }

  for (const headField of headFields) {
    if (baseByKey.has(headField.key) || !headField.required) continue;
    findings.push(makeFinding({
      contractId,
      kind: 'schema',
      repositoryId,
      baseVersion: input.baseVersion,
      headVersion: input.headVersion,
      affectedConsumers,
      compatibility: 'potentially-breaking',
      changeKind: 'schema-property-added-required',
      summary: `schema requires new field "${headField.key}"`,
      ruleEvidence: [headField.key],
      extraCoverageReasons: [...baseParsed.incompleteReasons, ...headParsed.incompleteReasons],
    }));
  }

  if (findings.length === 0 && (baseParsed.incompleteReasons.length > 0 || headParsed.incompleteReasons.length > 0)) {
    findings.push(makeFinding({
      contractId,
      kind: 'schema',
      repositoryId,
      baseVersion: input.baseVersion,
      headVersion: input.headVersion,
      affectedConsumers,
      compatibility: 'unknown',
      changeKind: 'schema-structure-unknown',
      summary: 'schema structure could not be statically resolved',
      extraCoverageReasons: [...baseParsed.incompleteReasons, ...headParsed.incompleteReasons],
    }));
  }

  return findings;
}
