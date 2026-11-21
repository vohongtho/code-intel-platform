/**
 * review-lenses.ts
 *
 * Reusable review lenses run during workflow verification. Each lens is a
 * thin adapter over an existing service — it never re-derives semantics:
 *
 * - architecture -> health/circular-deps (new import cycles)
 * - api          -> semantic/api-contracts drift (via the observation)
 * - tests        -> query/test-selection over changed symbols
 * - security     -> security/vulnerability-detector keys (via the observation)
 * - change-risk  -> query/pr-impact graph blast radius over changed files
 * - scope        -> planned-vs-unexpected semantic deltas
 *
 * A lens whose required capability is unavailable reports `unavailable`
 * with the reduced guarantee instead of fabricating a pass.
 */

import type { KnowledgeGraph } from '../../graph/knowledge-graph.js';
import type { AnalysisCoverage } from '../../shared/index.js';
import { computePRImpact } from '../../query/pr-impact.js';
import { selectTestsForImpact } from '../../query/test-selection.js';
import type { RepositoryObservation } from './conditions.js';
import type {
  ExpectedSemanticCondition,
  LensFinding,
  LensResult,
  ReviewLensId,
  UnexpectedChange,
  WorkflowCapabilityId,
} from './session-types.js';

export interface ReviewLensInput {
  repositoryId: string;
  repoDir: string;
  observation: RepositoryObservation;
  headGraph: KnowledgeGraph;
  changedNodeIds: readonly string[];
  changedFiles: readonly string[];
  unexpected: readonly UnexpectedChange[];
  conditions: readonly ExpectedSemanticCondition[];
  capabilities: ReadonlySet<WorkflowCapabilityId>;
}

export interface ReviewLens {
  id: ReviewLensId;
  version: string;
  requiredCapabilities: readonly WorkflowCapabilityId[];
  optionalCapabilities: readonly WorkflowCapabilityId[];
  /** Guarantee lost when a required capability is unavailable. */
  reducedGuarantee: string;
  evaluate(input: ReviewLensInput): Omit<LensResult, 'lensId' | 'version' | 'repositoryId'>;
}

const FINDING_CAP = 50;

function complete(examinedCount: number): AnalysisCoverage {
  return { complete: true, examinedCount, incompleteReasons: [] };
}

function statusFrom(findings: readonly LensFinding[]): LensResult['status'] {
  if (findings.some((finding) => finding.severity === 'error')) return 'fail';
  if (findings.some((finding) => finding.severity === 'warning')) return 'warn';
  return 'pass';
}

function capped(findings: LensFinding[]): LensFinding[] {
  if (findings.length <= FINDING_CAP) return findings;
  return [...findings.slice(0, FINDING_CAP), { severity: 'info', message: `${findings.length - FINDING_CAP} more finding(s) omitted`, evidenceRefs: [] }];
}

const architectureLens: ReviewLens = {
  id: 'architecture',
  version: 'architecture-v1',
  requiredCapabilities: ['structural-review'],
  optionalCapabilities: [],
  reducedGuarantee: 'new structural violations (import cycles) are not checked',
  evaluate({ observation }) {
    const cycles = observation.cycles!;
    const base = new Set(cycles.base);
    const added = cycles.head.filter((key) => !base.has(key));
    const findings = added.map((key): LensFinding => ({
      severity: 'error',
      message: `new import cycle across ${key.split('|').length} node(s)`,
      evidenceRefs: [`cycle:${key}`],
    }));
    return { status: statusFrom(findings), findings: capped(findings), coverage: complete(cycles.head.length) };
  },
};

const apiLens: ReviewLens = {
  id: 'api',
  version: 'api-v1',
  requiredCapabilities: ['api-contracts'],
  optionalCapabilities: ['group-contracts'],
  reducedGuarantee: 'HTTP contract compatibility and consumer impact are not checked',
  evaluate({ observation, conditions }) {
    const contracts = observation.contracts!;
    const intentional = new Set(conditions
      .filter((c) => c.kind === 'contract-expected-breaking' && c.repositoryId === observation.repositoryId)
      .map((c) => (c as Extract<ExpectedSemanticCondition, { kind: 'contract-expected-breaking' }>).contractId));
    const findings: LensFinding[] = [];
    for (const finding of contracts.findings) {
      if (finding.verdict === 'compatible') continue;
      const planned = intentional.has(finding.routeFactId);
      findings.push({
        severity: planned ? 'info' : finding.verdict === 'breaking' ? 'error' : 'warning',
        message: `${planned ? 'planned ' : ''}${finding.verdict} contract change (${finding.rule}${finding.fieldKey ? ` ${finding.fieldKey}` : ''}); ${finding.affectedConsumerFactIds.length} known consumer(s)`,
        evidenceRefs: [`contract:${finding.routeFactId}`, ...finding.affectedConsumerFactIds.map((id) => `consumer:${id}`)],
      });
    }
    if (!contracts.consumerCoverageComplete) {
      findings.push({ severity: 'warning', message: 'consumer coverage is incomplete; unlisted consumers may be affected', evidenceRefs: [] });
    }
    return {
      status: statusFrom(findings),
      findings: capped(findings),
      coverage: {
        complete: contracts.consumerCoverageComplete,
        examinedCount: contracts.findings.length,
        incompleteReasons: contracts.consumerCoverageComplete ? [] : ['consumer-coverage-incomplete'],
      },
    };
  },
};

