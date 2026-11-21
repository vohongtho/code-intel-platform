/**
 * CLI handlers for `code-intel check` and `code-intel refactor rename`.
 *
 * Kept out of app.ts so the command logic is testable without spawning the
 * CLI. app.ts registers the commands and injects how the current index is
 * loaded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadMetadata } from '../storage/metadata.js';
import { resolveReadIndexView } from '../storage/index-view-resolver.js';
import { loadIndexViewArtifacts } from '../storage/index-view-loader.js';
import { getChangedFilesSince } from '../pipeline/incremental.js';
import { getUnifiedDiffBetweenRefs, listChangedFilesBetweenRefs } from '../snapshots/git-materializer.js';
import { parseDiffChangedLineRanges } from '../query/pr-impact.js';
import { getApiDrift } from '../semantic/api-contracts/service.js';
import { loadArchitecturePolicy, type FindingSeverity } from '../governance/policy-schema.js';
import { STRUCTURAL_RULES, runStructuralCheck, severityAtLeast, type StructuralCheckResult, type StructuralRuleId } from '../governance/structural-check.js';
import { buildStructuralSARIF } from './sarif-builder.js';
import { buildRenamePlan } from '../refactoring/rename-plan.js';
import { applyRenamePlan, RenameApplyError } from '../refactoring/apply.js';
import { analyzeWorkspaceInMemory, verifyAppliedRename, type RenameVerification } from '../refactoring/verify.js';
import { AMBIGUOUS_SYMBOL_EXIT_CODE, formatSymbolTarget } from './symbol-target.js';
import type { RenamePlan, RenameTarget } from '../refactoring/contracts.js';
import type { CodeNode } from '../shared/index.js';

function selectorOf(target: RenameTarget): string {
  return formatSymbolTarget({ id: target.id, kind: target.kind as CodeNode['kind'], name: target.name, filePath: target.filePath, startLine: target.startLine });
}

/** Findings at/above the threshold. */
export const CHECK_FINDINGS_EXIT_CODE = 1;
/** Could not run the check (bad ref, missing index, invalid option). */
export const CHECK_ERROR_EXIT_CODE = 2;

export type LoadCurrentGraph = (repoPath: string) => Promise<{ graph: KnowledgeGraph }>;

export interface CheckCommandOptions {
  path?: string;
  changed?: boolean;
  base?: string;
  head?: string;
  format?: string;
  failOn?: string;
  rules?: string;
  maxFindings?: string;
  fresh?: boolean;
  installHook?: boolean;
}

interface CommandIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const defaultIo: CommandIo = { out: (t) => console.log(t), err: (t) => console.error(t) };

async function loadRefGraph(repoDir: string, ref: string): Promise<KnowledgeGraph> {
  const resolution = await resolveReadIndexView({ repoDir, ref });
  if (!resolution.ok) throw new Error(`${resolution.boundary.kind}: ${resolution.boundary.message}`);
  try {
    return (await loadIndexViewArtifacts(resolution.view)).graph;
  } finally {
    resolution.view.release();
  }
}

/** Working-tree files modified after the index was written: the index cannot describe them. */
function staleIndexNote(repoDir: string, changedFiles: readonly string[]): string | null {
  const indexedAt = Date.parse(loadMetadata(repoDir)?.indexedAt ?? '');
  if (!Number.isFinite(indexedAt)) return 'current index has no timestamp; working-tree changes may not be reflected';
  const newer = changedFiles.filter((file) => {
    try { return fs.statSync(path.join(repoDir, file)).mtimeMs > indexedAt; } catch { return false; }
  });
  return newer.length > 0
    ? `${newer.length} changed file(s) are newer than the current index; run \`code-intel analyze\` or pass --fresh`
    : null;
}

function parseRules(value: string | undefined): StructuralRuleId[] | undefined {
  if (!value) return undefined;
  const known = new Set<string>(STRUCTURAL_RULES.map((r) => r.id));
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`unknown rule(s): ${unknown.join(', ')}; known: ${[...known].join(', ')}`);
  return ids as StructuralRuleId[];
}

function parseFailOn(value: string | undefined): FindingSeverity | 'never' {
  const v = (value ?? 'error').toLowerCase();
  if (v === 'error' || v === 'warning' || v === 'note' || v === 'never') return v;
  throw new Error('--fail-on must be error, warning, note or never');
}

const HOOK_MARKER = '# Installed by `code-intel check --install-hook`.';

