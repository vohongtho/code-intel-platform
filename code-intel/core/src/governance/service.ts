/**
 * Read-only planning/check entry points shared by the MCP and HTTP transports.
 * Neither function writes source: rename application stays CLI/local only.
 * Outputs are bounded with explicit totals/truncation fields.
 */
import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { buildRenamePlan } from '../refactoring/rename-plan.js';
import { formatSymbolTarget } from '../cli/symbol-target.js';
import type { CodeNode } from '../shared/index.js';
import { resolveReadIndexView } from '../storage/index-view-resolver.js';
import { loadIndexViewArtifacts } from '../storage/index-view-loader.js';
import { getUnifiedDiffBetweenRefs, listChangedFilesBetweenRefs } from '../snapshots/git-materializer.js';
import { parseDiffChangedLineRanges } from '../query/pr-impact.js';
import { getApiDrift } from '../semantic/api-contracts/service.js';
import { loadArchitecturePolicy } from './policy-schema.js';
import { STRUCTURAL_RULES, runStructuralCheck, type StructuralCheckResult, type StructuralRuleId } from './structural-check.js';

const MAX_OCCURRENCES = 200;
const MAX_EDITS = 500;

export class GovernanceRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 422 = 400) {
    super(message);
    this.name = 'GovernanceRequestError';
  }
}

export interface RenamePlanRequest {
  graph: KnowledgeGraph;
  workspaceRoot: string;
  selector: unknown;
  newName: unknown;
  indexIdentity?: string | null;
  maxOccurrences?: unknown;
}

export async function planRenameReadOnly(request: RenamePlanRequest) {
  if (typeof request.selector !== 'string' || request.selector.length === 0 || request.selector.length > 1024) throw new GovernanceRequestError('selector must be a non-empty string');
  if (typeof request.newName !== 'string' || request.newName.length === 0 || request.newName.length > 256) throw new GovernanceRequestError('newName must be a non-empty string');
  const limit = typeof request.maxOccurrences === 'number' && request.maxOccurrences > 0 ? Math.min(Math.floor(request.maxOccurrences), 2000) : MAX_OCCURRENCES;
  const result = await buildRenamePlan({
    graph: request.graph,
    workspaceRoot: request.workspaceRoot,
    selector: request.selector,
    newName: request.newName,
    indexIdentity: request.indexIdentity ?? null,
  });
  if (result.status === 'missing') return { status: 'missing' as const, selector: request.selector };
  if (result.status === 'ambiguous') {
    return {
      status: 'ambiguous' as const,
      candidates: result.candidates.slice(0, 50).map((c) => ({
        ...c,
        selector: formatSymbolTarget({ id: c.id, kind: c.kind as CodeNode['kind'], name: c.name, filePath: c.filePath, startLine: c.startLine }),
      })),
      candidatesTotal: result.candidates.length,
    };
  }
  const { plan } = result;
  return {
    status: 'planned' as const,
    readOnly: true,
    applyHint: plan.applicable
      ? `Apply locally: code-intel refactor rename ${formatSymbolTarget({ id: plan.target.id, kind: plan.target.kind as CodeNode['kind'], name: plan.target.name, filePath: plan.target.filePath, startLine: plan.target.startLine })} ${plan.newName} --apply --expect-plan ${plan.planId}`
      : 'This plan cannot be applied automatically; see boundaries.',
    plan: {
      ...plan,
      occurrences: plan.occurrences.slice(0, limit),
      edits: plan.edits.slice(0, MAX_EDITS),
    },
    occurrencesTotal: plan.occurrences.length,
    editsTotal: plan.edits.length,
    truncated: plan.occurrences.length > limit || plan.edits.length > MAX_EDITS,
  };
}

export interface StructuralCheckRequest {
  /** Current-index graph, used when no refs are given. */
  graph: KnowledgeGraph;
  repoDir: string;
  changedFiles?: unknown;
  baseRef?: unknown;
  headRef?: unknown;
  rules?: unknown;
  maxFindings?: unknown;
}

async function graphAtRef(repoDir: string, ref: string, allowBuild: boolean): Promise<KnowledgeGraph> {
  const resolution = await resolveReadIndexView({ repoDir, ref, allowBuild });
  if (!resolution.ok) throw new GovernanceRequestError(`${resolution.boundary.kind}: ${resolution.boundary.message}`, 422);
  try {
    return (await loadIndexViewArtifacts(resolution.view)).graph;
  } finally {
    resolution.view.release();
  }
}

function stringList(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string') || value.length > 10_000) throw new GovernanceRequestError(`${name} must be a list of strings`);
  return value as string[];
}

/**
 * Structural check without writing anything. With `baseRef`, both sides come
 * from isolated snapshots (head defaults to HEAD) and changed files from Git;
 * otherwise `changedFiles` are checked against the current index with no base.
 */
export async function structuralCheckReadOnly(request: StructuralCheckRequest, options: { allowBuild?: boolean } = {}): Promise<StructuralCheckResult> {
  const repoDir = path.resolve(request.repoDir);
  const known = new Set<string>(STRUCTURAL_RULES.map((r) => r.id));
  const rules = stringList(request.rules, 'rules');
  const unknown = rules?.filter((r) => !known.has(r)) ?? [];
  if (unknown.length > 0) throw new GovernanceRequestError(`unknown rule(s): ${unknown.join(', ')}`);
  const maxFindings = typeof request.maxFindings === 'number' && request.maxFindings > 0 ? Math.min(Math.floor(request.maxFindings), 2000) : 200;
  if (request.baseRef !== undefined && typeof request.baseRef !== 'string') throw new GovernanceRequestError('base_ref must be a string');
  if (request.headRef !== undefined && typeof request.headRef !== 'string') throw new GovernanceRequestError('head_ref must be a string');
  const allowBuild = options.allowBuild ?? true;

  if (typeof request.baseRef === 'string') {
    const headRef = (request.headRef as string | undefined) ?? 'HEAD';
    let changedFiles: string[];
    let diff: string;
    try {
      changedFiles = listChangedFilesBetweenRefs(repoDir, request.baseRef, headRef);
      diff = getUnifiedDiffBetweenRefs(repoDir, request.baseRef, headRef);
    } catch (error) {
      throw new GovernanceRequestError(error instanceof Error ? error.message : String(error), 422);
    }
    const [base, head] = [await graphAtRef(repoDir, request.baseRef, allowBuild), await graphAtRef(repoDir, headRef, allowBuild)];
    const drift = getApiDrift(base, head);
    return runStructuralCheck({
      head, base, changedFiles, changedRanges: parseDiffChangedLineRanges(diff), repoDir,
      policy: loadArchitecturePolicy(repoDir),
      api: { findings: drift.findings, consumerCoverageComplete: drift.coverage.consumerCoverageComplete },
      ...(rules ? { rules: rules as StructuralRuleId[] } : {}),
      maxFindings,
    });
  }
  if (request.headRef !== undefined) throw new GovernanceRequestError('head_ref requires base_ref');
  const changedFiles = stringList(request.changedFiles, 'changedFiles');
  if (!changedFiles || changedFiles.length === 0) throw new GovernanceRequestError('provide changedFiles, or base_ref (optionally with head_ref)');
  return runStructuralCheck({
    head: request.graph,
    changedFiles: changedFiles.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '')),
    repoDir,
    policy: loadArchitecturePolicy(repoDir),
    api: null,
    ...(rules ? { rules: rules as StructuralRuleId[] } : {}),
    maxFindings,
  });
}
