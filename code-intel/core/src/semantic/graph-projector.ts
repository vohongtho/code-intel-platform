import { generateEdgeId, generateNodeId } from '../graph/id-generator.js';
import type { CodeEdge, CodeNode, NodeKind } from '../shared/graph-types.js';
import type { FactBundle } from './fact-bundle.js';
import type { DeclarationFact, DependencyBindingFact, RegistrationFact, RouteFact, SemanticFact } from './facts.js';

function toNodeKind(kind: string): NodeKind {
  switch (kind) {
    case 'function':
    case 'class':
    case 'interface':
    case 'method':
    case 'constructor':
    case 'variable':
    case 'property':
    case 'struct':
    case 'enum':
    case 'trait':
    case 'namespace':
    case 'module':
    case 'type_alias':
    case 'constant':
    case 'route':
      return kind;
    default:
      return 'variable';
  }
}

function isDeclarationFact(fact: SemanticFact): fact is DeclarationFact {
  return 'declarationKind' in fact && 'name' in fact && 'anchors' in fact;
}

function isRouteFact(fact: SemanticFact): fact is RouteFact {
  return 'routeKind' in fact && 'path' in fact;
}

function isRegistrationFact(fact: SemanticFact): fact is RegistrationFact {
  return 'registrationKind' in fact && 'targetText' in fact && !('bindingKind' in fact);
}

function isDependencyBindingFact(fact: SemanticFact): fact is DependencyBindingFact {
  return 'bindingKind' in fact;
}

function evidenceLabel(fact: { framework?: string; frameworkEvidence?: { frameworkId: string; adapterVersion: string; registrationText?: string } }): string | undefined {
  if (!fact.frameworkEvidence) return fact.framework;
  const parts = [fact.frameworkEvidence.frameworkId, fact.frameworkEvidence.adapterVersion, fact.frameworkEvidence.registrationText].filter(Boolean);
  return parts.join(' | ');
}

export function projectFactBundle(bundle: FactBundle): { nodes: CodeNode[]; edges: CodeEdge[] } {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const declarationNodeIds = new Map<string, string>();

  for (const fact of bundle.facts) {
    if (!isDeclarationFact(fact)) continue;
    const nodeKind = toNodeKind(fact.declarationKind);
    const nodeId = generateNodeId(nodeKind, fact.filePath, fact.name);
    declarationNodeIds.set(fact.factId, nodeId);
    nodes.push({
      id: nodeId,
      kind: nodeKind,
      name: fact.name,
      filePath: fact.filePath,
      startLine: fact.anchors.identity.startLine,
      endLine: fact.anchors.identity.endLine,
      exported: fact.visibility?.level === 'public' ? true : undefined,
      metadata: {
        semantic: {
          factId: fact.factId,
          qualifiedName: fact.qualifiedName,
          anchors: fact.anchors,
          traits: fact.traits,
        },
      },
    });

    const fileNodeId = generateNodeId('file', fact.filePath, fact.filePath);
    edges.push({
      id: generateEdgeId(fileNodeId, nodeId, 'contains'),
      source: fileNodeId,
      target: nodeId,
      kind: 'contains',
      weight: 1,
    });
  }

  for (const fact of bundle.facts) {
    if (!isDeclarationFact(fact) || !fact.ownerRef) continue;
    const ownerId = declarationNodeIds.get(fact.ownerRef);
    const childId = declarationNodeIds.get(fact.factId);
    if (!ownerId || !childId) continue;
    edges.push({
      id: generateEdgeId(ownerId, childId, 'has_member'),
      source: ownerId,
      target: childId,
      kind: 'has_member',
      weight: 1,
    });
  }

  for (const fact of bundle.facts) {
    if (!isRouteFact(fact)) continue;
    const routeName = `${fact.method?.toUpperCase() ?? fact.routeKind} ${fact.path}`;
    const routeId = generateNodeId('route', fact.filePath, routeName);
    nodes.push({
      id: routeId,
      kind: 'route',
      name: routeName,
      filePath: fact.filePath,
      startLine: fact.sourceRange.startLine,
      endLine: fact.sourceRange.endLine,
      metadata: {
        semantic: {
          factId: fact.factId,
          framework: fact.framework,
          frameworkEvidence: fact.frameworkEvidence,
        },
      },
    });
    edges.push({
      id: generateEdgeId(generateNodeId('file', fact.filePath, fact.filePath), routeId, 'contains'),
      source: generateNodeId('file', fact.filePath, fact.filePath),
      target: routeId,
      kind: 'contains',
      weight: 1,
    });
    const handlerId = fact.handlerRef ? declarationNodeIds.get(fact.handlerRef) ?? generateNodeId('function', fact.filePath, fact.handlerRef.split(':').pop() ?? fact.handlerRef) : undefined;
    if (handlerId) {
      edges.push({
        id: generateEdgeId(routeId, handlerId, 'handles'),
        source: routeId,
        target: handlerId,
        kind: 'handles',
        weight: fact.frameworkEvidence?.exact ? 1 : 0.5,
        label: evidenceLabel(fact),
      });
    }
  }

  for (const fact of bundle.facts) {
    if (!isRegistrationFact(fact) || !fact.subjectRef) continue;
    const subjectId = declarationNodeIds.get(fact.subjectRef) ?? generateNodeId('function', fact.filePath, fact.subjectRef.split(':').pop() ?? fact.subjectRef);
    const targetId = generateNodeId('route', fact.filePath, `${fact.registrationKind} ${fact.targetText}`);
    nodes.push({
      id: targetId,
      kind: 'route',
      name: `${fact.registrationKind} ${fact.targetText}`,
      filePath: fact.filePath,
      startLine: fact.sourceRange.startLine,
      endLine: fact.sourceRange.endLine,
      metadata: { semantic: { factId: fact.factId, framework: fact.framework, frameworkEvidence: fact.frameworkEvidence } },
    });
    edges.push({
      id: generateEdgeId(targetId, subjectId, 'handles'),
      source: targetId,
      target: subjectId,
      kind: 'handles',
      weight: fact.frameworkEvidence?.exact ? 1 : 0.5,
      label: evidenceLabel(fact),
    });
  }

  for (const fact of bundle.facts) {
    if (!isDependencyBindingFact(fact) || !fact.contractRef || !fact.implementationRef) continue;
    const contractId = generateNodeId('interface', fact.filePath, fact.contractRef);
    const implId = generateNodeId('class', fact.filePath, fact.implementationRef);
    edges.push({
      id: generateEdgeId(contractId, implId, 'implements'),
      source: contractId,
      target: implId,
      kind: 'implements',
      weight: fact.frameworkEvidence?.exact ? 1 : 0.5,
      label: evidenceLabel(fact),
    });
  }

  return { nodes, edges };
}
