import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import type { CodeNode } from '../../shared/index.js';
import type {
  Contract,
  ContractConsumerRef,
  ContractDriftCompatibility,
  ContractDriftFinding,
  GroupContractVersion,
  KnownConsumerCoverage,
} from '../types.js';
import type { AnalysisCoverage, AnalysisCertainty } from '../../shared/index.js';

export interface ContractComparatorInput {
  kind: Contract['kind'];
  baseVersion?: GroupContractVersion;
  headVersion?: GroupContractVersion;
  baseContract?: Contract;
  headContract?: Contract;
  baseGraph?: KnowledgeGraph;
  headGraph?: KnowledgeGraph;
  affectedConsumers?: readonly ContractConsumerRef[];
}

export interface ParsedField {
  key: string;
  required: boolean;
  typeText?: string;
  enumValues?: readonly string[];
}

function unionSorted(parts: readonly string[][]): string[] {
  return [...new Set(parts.flat().filter(Boolean))].sort();
}

/** Deterministic order (task 10.3): repository ID, then consumer ID, then source anchor —
 * matches contract-consumer-index.ts's sortRefs so a finding's `affectedConsumers` is never left
 * in whatever order the sync-time consumer index (or a filter over it) happened to produce. */
function sortConsumerRefs(refs: readonly ContractConsumerRef[]): ContractConsumerRef[] {
  return [...refs].sort((left, right) =>
    left.repositoryId.localeCompare(right.repositoryId)
    || left.consumerId.localeCompare(right.consumerId)
    || (left.sourceAnchor ?? '').localeCompare(right.sourceAnchor ?? ''),
  );
}

export function knownConsumerCoverage(affectedConsumers: readonly ContractConsumerRef[] = []): KnownConsumerCoverage {
  const complete = affectedConsumers.length === 0
    ? false
    : affectedConsumers.every((consumer) => consumer.coverage?.complete !== false);
  const totals = affectedConsumers.map((consumer) => consumer.coverage?.totalKnownCount).filter((n): n is number => typeof n === 'number');
  return {
    complete,
    inScope: complete ? 'group-sync' : 'partial-group-sync',
    certainty: affectedConsumers.some((consumer) => consumer.certainty === 'lower-bound' || consumer.coverage?.complete === false)
      ? 'lower-bound'
      : affectedConsumers.some((consumer) => consumer.certainty === 'heuristic')
        ? 'heuristic'
        : affectedConsumers.length > 0
          ? 'exact'
          : 'legacy',
    examinedConsumerCount: affectedConsumers.length,
    totalKnownConsumerCount: totals.length > 0 ? Math.max(...totals, affectedConsumers.length) : affectedConsumers.length,
    incompleteReasons: unionSorted(affectedConsumers.map((consumer) => [...(consumer.coverage?.incompleteReasons ?? [])])),
  };
}

export function aggregateCoverage(
  affectedConsumers: readonly ContractConsumerRef[] = [],
  extraReasons: readonly string[] = [],
): AnalysisCoverage {
  const consumerReasons = affectedConsumers.map((consumer) => [...(consumer.coverage?.incompleteReasons ?? [])]);
  const complete = extraReasons.length === 0 && affectedConsumers.every((consumer) => consumer.coverage?.complete !== false);
  return {
    complete,
    examinedCount: affectedConsumers.length,
    totalKnownCount: affectedConsumers.reduce((max, consumer) => Math.max(max, consumer.coverage?.totalKnownCount ?? 0), affectedConsumers.length),
    incompleteReasons: unionSorted([...consumerReasons, [...extraReasons]]),
  };
}

export function aggregateCertainty(
  affectedConsumers: readonly ContractConsumerRef[] = [],
  coverage?: AnalysisCoverage,
): AnalysisCertainty | 'legacy' {
  if (coverage?.complete === false || affectedConsumers.some((consumer) => consumer.certainty === 'lower-bound')) return 'lower-bound';
  if (affectedConsumers.some((consumer) => consumer.certainty === 'heuristic')) return 'heuristic';
  return affectedConsumers.length > 0 ? 'exact' : 'legacy';
}

