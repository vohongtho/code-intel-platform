import crypto from 'node:crypto';
import { generateCallSiteEdgeId, generateNodeId } from '../graph/id-generator.js';
import { generateCallSiteId } from '../identity/callsite-identity.js';
import type { CallSiteIdentityV1 } from '../identity/contracts.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeEdge } from '../shared/index.js';
import type { ResolutionIndexes } from './indexes.js';
import { resolveReference } from './strategies.js';
import type { ImportBindingFact, CallSiteFact, DeclarationFact, HeritageFact, ReferenceFact, SemanticFact } from '../semantic/facts.js';
import type { ResolutionOutcome, ResolutionCertainty } from './contracts.js';
import type { ResolutionEvidenceRecord, ResolutionEvidenceStore } from '../evidence/store.js';

export interface MaterializeRelationshipsResult {
  edgeCount: number;
  evidenceCount: number;
  unresolvedCount: number;
  truncatedCount: number;
}

type RelationshipFact = ImportBindingFact | CallSiteFact | ReferenceFact | HeritageFact;

type DeclarationNodeMetadata = {
  semantic?: {
    factId?: string;
    anchors?: {
      identity?: { startLine: number; endLine: number };
      render?: { startLine: number; endLine: number };
    };
  };
};

function isImportBindingFact(fact: SemanticFact): fact is ImportBindingFact {
  return 'sourceModule' in fact && 'localName' in fact;
}

function isCallSiteFact(fact: SemanticFact): fact is CallSiteFact {
  return 'calleeText' in fact;
}

function isReferenceFact(fact: SemanticFact): fact is ReferenceFact {
  return 'operation' in fact && 'targetText' in fact;
}

function isHeritageFact(fact: SemanticFact): fact is HeritageFact {
  return 'heritageKind' in fact && 'target' in fact;
}

function isRelationshipFact(fact: SemanticFact): fact is RelationshipFact {
  return isImportBindingFact(fact) || isCallSiteFact(fact) || isReferenceFact(fact) || isHeritageFact(fact);
}

function mapCertainty(certainty: ResolutionCertainty): CodeEdge['certainty'] | null {
  switch (certainty) {
    case 'exact': return 'exact';
    case 'candidate-set': return 'candidate';
    case 'heuristic': return 'heuristic';
    case 'unresolved':
    case 'external-boundary':
    case 'truncated':
      return null;
  }
}

function boundaryKind(fact: RelationshipFact, outcome: ResolutionOutcome) {
  if (outcome.certainty === 'truncated') return 'analysis-limit' as const;
  if (outcome.certainty === 'external-boundary') return 'external-library' as const;
  if (isHeritageFact(fact) && outcome.certainty === 'unresolved') return 'unsupported-semantics' as const;
  if ((isCallSiteFact(fact) || isReferenceFact(fact)) && fact.receiver && outcome.certainty === 'unresolved') {
    return 'unresolved-receiver' as const;
  }
  if (outcome.candidates.length > 1) return 'ambiguous-target' as const;
  return 'unsupported-semantics' as const;
}

function relationKind(fact: RelationshipFact): CodeEdge['kind'] {
  if (isImportBindingFact(fact)) return 'imports';
  if (isHeritageFact(fact)) return fact.heritageKind === 'extends' ? 'extends' : 'implements';
  if (isCallSiteFact(fact)) return 'calls';
  if (isReferenceFact(fact)) return fact.operation === 'call' || fact.operation === 'instantiate' ? 'calls' : 'accesses';
  return 'accesses';
}

function referenceText(fact: RelationshipFact): string {
  if (isImportBindingFact(fact)) return fact.importedName ?? fact.localName;
  if (isHeritageFact(fact)) return fact.target.name ?? fact.target.text;
  if (isCallSiteFact(fact)) return fact.calleeText;
  return fact.targetText;
}

