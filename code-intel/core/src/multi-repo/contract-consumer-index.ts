import type { Contract, ContractConsumerIndex, ContractConsumerRef, ContractLink } from './types.js';
import type { GraphFacts } from '../semantic/api-contracts/service.js';
import { DEFAULT_CANDIDATE_CAP, matchApiContracts } from '../semantic/api-contracts/matcher.js';
import type { ScopedFact } from '../semantic/api-contracts/matcher.js';
import type { HttpConsumerFact, HttpRouteFact } from '../semantic/api-contracts/types.js';

function coverageFromMatch(match: { coverage: { complete: boolean; emittedCandidates: number; totalKnownCandidates?: number; incompleteReasons: readonly string[] } }) {
  return {
    complete: match.coverage.complete,
    examinedCount: match.coverage.emittedCandidates,
    totalKnownCount: match.coverage.totalKnownCandidates,
    incompleteReasons: [...match.coverage.incompleteReasons],
  };
}

function certaintyFromMatch(match: { certainty: string; coverage: { complete: boolean } }): ContractConsumerRef['certainty'] {
  if (match.certainty === 'exact') return 'exact';
  return match.coverage.complete ? 'heuristic' : 'lower-bound';
}

function sortRefs(refs: readonly ContractConsumerRef[]): ContractConsumerRef[] {
  return [...refs].sort((left, right) =>
    left.repositoryId.localeCompare(right.repositoryId)
    || left.consumerId.localeCompare(right.consumerId)
    || (left.sourceAnchor ?? '').localeCompare(right.sourceAnchor ?? ''),
  );
}

function mergeCoverage(ref: ContractConsumerRef, coverage: NonNullable<ContractConsumerRef['coverage']>): ContractConsumerRef {
  const base = ref.coverage ?? { complete: true, examinedCount: 1, incompleteReasons: [] };
  return {
    ...ref,
    certainty: coverage.complete ? ref.certainty : 'lower-bound',
    coverage: {
      complete: base.complete && coverage.complete,
      examinedCount: Math.min(base.examinedCount, coverage.examinedCount),
      totalKnownCount: Math.max(base.totalKnownCount ?? base.examinedCount, coverage.totalKnownCount ?? coverage.examinedCount),
      incompleteReasons: [...new Set([...base.incompleteReasons, ...coverage.incompleteReasons])].sort(),
    },
  };
}

function capRefs(refs: readonly ContractConsumerRef[], maxConsumersPerContract: number): ContractConsumerRef[] {
  const ordered = sortRefs(refs);
  if (ordered.length <= maxConsumersPerContract) return ordered;
  const cappedCoverage = {
    complete: false,
    examinedCount: maxConsumersPerContract,
    totalKnownCount: ordered.length,
    incompleteReasons: ['consumer-cap-exceeded'],
  } as const;
  return ordered.slice(0, maxConsumersPerContract).map((ref) => mergeCoverage(ref, cappedCoverage));
}