/** Opt-in only: writes `.git/hooks/pre-commit` when no hook exists there yet. */
export function installPreCommitHook(repoDir: string): { path: string } {
  let hooksDir: string;
  try {
    hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error(`${repoDir} is not a Git work tree`);
  }
  const hookPath = path.resolve(repoDir, hooksDir, 'pre-commit');
  if (fs.existsSync(hookPath)) {
    throw new Error(`${hookPath} already exists; add \`code-intel check --changed --fail-on error\` to it yourself`);
  }
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, `#!/bin/sh\n${HOOK_MARKER} Delete this file to uninstall.\nexec code-intel check --changed --fail-on error\n`, { mode: 0o755, flag: 'wx' });
  return { path: hookPath };
}

export interface CheckRun {
  result: StructuralCheckResult;
  exitCode: number;
}

/** Compute the check (no printing). */
export async function computeCheck(opts: CheckCommandOptions, loadCurrent: LoadCurrentGraph): Promise<CheckRun> {
  const repoDir = path.resolve(opts.path ?? '.');
  const failOn = parseFailOn(opts.failOn);
  const rules = parseRules(opts.rules);
  const maxFindings = opts.maxFindings ? Number.parseInt(opts.maxFindings, 10) : undefined;
  if (maxFindings !== undefined && (!Number.isFinite(maxFindings) || maxFindings < 1)) throw new Error('--max-findings must be a positive integer');
  if (!opts.changed && !opts.base) throw new Error('pass --changed (working tree) and/or --base <ref>');
  if (opts.changed && opts.head) throw new Error('--head cannot be combined with --changed (the working tree is the head)');

  const notes: string[] = [];
  let changedFiles: string[];
  let head: KnowledgeGraph;
  let changedRanges: ReturnType<typeof parseDiffChangedLineRanges> | undefined;

  if (opts.changed) {
    const files = getChangedFilesSince(repoDir, opts.base ?? 'HEAD');
    if (files === null) throw new Error(`could not list working-tree changes against ${opts.base ?? 'HEAD'} (is this a Git work tree?)`);
    changedFiles = files;
    if (opts.fresh) {
      head = await analyzeWorkspaceInMemory(repoDir);
    } else {
      head = (await loadCurrent(repoDir)).graph;
      const note = staleIndexNote(repoDir, changedFiles);
      if (note) notes.push(note);
    }
  } else {
    const headRef = opts.head ?? 'HEAD';
    changedFiles = listChangedFilesBetweenRefs(repoDir, opts.base!, headRef);
    changedRanges = parseDiffChangedLineRanges(getUnifiedDiffBetweenRefs(repoDir, opts.base!, headRef));
    head = await loadRefGraph(repoDir, headRef);
  }

  const base = opts.base ? await loadRefGraph(repoDir, opts.base) : null;
  const api = base ? (() => {
    const drift = getApiDrift(base, head);
    return { findings: drift.findings, consumerCoverageComplete: drift.coverage.consumerCoverageComplete };
  })() : null;

  const result = await runStructuralCheck({
    head,
    base,
    changedFiles,
    ...(changedRanges ? { changedRanges } : {}),
    repoDir,
    policy: loadArchitecturePolicy(repoDir),
    api,
    ...(rules ? { rules } : {}),
    ...(maxFindings ? { maxFindings } : {}),
    coverageNotes: notes,
  });
  // Count over every finding, not just the returned page.
  const failing = failOn !== 'never' && (
    (failOn === 'error' && result.summary.error > 0)
    || (failOn === 'warning' && result.summary.error + result.summary.warning > 0)
    || (failOn === 'note' && result.totalFindings > 0)
  );
  return { result, exitCode: failing ? CHECK_FINDINGS_EXIT_CODE : 0 };
}

function printCheckText(result: StructuralCheckResult, io: CommandIo): void {
  io.out('\n  ◈  Structural check\n');
  io.out(`  Changed files : ${result.changedFiles.length}`);
  io.out(`  Policy        : ${result.policy.status} (${result.policy.path})`);
  io.out(`  Findings      : ${result.summary.error} error / ${result.summary.warning} warning / ${result.summary.note} note${result.truncated ? ` (showing ${result.findings.length} of ${result.totalFindings})` : ''}`);
  io.out(`  Coverage      : ${result.coverage.complete ? 'complete' : 'PARTIAL'}\n`);
  for (const f of result.findings) {
    const where = `${f.location.filePath}${f.location.startLine ? `:${f.location.startLine}` : ''}`;
    io.out(`  [${f.severity.toUpperCase()}] ${f.ruleId}  ${where}`);
    io.out(`    ${f.message}`);
    for (const e of f.evidence.slice(0, 4)) io.out(`      · ${e}`);
    io.out(`    hint: ${f.hint}  (certainty: ${f.certainty}${f.introduced === null ? '' : f.introduced ? ', introduced' : ', pre-existing'})`);
  }
  if (result.findings.length > 0) io.out('');
  for (const rule of result.rules.filter((r) => r.status === 'skipped' && r.reason !== 'not selected')) io.out(`  skipped ${rule.id}: ${rule.reason}`);
  if (!result.coverage.complete) {
    io.out('\n  ⚠  Partial coverage — no finding is not proof of safety:');
    for (const reason of result.coverage.incompleteReasons) io.out(`     - ${reason}`);
  }
  if (result.policy.status === 'absent' && result.advisory.layers.length > 0) {
    io.out(`\n  Advisory layers (never enforced): ${result.advisory.layers.map((l) => `${l.role}=${l.include[0]} (${l.confidence})`).join(', ')}`);
  }
  io.out('');
}