function referenceName(fact: RelationshipFact): string {
  const text = referenceText(fact).trim();
  const cleaned = text.replace(/[()<>].*$/, '').split(/[:.#/\\]/).filter(Boolean).pop();
  return cleaned || text;
}

function factOwnerRef(fact: RelationshipFact): string | undefined {
  if (isImportBindingFact(fact)) return fact.scopeRef;
  if (isCallSiteFact(fact)) return fact.callerRef;
  if (isHeritageFact(fact)) return fact.declarationRef;
  return undefined;
}

function buildDeclarationIndex(graph: KnowledgeGraph): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of graph.allNodes()) {
    const metadata = node.metadata as DeclarationNodeMetadata | undefined;
    const factId = metadata?.semantic?.factId;
    if (factId) map.set(factId, node.id);
  }
  return map;
}

function findEnclosingSourceNodeId(
  graph: KnowledgeGraph,
  declarationIds: Map<string, string>,
  fact: RelationshipFact,
): string {
  const direct = factOwnerRef(fact);
  if (direct) {
    const nodeId = declarationIds.get(direct);
    if (nodeId) return nodeId;
  }

  let best: { id: string; span: number } | null = null;
  for (const node of graph.allNodes()) {
    if (node.filePath !== fact.filePath) continue;
    const metadata = node.metadata as DeclarationNodeMetadata | undefined;
    const anchors = metadata?.semantic?.anchors;
    const range = anchors?.render ?? anchors?.identity;
    if (!range) continue;
    if (range.startLine > fact.sourceRange.startLine || range.endLine < fact.sourceRange.endLine) continue;
    const span = range.endLine - range.startLine;
    if (!best || span < best.span) best = { id: node.id, span };
  }

  return best?.id ?? generateNodeId('file', fact.filePath, fact.filePath);
}

function buildCallSiteIdForFact(sourceNodeId: string, fact: RelationshipFact): string {
  const identity: CallSiteIdentityV1 = {
    version: 1,
    filePath: fact.filePath,
    callerSymbolId: sourceNodeId.startsWith('file:') ? undefined : sourceNodeId,
    range: fact.sourceRange,
    calleeText: referenceText(fact),
  };
  return generateCallSiteId(identity);
}

function needsEvidence(outcome: ResolutionOutcome): boolean {
  return !outcome.coverage.complete || outcome.certainty === 'unresolved' || outcome.certainty === 'external-boundary' || outcome.certainty === 'truncated' || outcome.candidates.length > 1;
}

function makeEvidenceId(referenceId: string, fact: RelationshipFact, outcome: ResolutionOutcome): string {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({
      referenceId,
      certainty: outcome.certainty,
      candidates: outcome.candidates.map((item) => [item.targetId, item.confidence, item.strategy, item.evidenceRefs]),
      coverage: outcome.coverage,
      filePath: fact.filePath,
      startLine: fact.sourceRange.startLine,
      endLine: fact.sourceRange.endLine,
    }))
    .digest('hex')
    .slice(0, 24);
  return `evidence:v1:${digest}`;
}

function buildEvidenceRecord(referenceId: string, fact: RelationshipFact, outcome: ResolutionOutcome): ResolutionEvidenceRecord {
  return {
    id: makeEvidenceId(referenceId, fact, outcome),
    version: 1,
    referenceId,
    resolverVersion: outcome.resolverVersion,
    strategy: outcome.candidates.map((item) => item.strategy).join('|') || 'unresolved',
    confidence: outcome.candidates[0]?.confidence,
    certainty: mapCertainty(outcome.certainty) ?? undefined,
    coverage: {
      complete: outcome.coverage.complete,
      examinedCount: outcome.coverage.emittedCandidates,
      totalKnownCount: outcome.coverage.totalKnownCandidates,
      incompleteReasons: outcome.coverage.incompleteReasons,
    },
    boundaries: (!outcome.coverage.complete || outcome.certainty === 'unresolved' || outcome.certainty === 'external-boundary' || outcome.candidates.length > 1)
      ? [{ kind: boundaryKind(fact, outcome), evidenceRefs: [] }]
      : undefined,
    candidateIds: outcome.candidates.map((item) => item.targetId),
    rejectedCandidateReasons: outcome.coverage.incompleteReasons,
    source: {
      filePath: fact.filePath,
      startLine: fact.sourceRange.startLine,
      endLine: fact.sourceRange.endLine,
    },
    details: {
      factId: fact.factId,
      referenceText: referenceText(fact),
      relationshipKind: relationKind(fact),
      boundary: outcome.boundary,
    },
    recordedAt: new Date().toISOString(),
  };
}

