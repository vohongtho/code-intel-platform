/**
 * commit-plan.ts
 *
 * Groups verified changed files/symbols into suggested atomic commits with
 * conventional-commit titles. Pure data in, data out: this module performs
 * no I/O and has no Git access at all — Code Intel never stages, commits,
 * rewrites history or pushes (spec: "Commit plans are suggestions only").
 */

import type {
  ChangedSymbolRef,
  ChangeWorkflowSession,
  CommitGroup,
  CommitPlan,
  WorkflowPlanStep,
} from './session-types.js';

const TEST_FILE = /(?:^|[/.])(?:test|tests|spec|specs|__tests__)(?:[/.]|$)|\.(?:test|spec)\./i;

function commitType(symbols: readonly ChangedSymbolRef[], isTest: boolean, step?: WorkflowPlanStep): string {
  if (isTest) return 'test';
  const breaking = step?.expected.some((condition) => condition.kind === 'contract-expected-breaking') ?? false;
  // Added symbols suggest a feature; renames/moves/in-place edits default to refactor — callers edit the title.
  const type = symbols.some((symbol) => symbol.change === 'added') ? 'feat' : 'refactor';
  return breaking ? `${type}!` : type;
}

function scopeOf(files: readonly string[], repositoryName: string): string {
  const dirs = [...new Set(files.map((file) => file.split('/').filter(Boolean).slice(0, -1).pop() ?? ''))].filter(Boolean);
  return dirs.length === 1 ? dirs[0]! : repositoryName;
}

function repositoryName(session: ChangeWorkflowSession, repositoryId: string): string {
  return session.baselines.find((baseline) => baseline.repositoryId === repositoryId)?.repositoryName ?? repositoryId;
}

/**
 * Deterministic grouping:
 * 1. per repository, symbols are assigned to the first plan step (by plan
 *    order) that targets them — one commit per step;
 * 2. changed test files form a separate `test:` commit per repository;
 * 3. remaining changes form one trailing commit per repository.
 * Repositories providing a contract (route-target steps) are ordered before
 * consumer repositories so a breaking provider change lands first.
 */
export function buildCommitPlan(session: ChangeWorkflowSession, generatedAt: string): CommitPlan {
  const verification = session.latestVerification;
  if (!verification) {
    return { generatedAt, basedOnVerification: '', groups: [], note: 'No verification result yet; run verify first.' };
  }
  const steps = session.plan.steps;
  const providerRepos = new Set(steps.filter((step) => step.targets.some((target) => target.kind === 'contract')).flatMap((step) => step.repositories));
  const repositoryIds = [...new Set([
    ...verification.changedSymbols.map((symbol) => symbol.repositoryId),
    ...session.baselines.map((baseline) => baseline.repositoryId),
  ])].sort((a, b) => Number(providerRepos.has(b)) - Number(providerRepos.has(a)) || a.localeCompare(b));

  const groups: Omit<CommitGroup, 'order'>[] = [];
  for (const repositoryId of repositoryIds) {
    const repoName = repositoryName(session, repositoryId);
    const symbols = verification.changedSymbols.filter((symbol) => symbol.repositoryId === repositoryId);
    const assigned = new Set<string>();
    const filesForRepo = new Set(symbols.map((symbol) => symbol.filePath).filter((file): file is string => Boolean(file)));
    if (session.scope.type === 'repo' && repositoryId === session.scope.repositoryId) {
      for (const file of verification.changedFiles) filesForRepo.add(file);
    }

    for (const step of steps) {
      if (!step.repositories.includes(repositoryId)) continue;
      const targetIds = new Set(step.targets.filter((target) => target.repositoryId === repositoryId).map((target) => target.id));
      const stepSymbols = symbols.filter((symbol) => !assigned.has(symbol.id) && targetIds.has(symbol.id) && !TEST_FILE.test(symbol.filePath ?? ''));
      if (stepSymbols.length === 0) continue;
      for (const symbol of stepSymbols) assigned.add(symbol.id);
      const files = [...new Set(stepSymbols.map((symbol) => symbol.filePath).filter((file): file is string => Boolean(file)))].sort();
      groups.push({
        repositoryId,
        title: `${commitType(stepSymbols, false, step)}(${scopeOf(files, repoName)}): ${step.title}`,
        body: stepSymbols.map((symbol) => `- ${symbol.change} ${symbol.name ?? symbol.id}`).sort().join('\n'),
        files,
        symbols: stepSymbols.map((symbol) => symbol.id).sort(),
        stepIds: [step.id],
        rationale: `changes to targets of plan step ${step.id} (${step.category})`,
      });
    }

    const testFiles = [...filesForRepo].filter((file) => TEST_FILE.test(file)).sort();
    const testSymbols = symbols.filter((symbol) => !assigned.has(symbol.id) && TEST_FILE.test(symbol.filePath ?? ''));
    for (const symbol of testSymbols) assigned.add(symbol.id);
    if (testFiles.length > 0) {
      groups.push({
        repositoryId,
        title: `test(${scopeOf(testFiles, repoName)}): cover workflow changes`,
        body: testFiles.map((file) => `- ${file}`).join('\n'),
        files: testFiles,
        symbols: testSymbols.map((symbol) => symbol.id).sort(),
        stepIds: [],
        rationale: 'changed test files are grouped separately from production changes',
      });
    }

    const groupedFiles = new Set(groups.filter((group) => group.repositoryId === repositoryId).flatMap((group) => group.files));
    const rest = symbols.filter((symbol) => !assigned.has(symbol.id));
    const restFiles = [...new Set([
      ...rest.map((symbol) => symbol.filePath).filter((file): file is string => Boolean(file)),
      ...[...filesForRepo].filter((file) => !TEST_FILE.test(file)),
    ])].filter((file) => !groupedFiles.has(file)).sort();
    if (rest.length > 0 || restFiles.length > 0) {
      groups.push({
        repositoryId,
        title: `${commitType(rest, false)}(${scopeOf(restFiles, repoName)}): supporting changes`,
        body: rest.map((symbol) => `- ${symbol.change} ${symbol.name ?? symbol.id}`).sort().join('\n') || restFiles.map((file) => `- ${file}`).join('\n'),
        files: restFiles,
        symbols: rest.map((symbol) => symbol.id).sort(),
        stepIds: [],
        rationale: 'changes not attributed to a single plan step; review whether they belong in the change',
      });
    }
  }

  return {
    generatedAt,
    basedOnVerification: verification.verifiedAt,
    groups: groups.map((group, index) => ({ order: index + 1, ...group })),
    note: 'Suggestion only. Code Intel does not stage, commit, rewrite history or push; apply these groups with your own Git workflow.',
  };
}