export function makeFinding(input: {
  compatibility: ContractDriftCompatibility;
  changeKind: string;
  summary: string;
  ruleEvidence?: readonly string[];
  affectedConsumers?: readonly ContractConsumerRef[];
  extraCoverageReasons?: readonly string[];
  contractId: string;
  kind: Contract['kind'];
  repositoryId: string;
  baseVersion?: GroupContractVersion;
  headVersion?: GroupContractVersion;
}): ContractDriftFinding {
  const affectedConsumers = sortConsumerRefs(input.affectedConsumers ?? []);
  const coverage = aggregateCoverage(affectedConsumers, input.extraCoverageReasons ?? []);
  return {
    contractId: input.contractId,
    kind: input.kind,
    repositoryId: input.repositoryId,
    compatibility: input.compatibility,
    changeKind: input.changeKind,
    summary: input.summary,
    baseVersion: input.baseVersion,
    headVersion: input.headVersion,
    affectedConsumers,
    evidenceRefs: [...new Set([...(input.ruleEvidence ?? []), ...affectedConsumers.flatMap((consumer) => consumer.callSites ?? []), ...affectedConsumers.map((consumer) => consumer.sourceCanonicalId).filter(Boolean) as string[]])].sort(),
    certainty: aggregateCertainty(affectedConsumers, coverage),
    coverage,
    knownConsumerCoverage: knownConsumerCoverage(affectedConsumers),
  };
}

export function findContractNode(graph: KnowledgeGraph | undefined, contract: Contract | undefined): CodeNode | undefined {
  if (!graph || !contract) return undefined;
  for (const node of graph.allNodes()) {
    if (contract.sourceCanonicalId && (node.identityId === contract.sourceCanonicalId || node.id === contract.sourceCanonicalId)) return node;
    if (node.id === contract.nodeId) return node;
  }
  return undefined;
}

function stripComments(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, '$1');
}

function typeCategory(typeText: string | undefined): string {
  const t = (typeText ?? '').trim();
  if (!t) return 'unknown';
  if (t.includes('|')) return 'union';
  if (t.endsWith('[]') || /^Array\s*</.test(t) || /^ReadonlyArray\s*</.test(t)) return 'array';
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'null' || t === 'undefined') return t;
  if (t.startsWith('{') || /^Record\s*</.test(t) || /^Map\s*</.test(t)) return 'object';
  return 'nominal';
}

export function typeCategoryChanged(left: ParsedField, right: ParsedField): boolean {
  const baseType = typeCategory(left.typeText);
  const headType = typeCategory(right.typeText);
  return baseType !== 'unknown' && headType !== 'unknown' && baseType !== headType;
}

export function parseStructuredFields(node: CodeNode | undefined): { fields?: readonly ParsedField[]; incompleteReasons: string[] } {
  if (!node?.content) return { incompleteReasons: ['missing-contract-content'] };
  const content = stripComments(node.content);
  const bodyMatch = content.match(/\{([\s\S]*)\}/);
  if (!bodyMatch) return { incompleteReasons: ['unparsed-contract-structure'] };
  const body = bodyMatch[1];
  const fields: ParsedField[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim().replace(/[;,]$/, '');
    if (!line || line.startsWith('[') || line.startsWith('}')) continue;
    const enumMember = line.match(/^([A-Za-z_$][\w$]*)\s*(?:=\s*(.+))?$/);
    if (node.kind === 'enum' && enumMember) {
      fields.push({ key: enumMember[1], required: true, typeText: enumMember[2]?.trim(), enumValues: [enumMember[1]] });
      continue;
    }
    const prop = line.match(/^([A-Za-z_$][\w$]*)\??\s*:\s*(.+)$/);
    if (!prop) continue;
    const [, key, typeText] = prop;
    const enumValues = typeText.includes('|')
      ? typeText.split('|').map((part) => part.trim()).filter((part) => /^['"`].*['"`]$/.test(part)).map((part) => part.slice(1, -1))
      : [];
    fields.push({ key, required: !line.includes('?'), typeText: typeText.trim(), enumValues });
  }
  return fields.length > 0 ? { fields, incompleteReasons: [] } : { incompleteReasons: ['unparsed-contract-structure'] };
}
