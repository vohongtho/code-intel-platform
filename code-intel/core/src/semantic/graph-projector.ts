import { generateEdgeId, generateNodeId, generateNodeIdV2 } from '../graph/id-generator.js';
import type { CodeEdge, CodeNode, NodeKind } from '../shared/graph-types.js';
import type { FactBundle } from './fact-bundle.js';
import type { DeclarationFact, DependencyBindingFact, RegistrationFact, RouteFact, SemanticFact, SignatureFact } from './facts.js';
import { serializeSourceRange } from './anchors.js';
import type { HttpConsumerFact, HttpRequestShapeFact, HttpResponseShapeFact, HttpRouteFact } from './api-contracts/types.js';

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

function isHttpRouteFact(fact: SemanticFact): fact is HttpRouteFact {
  return 'routeFactKind' in fact && fact.routeFactKind === 'http-route';
}

function isHttpShapeFact(fact: SemanticFact): fact is HttpRequestShapeFact | HttpResponseShapeFact {
  return 'shapeFactKind' in fact;
}

function isHttpConsumerFact(fact: SemanticFact): fact is HttpConsumerFact {
  return 'consumerFactKind' in fact && fact.consumerFactKind === 'http-consumer';
}

function routeCorrelationKey(filePath: string, method: string | undefined, path: string): string {
  return `${filePath}::${(method ?? 'any').trim().toLowerCase()}::${path}`;
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

function signatureDiscriminator(signature?: SignatureFact): string | undefined {
  if (!signature) return undefined;
  const params = signature.parameters.map((param) => `${param.name}:${param.type?.text ?? ''}${param.optional ? '?' : ''}${param.variadic ? '...' : ''}`).join(',');
  const returnType = signature.returnType?.text ?? '';
  return `(${params}):${returnType}`;
}

function declarationNodeId(fact: DeclarationFact): string {
  return generateNodeIdV2({
    version: 2,
    language: fact.language,
    kind: toNodeKind(fact.declarationKind),
    filePath: fact.filePath,
    qualifiedName: fact.qualifiedName ?? fact.name,
    lexicalOwner: fact.ownerRef,
    signatureDiscriminator: signatureDiscriminator(fact.signature),
    declarationDiscriminator: serializeSourceRange(fact.anchors.identity),
    qualifier: {
      visibilityDomain: fact.visibility?.level,
    },
  });
}

/**
 * Materializes inline (non-symbol) HTTP request/response shapes as their own nodes, keyed
 * by shape fingerprint, so route facts have a stable target to link ACCEPTS_SHAPE /
 * RETURNS_SHAPE edges to. A symbol-referenced shape has no synthetic node here; callers
 * resolve it against `declarationNodeIds` instead.
 */
function projectHttpShapeFacts(
  bundle: FactBundle,
  nodes: CodeNode[],
  edges: CodeEdge[],
): { shapeFactsByFingerprint: Map<string, HttpRequestShapeFact | HttpResponseShapeFact>; shapeNodeIdsByFingerprint: Map<string, string> } {
  const shapeFactsByFingerprint = new Map<string, HttpRequestShapeFact | HttpResponseShapeFact>();
  const shapeNodeIdsByFingerprint = new Map<string, string>();

  for (const fact of bundle.facts) {
    if (!isHttpShapeFact(fact)) continue;
    shapeFactsByFingerprint.set(fact.shapeFingerprint, fact);

    // Every shape fact (inline or symbol-origin) gets its own `api_shape` node — not just
    // inline ones. Without this, a symbol-origin shape (the primary path for typed NestJS/
    // ASP.NET Core DTOs) has no persisted representation at all once the graph is reopened,
    // silently making service.ts#collectGraphFacts unable to find it (real bug, caught by the
    // multi-framework integration test).
    const shapeId = generateNodeId('api_shape', fact.filePath, fact.shapeFingerprint);
    shapeNodeIdsByFingerprint.set(fact.shapeFingerprint, shapeId);
    nodes.push({
      id: shapeId,
      kind: 'api_shape',
      name: fact.shapeFactKind === 'http-request-shape' ? 'request shape' : 'response shape',
      filePath: fact.filePath,
      startLine: fact.sourceRange.startLine,
      endLine: fact.sourceRange.endLine,
      metadata: {
        semantic: {
          factId: fact.factId,
          language: fact.language,
          shapeFactKind: fact.shapeFactKind,
          shapeFingerprint: fact.shapeFingerprint,
          origin: fact.origin,
          coverage: fact.coverage,
          status: fact.shapeFactKind === 'http-response-shape' ? fact.status : undefined,
        },
      },
    });
    const fileNodeId = generateNodeId('file', fact.filePath, fact.filePath);
    edges.push({
      id: generateEdgeId(fileNodeId, shapeId, 'contains'),
      source: fileNodeId,
      target: shapeId,
      kind: 'contains',
      weight: 1,
    });
  }

  return { shapeFactsByFingerprint, shapeNodeIdsByFingerprint };
}

/**
 * Merges HttpRouteFact evidence onto the route node already created for the corresponding
 * (same filePath+method+path) legacy RouteFact, and links ACCEPTS_SHAPE/RETURNS_SHAPE edges
 * to any resolvable request/response shape. Never creates a second route node: a route fact
 * with no matching legacy RouteFact indicates an adapter bug (both must be emitted together)
 * and is skipped rather than fabricating a duplicate.
 */
function projectHttpRouteFacts(
  bundle: FactBundle,
  edges: CodeEdge[],
  routeNodeByCorrelationKey: ReadonlyMap<string, CodeNode>,
  shapeFactsByFingerprint: ReadonlyMap<string, HttpRequestShapeFact | HttpResponseShapeFact>,
  shapeNodeIdsByFingerprint: ReadonlyMap<string, string>,
): void {
  // Every shape fact now has its own `api_shape` node (see projectHttpShapeFacts), so this
  // always resolves the same way regardless of origin — a symbol-origin shape's own
  // `symbolRef`/`symbolName` still lives in that node's metadata for anyone who wants it.
  const resolveShapeNodeId = (fingerprint: string | undefined): string | undefined => {
    if (!fingerprint) return undefined;
    const shapeFact = shapeFactsByFingerprint.get(fingerprint);
    if (!shapeFact) return undefined;
    return shapeNodeIdsByFingerprint.get(fingerprint);
  };

  for (const fact of bundle.facts) {
    if (!isHttpRouteFact(fact)) continue;
    const routeNode = routeNodeByCorrelationKey.get(routeCorrelationKey(fact.filePath, fact.method, fact.path));
    if (!routeNode) continue;

    routeNode.metadata = {
      ...routeNode.metadata,
      apiContract: {
        factId: fact.factId,
        language: fact.language,
        method: fact.method,
        path: fact.path,
        normalizedPath: fact.normalizedPath,
        middlewareRefs: fact.middlewareRefs,
        authEvidence: fact.authEvidence,
        requestShapeRef: fact.requestShapeRef,
        responses: fact.responses,
        framework: fact.framework,
        coverage: fact.coverage,
      },
    };

    const requestShapeNodeId = resolveShapeNodeId(fact.requestShapeRef);
    if (requestShapeNodeId) {
      edges.push({
        id: generateEdgeId(routeNode.id, requestShapeNodeId, 'accepts_shape'),
        source: routeNode.id,
        target: requestShapeNodeId,
        kind: 'accepts_shape',
        weight: 1,
      });
    }

    for (const variant of fact.responses) {
      const responseShapeNodeId = resolveShapeNodeId(variant.responseShapeRef);
      if (!responseShapeNodeId) continue;
      edges.push({
        id: generateEdgeId(routeNode.id, responseShapeNodeId, 'returns_shape'),
        source: routeNode.id,
        target: responseShapeNodeId,
        kind: 'returns_shape',
        weight: variant.evidence === 'exact' ? 1 : 0.5,
        label: variant.status === undefined ? undefined : String(variant.status),
      });
    }
  }
}

/**
 * Materializes each HttpConsumerFact as its own `api_consumer` node (distinct from `route`,
 * which stays reserved for producers so the existing `routes` MCP output and repo-group
 * contract matching are never handed a consumer by surprise). Links an ACCEPTS_SHAPE edge to
 * the consumer's own request-shape node when one was resolved. Cross-file CONSUMES_API
 * resolution (matching this consumer to a producer route) happens later, over the whole
 * loaded graph — a single fact bundle only ever sees one file's facts.
 */
function projectHttpConsumerFacts(
  bundle: FactBundle,
  nodes: CodeNode[],
  edges: CodeEdge[],
  shapeNodeIdsByFingerprint: ReadonlyMap<string, string>,
): void {
  for (const fact of bundle.facts) {
    if (!isHttpConsumerFact(fact)) continue;

    const consumerId = generateNodeId('api_consumer', fact.filePath, fact.factId);
    nodes.push({
      id: consumerId,
      kind: 'api_consumer',
      name: `${fact.method ?? 'ANY'} ${fact.url.raw}`,
      filePath: fact.filePath,
      startLine: fact.sourceRange.startLine,
      endLine: fact.sourceRange.endLine,
      metadata: {
        semantic: {
          factId: fact.factId,
          language: fact.language,
          clientLibrary: fact.clientLibrary,
          method: fact.method,
          url: fact.url,
          requestShapeRef: fact.requestShapeRef,
          consumedKeys: fact.consumedKeys,
          expectedResponseShapeSymbolRef: fact.expectedResponseShapeSymbolRef,
          coverage: fact.coverage,
          frameworkEvidence: fact.frameworkEvidence,
        },
      },
    });

    const fileNodeId = generateNodeId('file', fact.filePath, fact.filePath);
    edges.push({
      id: generateEdgeId(fileNodeId, consumerId, 'contains'),
      source: fileNodeId,
      target: consumerId,
      kind: 'contains',
      weight: 1,
    });

    const requestShapeNodeId = fact.requestShapeRef ? shapeNodeIdsByFingerprint.get(fact.requestShapeRef) : undefined;
    if (requestShapeNodeId) {
      edges.push({
        id: generateEdgeId(consumerId, requestShapeNodeId, 'accepts_shape'),
        source: consumerId,
        target: requestShapeNodeId,
        kind: 'accepts_shape',
        weight: 1,
      });
    }
  }
}

export function projectFactBundle(bundle: FactBundle): { nodes: CodeNode[]; edges: CodeEdge[] } {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const declarationNodeIds = new Map<string, string>();

  for (const fact of bundle.facts) {
    if (!isDeclarationFact(fact)) continue;
    const nodeKind = toNodeKind(fact.declarationKind);
    const nodeId = declarationNodeId(fact);
    declarationNodeIds.set(fact.factId, nodeId);
    const legacyId = generateNodeId(nodeKind, fact.filePath, fact.name);
    nodes.push({
      id: nodeId,
      identityId: nodeId,
      legacyIds: legacyId === nodeId ? undefined : [legacyId],
      kind: nodeKind,
      name: fact.name,
      filePath: fact.filePath,
      startLine: fact.anchors.identity.startLine,
      endLine: fact.anchors.identity.endLine,
      exported: fact.visibility?.level === 'public' ? true : undefined,
      metadata: {
        ...(fact.language === 'html' && fact.declarationKind === 'variable' && /\s|=|;/.test(fact.name) ? { embedded: true } : {}),
        semantic: {
          factId: fact.factId,
          qualifiedName: fact.qualifiedName,
          anchors: fact.anchors,
          traits: fact.traits,
          signature: fact.signature,
          visibility: fact.visibility,
          ownerRef: fact.ownerRef,
          legacyId,
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

  const routeNodeByCorrelationKey = new Map<string, CodeNode>();

  for (const fact of bundle.facts) {
    if (!isRouteFact(fact)) continue;
    const routeName = `${fact.method?.toUpperCase() ?? fact.routeKind} ${fact.path}`;
    const routeId = generateNodeId('route', fact.filePath, routeName);
    const routeNode: CodeNode = {
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
    };
    nodes.push(routeNode);
    if (fact.routeKind === 'http') {
      routeNodeByCorrelationKey.set(routeCorrelationKey(fact.filePath, fact.method, fact.path), routeNode);
    }
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

  const { shapeFactsByFingerprint, shapeNodeIdsByFingerprint } = projectHttpShapeFacts(bundle, nodes, edges);
  projectHttpRouteFacts(bundle, edges, routeNodeByCorrelationKey, shapeFactsByFingerprint, shapeNodeIdsByFingerprint);
  projectHttpConsumerFacts(bundle, nodes, edges, shapeNodeIdsByFingerprint);

  return { nodes, edges };
}