const testsLens: ReviewLens = {
  id: 'tests',
  version: 'tests-v1',
  requiredCapabilities: ['test-intelligence'],
  optionalCapabilities: ['stable-flows'],
  reducedGuarantee: 'test evidence for changed symbols is not checked',
  evaluate({ headGraph, changedNodeIds, repoDir }) {
    const ids = changedNodeIds.filter((id) => headGraph.getNode(id));
    if (ids.length === 0) return { status: 'pass', findings: [], coverage: complete(0) };
    const selection = selectTestsForImpact(headGraph, ids, { repoDir });
    const findings: LensFinding[] = [];
    const real = selection.evidence.filter((evidence) => evidence.kind !== 'unknown');
    if (real.length === 0) {
      findings.push({
        severity: 'warning',
        message: selection.missingTestFinding?.reason ?? 'no test evidence for changed symbols',
        evidenceRefs: [],
      });
    } else {
      const byKind = new Map<string, number>();
      for (const evidence of real) byKind.set(evidence.kind, (byKind.get(evidence.kind) ?? 0) + 1);
      findings.push({
        severity: real.every((evidence) => evidence.kind === 'candidate') ? 'warning' : 'info',
        message: `test evidence: ${[...byKind.entries()].map(([kind, count]) => `${count} ${kind}`).join(', ')}`,
        evidenceRefs: real.slice(0, 20).map((evidence) => `test:${evidence.testId ?? evidence.filePath ?? '?'}`),
      });
    }
    return { status: statusFrom(findings), findings, coverage: selection.coverage };
  },
};

const securityLens: ReviewLens = {
  id: 'security',
  version: 'security-v1',
  requiredCapabilities: ['security-review'],
  optionalCapabilities: [],
  reducedGuarantee: 'new security findings are not checked',
  evaluate({ observation }) {
    const security = observation.security!;
    const base = new Set(security.baseKeys);
    const added = security.headKeys.filter((key) => !base.has(key));
    const findings = added.map((key): LensFinding => {
      const [type, file, symbol] = key.split('\u0000');
      return { severity: 'warning', message: `new heuristic ${type} finding in ${symbol} (${file})`, evidenceRefs: [`security:${type}:${file}:${symbol}`] };
    });
    return {
      status: statusFrom(findings),
      findings: capped(findings),
      coverage: complete(security.headKeys.length),
      reducedGuarantee: 'heuristic signal scanner only; absence of findings is not a taint-path proof',
    };
  },
};

const changeRiskLens: ReviewLens = {
  id: 'change-risk',
  version: 'change-risk-v1',
  requiredCapabilities: [],
  optionalCapabilities: ['pdg'],
  reducedGuarantee: 'graph blast radius for changed files is not checked',
  evaluate({ headGraph, changedFiles, repoDir }) {
    if (changedFiles.length === 0) return { status: 'pass', findings: [], coverage: complete(0) };
    const impact = computePRImpact(headGraph, [...changedFiles], 2, repoDir);
    const findings: LensFinding[] = [];
    const high = impact.changedSymbols.filter((symbol) => symbol.risk === 'HIGH');
    if (high.length > 0) {
      findings.push({
        severity: 'warning',
        message: `${high.length} high-risk changed symbol(s); ${impact.impactedSymbols.length} impacted symbol(s) within 2 hops`,
        evidenceRefs: high.slice(0, 20).map((symbol) => `symbol:${symbol.name}`),
      });
    }
    if (impact.coverageGaps.length > 0) {
      findings.push({ severity: 'info', message: `${impact.coverageGaps.length} changed symbol(s) without test coverage`, evidenceRefs: impact.coverageGaps.slice(0, 20).map((name) => `symbol:${name}`) });
    }
    return {
      status: statusFrom(findings),
      findings,
      coverage: impact.coverage ?? complete(impact.changedSymbols.length),
      reducedGuarantee: 'graph-level blast radius; statement-level PDG precision is not applied in workflow verification',
    };
  },
};

const scopeLens: ReviewLens = {
  id: 'scope',
  version: 'scope-v1',
  requiredCapabilities: [],
  optionalCapabilities: [],
  reducedGuarantee: 'planned-vs-unexpected scope is not checked',
  evaluate({ unexpected, observation }) {
    const findings = unexpected.map((change): LensFinding => ({
      severity: 'warning',
      message: `unplanned ${change.category} ${change.change}${change.name ? `: ${change.name}` : ''}${change.filePath ? ` (${change.filePath})` : ''}`,
      evidenceRefs: [`${change.category}:${change.key}`],
    }));
    return { status: statusFrom(findings), findings: capped(findings), coverage: observation.coverage };
  },
};

export const REVIEW_LENSES: Readonly<Record<ReviewLensId, ReviewLens>> = Object.freeze({
  architecture: architectureLens,
  api: apiLens,
  tests: testsLens,
  security: securityLens,
  'change-risk': changeRiskLens,
  scope: scopeLens,
});

/** Runs the requested lenses in a stable order; unavailable capabilities yield `unavailable`, never `pass`. */
export function runReviewLenses(lensIds: readonly ReviewLensId[], input: ReviewLensInput): LensResult[] {
  const ordered = [...new Set(lensIds)].sort();
  return ordered.map((id) => {
    const lens = REVIEW_LENSES[id];
    const missing = lens.requiredCapabilities.filter((capability) => !input.capabilities.has(capability));
    if (missing.length > 0 || !input.observation.available) {
      return {
        lensId: id,
        version: lens.version,
        repositoryId: input.repositoryId,
        status: 'unavailable',
        findings: [],
        coverage: { complete: false, examinedCount: 0, incompleteReasons: missing.length > 0 ? missing.map((m) => `capability-unavailable:${m}`) : ['repository-not-comparable'] },
        reducedGuarantee: lens.reducedGuarantee,
      };
    }
    return { lensId: id, version: lens.version, repositoryId: input.repositoryId, ...lens.evaluate(input) };
  });
}