export async function runCheckCommand(opts: CheckCommandOptions, loadCurrent: LoadCurrentGraph, version: string, io: CommandIo = defaultIo): Promise<number> {
  const repoDir = path.resolve(opts.path ?? '.');
  if (opts.installHook) {
    try {
      const { path: hookPath } = installPreCommitHook(repoDir);
      io.out(`\n  ✓  Installed pre-commit hook: ${hookPath}\n     It runs \`code-intel check --changed --fail-on error\`. Delete the file to uninstall.\n`);
      return 0;
    } catch (error) {
      io.err(`\n  ✗  ${error instanceof Error ? error.message : String(error)}\n`);
      return CHECK_ERROR_EXIT_CODE;
    }
  }
  const format = (opts.format ?? 'text').toLowerCase();
  if (!['text', 'json', 'sarif'].includes(format)) {
    io.err('\n  ✗  --format must be text, json or sarif\n');
    return CHECK_ERROR_EXIT_CODE;
  }
  let run: CheckRun;
  try {
    run = await computeCheck(opts, loadCurrent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format === 'text') io.err(`\n  ✗  check could not run: ${message}\n`);
    else io.out(JSON.stringify({ error: message }, null, 2));
    return CHECK_ERROR_EXIT_CODE;
  }
  if (format === 'json') io.out(JSON.stringify(run.result, null, 2));
  else if (format === 'sarif') io.out(JSON.stringify(buildStructuralSARIF(run.result, version), null, 2));
  else printCheckText(run.result, io);
  return run.exitCode;
}

// ─── refactor rename ─────────────────────────────────────────────────────────

export interface RenameCommandOptions {
  path?: string;
  dryRun?: boolean;
  apply?: boolean;
  allowDirty?: boolean;
  expectPlan?: string;
  format?: string;
}

function printCandidates(candidates: RenameTarget[], io: CommandIo): void {
  io.err('\n  ✗  Ambiguous selector; pass one of these canonical selectors:\n');
  for (const c of candidates) io.err(`     ${selectorOf(c)}`);
  io.err('');
}