export function buildContractConsumerIndex(input: {
  contracts: readonly Contract[];
  links: readonly ContractLink[];
  memberFacts: ReadonlyArray<{ repoId: string; repositoryName: string; facts: GraphFacts }>;
  maxConsumersPerContract?: number;
}): ContractConsumerIndex {
  const byContractId = new Map<string, ContractConsumerRef[]>();
  const bySemanticFingerprint = new Map<string, ContractConsumerRef[]>();
  const maxConsumersPerContract = Math.max(1, input.maxConsumersPerContract ?? DEFAULT_CANDIDATE_CAP);

  const routes: ScopedFact<HttpRouteFact>[] = [];
  const consumers: ScopedFact<HttpConsumerFact>[] = [];
  const consumerFactsById = new Map<string, { repoId: string; repositoryName: string; fact: HttpConsumerFact }>();
  for (const member of input.memberFacts) {
    for (const route of member.facts.routes) routes.push({ repoId: member.repoId, fact: route });
    for (const consumer of member.facts.consumers) {
      consumers.push({ repoId: member.repoId, fact: consumer });
      consumerFactsById.set(consumer.factId, { repoId: member.repoId, repositoryName: member.repositoryName, fact: consumer });
    }
  }

  const routeMatches = matchApiContracts(routes, consumers);
  const routeContractsBySourceId = new Map(
    input.contracts
      .filter((contract) => contract.kind === 'route' && contract.sourceCanonicalId && contract.contractId)
      .map((contract) => [contract.sourceCanonicalId!, contract] as const),
  );

  for (const match of routeMatches) {
    const consumer = consumerFactsById.get(match.referenceId);
    if (!consumer) continue;
    for (const candidate of match.candidates) {
      const contract = routeContractsBySourceId.get(candidate.targetId);
      if (!contract?.contractId) continue;
      const ref: ContractConsumerRef = {
        repositoryId: consumer.repoId,
        repositoryName: consumer.repositoryName,
        consumerId: consumer.fact.factId,
        sourceCanonicalId: consumer.fact.factId,
        sourceAnchor: `${consumer.fact.filePath}:${consumer.fact.sourceRange.startLine}`,
        certainty: certaintyFromMatch(match),
        confidence: candidate.confidence,
        consumedFields: consumer.fact.consumedKeys,
        callSites: [consumer.fact.factId],
        coverage: coverageFromMatch(match),
      };
      const byId = byContractId.get(contract.contractId) ?? [];
      byId.push(ref);
      byContractId.set(contract.contractId, byId);
      if (contract.semanticFingerprint) {
        const byFingerprint = bySemanticFingerprint.get(contract.semanticFingerprint) ?? [];
        byFingerprint.push(ref);
        bySemanticFingerprint.set(contract.semanticFingerprint, byFingerprint);
      }
    }
  }

  const contractsById = new Map(input.contracts.filter((contract) => contract.contractId).map((contract) => [contract.contractId!, contract]));
  for (const link of input.links) {
    if (!link.providerContractId) continue;
    const producer = contractsById.get(link.providerContractId);
    if (!producer) continue;

    let exactConsumer = link.consumerContractId ? contractsById.get(link.consumerContractId) : undefined;
    if (!exactConsumer && link.consumerSourceCanonicalId) {
      exactConsumer = input.contracts.find((contract) =>
        contract.repositoryId === link.consumerRepo
        && contract.sourceCanonicalId === link.consumerSourceCanonicalId,
      );
    }
    if (!exactConsumer) continue;

    const ref: ContractConsumerRef = {
      repositoryId: exactConsumer.repositoryId ?? link.consumerRepo,
      repositoryName: exactConsumer.repoName,
      consumerId: exactConsumer.contractId ?? exactConsumer.sourceCanonicalId ?? exactConsumer.name,
      sourceCanonicalId: exactConsumer.sourceCanonicalId ?? link.consumerSourceCanonicalId,
      sourceAnchor: exactConsumer.filePath,
      certainty: exactConsumer.kind === producer.kind ? 'exact' : (link.certainty ?? 'heuristic'),
      confidence: link.confidence,
      consumedFields: link.consumedFields,
      callSites: link.callSites,
      coverage: link.coverage ?? { complete: true, examinedCount: 1, incompleteReasons: [] },
    };
    byContractId.set(producer.contractId!, [...(byContractId.get(producer.contractId!) ?? []), ref]);
    if (producer.semanticFingerprint) {
      bySemanticFingerprint.set(producer.semanticFingerprint, [...(bySemanticFingerprint.get(producer.semanticFingerprint) ?? []), ref]);
    }
  }

  const dedupe = (refs: readonly ContractConsumerRef[]) => Object.values(Object.fromEntries(sortRefs(refs).map((ref) => [`${ref.repositoryId}\u0000${ref.consumerId}\u0000${ref.sourceAnchor ?? ''}`, ref])));

  return {
    byContractId: Object.fromEntries([...byContractId.entries()].map(([key, refs]) => [key, capRefs(dedupe(refs), maxConsumersPerContract)])),
    bySemanticFingerprint: Object.fromEntries([...bySemanticFingerprint.entries()].map(([key, refs]) => [key, capRefs(dedupe(refs), maxConsumersPerContract)])),
  };
}
