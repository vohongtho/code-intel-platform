import { diffApiContracts, type KnownConsumer } from '../../semantic/api-contracts/compatibility.js';
import { routeFactFromNode, shapeFactFromNode } from '../../semantic/api-contracts/service.js';
import type { HttpRequestShapeFact, HttpResponseShapeFact } from '../../semantic/api-contracts/types.js';
import type { ContractDriftFinding } from '../types.js';
import type { ContractComparatorInput } from './common.js';
import { findContractNode, makeFinding } from './common.js';

export function compareHttpContracts(input: ContractComparatorInput): ContractDriftFinding[] {
  const baseNode = findContractNode(input.baseGraph, input.baseContract);
  const headNode = findContractNode(input.headGraph, input.headContract);
  const baseRoute = routeFactFromNode(baseNode!);
  const headRoute = routeFactFromNode(headNode!);
  const affectedConsumers = input.affectedConsumers ?? [];
  const routeId = input.headVersion?.contractId ?? input.baseVersion?.contractId;
  const repositoryId = input.headVersion?.repositoryId ?? input.baseVersion?.repositoryId;
  if (!routeId || !repositoryId) return [];

  const shapesByFingerprint = new Map<string, HttpRequestShapeFact | HttpResponseShapeFact>();
  for (const graph of [input.baseGraph, input.headGraph]) {
    if (!graph) continue;
    for (const node of graph.allNodes()) {
      const shape = shapeFactFromNode(node);
      if (shape) shapesByFingerprint.set(shape.shapeFingerprint, shape);
    }
  }

  const routeFactId = headRoute?.factId ?? baseRoute?.factId;
  const consumersByRouteFactId = new Map<string, readonly KnownConsumer[]>();
  if (routeFactId) {
    consumersByRouteFactId.set(routeFactId, affectedConsumers.map((consumer) => ({
      factId: consumer.sourceCanonicalId ?? consumer.consumerId,
      consumedKeys: consumer.consumedFields ?? [],
    })));
  }

  const findings = diffApiContracts({
    baseRoutes: baseRoute ? [baseRoute] : [],
    headRoutes: headRoute ? [headRoute] : [],
    shapesByFingerprint,
    consumersByRouteFactId,
    consumerCoverageComplete: affectedConsumers.length > 0 && affectedConsumers.every((consumer) => consumer.coverage?.complete !== false),
  });

  return findings.map((finding) => makeFinding({
    contractId: routeId,
    kind: 'route',
    repositoryId,
    baseVersion: input.baseVersion,
    headVersion: input.headVersion,
    affectedConsumers: affectedConsumers.filter((consumer) => finding.affectedConsumerFactIds.length === 0 || finding.affectedConsumerFactIds.includes(consumer.sourceCanonicalId ?? consumer.consumerId)),
    compatibility: finding.verdict,
    changeKind: finding.rule,
    summary: finding.reason,
    ruleEvidence: [finding.routeFactId, ...finding.affectedConsumerFactIds, ...(finding.fieldKey ? [finding.fieldKey] : [])],
    extraCoverageReasons: finding.boundaryReasons,
  }));
}