export function materializeSemanticRelationships(args: {
  graph: KnowledgeGraph;
  facts: readonly SemanticFact[];
  indexes: ResolutionIndexes;
  evidenceStore: ResolutionEvidenceStore;
  resolverVersion: string;
}): MaterializeRelationshipsResult {
  const { graph, facts, indexes, evidenceStore, resolverVersion } = args;
  const declarationIds = buildDeclarationIndex(graph);
  let edgeCount = 0;
  let evidenceCount = 0;
  let unresolvedCount = 0;
  let truncatedCount = 0;

  for (const fact of facts) {
    if (!isRelationshipFact(fact)) continue;

    const sourceNodeId = findEnclosingSourceNodeId(graph, declarationIds, fact);
    const callSiteId = buildCallSiteIdForFact(sourceNodeId, fact);
    const outcome = resolveReference(indexes, {
      referenceId: callSiteId,
      filePath: fact.filePath,
      name: referenceName(fact),
      ownerRef: factOwnerRef(fact),
      moduleRef: isImportBindingFact(fact) ? fact.sourceModule : undefined,
      localName: isImportBindingFact(fact) ? fact.localName : undefined,
      receiverType: isCallSiteFact(fact) || isReferenceFact(fact) ? fact.receiver?.type : undefined,
    });
    const normalizedOutcome: ResolutionOutcome = { ...outcome, resolverVersion };

    let evidenceRef: string | undefined;
    if (needsEvidence(normalizedOutcome)) {
      const record = buildEvidenceRecord(callSiteId, fact, normalizedOutcome);
      const boundaries = record.boundaries?.map((item) => ({ ...item, evidenceRefs: [record.id] }));
      evidenceStore.put({ ...record, boundaries });
      evidenceRef = record.id;
      evidenceCount += 1;
    }

    if (normalizedOutcome.certainty === 'unresolved' || normalizedOutcome.certainty === 'external-boundary') unresolvedCount += 1;
    if (normalizedOutcome.certainty === 'truncated') truncatedCount += 1;

    const certainty = mapCertainty(normalizedOutcome.certainty);
    for (const candidate of normalizedOutcome.candidates) {
      if (!certainty) continue;
      const targetNodeId = declarationIds.get(candidate.targetId) ?? candidate.targetId;
      const edge: CodeEdge = {
        id: generateCallSiteEdgeId(sourceNodeId, targetNodeId, relationKind(fact), {
          version: 1,
          filePath: fact.filePath,
          callerSymbolId: sourceNodeId.startsWith('file:') ? undefined : sourceNodeId,
          range: fact.sourceRange,
          calleeText: referenceText(fact),
        }),
        source: sourceNodeId,
        target: targetNodeId,
        kind: relationKind(fact),
        weight: candidate.confidence,
        label: referenceText(fact),
        callSiteId,
        confidence: candidate.confidence,
        certainty,
        strategy: candidate.strategy,
        resolverVersion,
        evidenceRef,
        ambiguous: normalizedOutcome.candidates.length > 1 || !normalizedOutcome.coverage.complete,
        metadata: {
          ponytail: 'Semantic resolver materialization v1; source-node fallback uses nearest enclosing declaration or file node. Upgrade when adapters provide explicit subject refs for every reference class.',
        },
      };
      if (!graph.getEdge(edge.id)) {
        graph.addEdge(edge);
        edgeCount += 1;
      }
    }
  }

  return { edgeCount, evidenceCount, unresolvedCount, truncatedCount };
}