function printPlanText(plan: RenamePlan, io: CommandIo): void {
  const counts = new Map<string, number>();
  for (const o of plan.occurrences) counts.set(o.category, (counts.get(o.category) ?? 0) + 1);
  io.out(`\n  ◈  Rename plan  ${plan.target.name} → ${plan.newName}\n`);
  io.out(`  Target     : ${plan.target.kind} ${plan.target.filePath}:${plan.target.startLine ?? '?'}`);
  io.out(`  Capability : ${plan.target.language ?? 'unknown'} rename ${plan.capability.rename}${plan.capability.scope ? ` (${plan.capability.scope})` : ''}`);
  io.out(`  Plan id    : ${plan.planId}`);
  io.out(`  Edits      : ${plan.edits.length} in ${plan.fingerprint.files.length} file(s)`);
  io.out(`  Occurrences: ${[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  io.out(`  Applicable : ${plan.applicable ? 'yes' : 'no'}\n`);
  for (const o of plan.occurrences.filter((x) => x.category !== 'candidate-text').slice(0, 200)) {
    io.out(`    ${o.category.padEnd(16)} ${o.role.padEnd(16)} ${o.filePath}:${o.range.startLine}:${o.range.startColumn + 1}${o.reason ? `  (${o.reason})` : ''}`);
  }
  const candidates = plan.occurrences.filter((o) => o.category === 'candidate-text');
  if (candidates.length > 0) {
    io.out(`\n  Candidates (never edited automatically): ${candidates.length}`);
    for (const o of candidates.slice(0, 50)) io.out(`    ${o.role.padEnd(10)} ${o.filePath}:${o.range.startLine}:${o.range.startColumn + 1}`);
  }
  if (plan.boundaries.length > 0) {
    io.out('\n  Boundaries (block apply):');
    for (const b of plan.boundaries) io.out(`    ${b.kind}: ${b.message}`);
  }
  if (plan.impact.tests.length > 0) io.out(`\n  Suggested tests: ${plan.impact.tests.map((t) => t.filePath || t.name).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
  if (!plan.coverage.complete) {
    io.out('\n  ⚠  Partial coverage:');
    for (const r of plan.coverage.incompleteReasons) io.out(`     - ${r}`);
  }
  io.out('');
}

function printVerificationText(verification: RenameVerification, io: CommandIo): void {
  io.out(`  Verification: ${verification.verdict.toUpperCase()}`);
  for (const c of verification.checks) io.out(`    ${c.passed ? '✓' : '✗'} ${c.id}: ${c.detail}`);
  for (const w of verification.warnings) io.out(`    ⚠ ${w}`);
  if (verification.tests.length > 0) io.out(`  Suggested tests: ${verification.tests.map((t) => t.testId).join(', ')}`);
  io.out('');
}

export async function runRenameCommand(
  selector: string,
  newName: string,
  opts: RenameCommandOptions,
  loadCurrent: LoadCurrentGraph,
  io: CommandIo = defaultIo,
): Promise<number> {
  const workspaceRoot = path.resolve(opts.path ?? '.');
  const json = (opts.format ?? 'text').toLowerCase() === 'json';
  const fail = (message: string, code = 1, extra: Record<string, unknown> = {}) => {
    if (json) io.out(JSON.stringify({ error: message, ...extra }, null, 2));
    else io.err(`\n  ✗  ${message}\n`);
    return code;
  };
  if (opts.apply && opts.dryRun) return fail('--apply and --dry-run are mutually exclusive', CHECK_ERROR_EXIT_CODE);
  if (opts.expectPlan && !opts.apply) return fail('--expect-plan only applies with --apply', CHECK_ERROR_EXIT_CODE);

  // Apply plans from a fresh analysis of the files on disk, never a possibly-stale index.
  const graph = opts.apply ? await analyzeWorkspaceInMemory(workspaceRoot) : (await loadCurrent(workspaceRoot)).graph;
  const indexIdentity = opts.apply ? null : (loadMetadata(workspaceRoot)?.generationId ?? null);
  const planned = await buildRenamePlan({ graph, workspaceRoot, selector, newName, indexIdentity });
  if (planned.status === 'ambiguous') {
    if (json) io.out(JSON.stringify({ error: 'ambiguous selector', candidates: planned.candidates.map((c) => ({ ...c, selector: selectorOf(c) })) }, null, 2));
    else printCandidates(planned.candidates, io);
    return AMBIGUOUS_SYMBOL_EXIT_CODE;
  }
  if (planned.status === 'missing') return fail(`no renameable symbol matches ${JSON.stringify(selector)}`);
  const plan = planned.plan;

  if (!opts.apply) {
    if (json) io.out(JSON.stringify({ mode: 'dry-run', plan }, null, 2));
    else {
      printPlanText(plan, io);
      if (plan.applicable) io.out(`  Dry run: no files changed. Apply with:\n    code-intel refactor rename ${selectorOf(plan.target)} ${newName} --apply --expect-plan ${plan.planId}\n`);
      else io.out('  Dry run: no files changed. This plan cannot be applied automatically (see boundaries).\n');
    }
    return 0;
  }

  if (opts.expectPlan && opts.expectPlan !== plan.planId) {
    return fail(`STALE_PLAN: the reviewed plan ${opts.expectPlan} no longer matches the files on disk (now ${plan.planId}); re-run the dry run`, 1, { plan });
  }
  let applied: ReturnType<typeof applyRenamePlan>;
  try {
    applied = applyRenamePlan({ plan, workspaceRoot, allowDirty: opts.allowDirty });
  } catch (error) {
    if (error instanceof RenameApplyError) {
      if (!json) printPlanText(plan, io);
      return fail(error.message, 1, { code: error.code, plan });
    }
    throw error;
  }
  const verification = await verifyAppliedRename({ plan, workspaceRoot, before: graph });
  if (json) io.out(JSON.stringify({ mode: 'apply', plan, applied, verification }, null, 2));
  else {
    io.out(`\n  ◈  Renamed ${plan.target.name} → ${plan.newName}: ${plan.edits.length} edit(s) in ${applied.files.length} file(s) (nothing staged or committed)\n`);
    printVerificationText(verification, io);
    if (verification.verdict === 'failed') io.err('  ✗  Verification failed: the files were changed but the result is not trusted. Review `git diff` and revert if needed.\n');
    else io.out('  Run `code-intel analyze` to refresh the index.\n');
  }
  return verification.verdict === 'verified' ? 0 : 1;
}
