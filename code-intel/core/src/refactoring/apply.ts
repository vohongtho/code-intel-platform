/**
 * Rename application. Writes only the exact edits of an applicable plan, after
 * re-checking every precondition against the files on disk:
 *
 * - the plan is applicable (no boundary) and its capability is `apply`;
 * - each file still matches the plan fingerprint (stale plans are refused);
 * - each file is a regular file inside the workspace root (no symlinks, no
 *   escape) and not generated/vendored;
 * - uncommitted changes in those files need explicit `allowDirty`.
 *
 * All new contents are computed before the first write. Files are replaced via
 * same-directory temp files; if any replacement fails, already-replaced files
 * are restored. Nothing is staged or committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { RENAME_PLAN_SCHEMA_VERSION, getRefactoringCapability, type RenameEdit, type RenamePlan } from './contracts.js';
import { isGeneratedPath } from './edit-spans.js';
import { isValidRenameIdentifier } from './rename-plan.js';

export type RenameApplyErrorCode = 'NOT_APPLICABLE' | 'STALE_PLAN' | 'DIRTY_TREE' | 'PATH_ESCAPE' | 'GENERATED_FILE' | 'SPAN_MISMATCH' | 'WRITE_FAILED';

export class RenameApplyError extends Error {
  constructor(readonly code: RenameApplyErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RenameApplyError';
  }
}

export interface ApplyRenameOptions {
  plan: RenamePlan;
  workspaceRoot: string;
  allowDirty?: boolean;
}

export interface ApplyRenameResult {
  planId: string;
  files: Array<{ filePath: string; edits: number; sha256Before: string; sha256After: string }>;
}

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

/** Paths with uncommitted changes, or null when the workspace is not a Git work tree. */
function dirtyFiles(workspaceRoot: string, files: string[]): string[] | null {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...files], { cwd: workspaceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).map((line) => line.slice(3));
  } catch {
    return null;
  }
}

function applyEdits(text: string, edits: RenameEdit[], filePath: string): string {
  const ordered = [...edits].sort((a, b) => b.startOffset - a.startOffset);
  let next = text;
  let limit = Infinity;
  for (const edit of ordered) {
    if (edit.endOffset > limit) throw new RenameApplyError('SPAN_MISMATCH', `overlapping edits in ${filePath}`);
    if (next.slice(edit.startOffset, edit.endOffset) !== edit.oldText) {
      throw new RenameApplyError('SPAN_MISMATCH', `${filePath}@${edit.startOffset} no longer contains ${edit.oldText}`);
    }
    next = `${next.slice(0, edit.startOffset)}${edit.newText}${next.slice(edit.endOffset)}`;
    limit = edit.startOffset;
  }
  return next;
}

/**
 * Structural consistency of a plan, independent of how it was obtained: every
 * edit replaces the target name with the (valid) new name inside a
 * fingerprinted file. Guards against a hand-edited or corrupted plan turning
 * apply into an arbitrary text writer.
 */
function assertPlanConsistent(plan: RenamePlan): void {
  if (plan.schemaVersion !== RENAME_PLAN_SCHEMA_VERSION) throw new RenameApplyError('NOT_APPLICABLE', `unsupported plan schema ${String(plan.schemaVersion)}`);
  if (!isValidRenameIdentifier(plan.newName)) throw new RenameApplyError('NOT_APPLICABLE', `${JSON.stringify(plan.newName)} is not a valid identifier`);
  const fingerprinted = new Set(plan.fingerprint.files.map((f) => f.filePath));
  if (fingerprinted.size !== plan.fingerprint.files.length) throw new RenameApplyError('NOT_APPLICABLE', 'duplicate file in plan fingerprint');
  const edited = new Set<string>();
  for (const edit of plan.edits) {
    if (!fingerprinted.has(edit.filePath)) throw new RenameApplyError('NOT_APPLICABLE', `edit in ${edit.filePath} is not covered by the plan fingerprint`);
    if (edit.oldText !== plan.target.name || edit.newText !== plan.newName) throw new RenameApplyError('NOT_APPLICABLE', `edit in ${edit.filePath} is not a ${plan.target.name} → ${plan.newName} replacement`);
    if (!Number.isInteger(edit.startOffset) || edit.endOffset - edit.startOffset !== edit.oldText.length || edit.startOffset < 0) {
      throw new RenameApplyError('NOT_APPLICABLE', `edit in ${edit.filePath} has an invalid range`);
    }
    edited.add(edit.filePath);
  }
  for (const filePath of fingerprinted) if (!edited.has(filePath)) throw new RenameApplyError('NOT_APPLICABLE', `${filePath} is fingerprinted but has no edits`);
}

export function applyRenamePlan(options: ApplyRenameOptions): ApplyRenameResult {
  const { plan } = options;
  if (!plan.applicable || plan.capability.rename !== 'apply') {
    const reasons = plan.boundaries.map((b) => `${b.kind}: ${b.message}`).join('; ') || `capability is ${plan.capability.rename}`;
    throw new RenameApplyError('NOT_APPLICABLE', reasons);
  }
  // Never trust the plan's own capability claim: the published matrix decides.
  if (getRefactoringCapability(plan.target.language).rename !== 'apply') {
    throw new RenameApplyError('NOT_APPLICABLE', `${plan.target.language ?? 'unknown'} rename is not enabled for apply`);
  }
  assertPlanConsistent(plan);
  const root = path.resolve(options.workspaceRoot);
  const realRoot = fs.realpathSync(root);
  const files = plan.fingerprint.files.map((f) => f.filePath);

  const prepared = plan.fingerprint.files.map(({ filePath, sha256: expected }) => {
    const absolute = path.resolve(root, filePath);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new RenameApplyError('PATH_ESCAPE', `${filePath} is outside the workspace`);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) throw new RenameApplyError('STALE_PLAN', `${filePath} no longer exists`);
    if (!stat.isFile()) throw new RenameApplyError('PATH_ESCAPE', `${filePath} is not a regular file (symlinks are never edited)`);
    const realRelative = path.relative(realRoot, fs.realpathSync(absolute));
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new RenameApplyError('PATH_ESCAPE', `${filePath} resolves outside the workspace`);
    if (isGeneratedPath(filePath)) throw new RenameApplyError('GENERATED_FILE', `${filePath} is generated or vendored`);
    const before = fs.readFileSync(absolute, 'utf8');
    if (sha256(before) !== expected) throw new RenameApplyError('STALE_PLAN', `${filePath} changed since the plan was built; re-plan`);
    const edits = plan.edits.filter((edit) => edit.filePath === filePath);
    return { filePath, absolute, mode: stat.mode, before, after: applyEdits(before, edits, filePath), edits: edits.length };
  });

  if (!options.allowDirty) {
    const dirty = dirtyFiles(root, files);
    if (dirty === null) throw new RenameApplyError('DIRTY_TREE', 'workspace is not a Git work tree, so there is no recovery point; pass allowDirty to proceed');
    if (dirty.length > 0) throw new RenameApplyError('DIRTY_TREE', `uncommitted changes in ${dirty.sort().join(', ')}; commit/stash them or pass allowDirty`);
  }

  const temps = prepared.map((file) => path.join(path.dirname(file.absolute), `.${path.basename(file.absolute)}.code-intel-rename-${process.pid}`));
  const replaced: number[] = [];
  try {
    // `wx`: never follow or clobber something already sitting at the temp path.
    prepared.forEach((file, i) => fs.writeFileSync(temps[i], file.after, { encoding: 'utf8', mode: file.mode & 0o777, flag: 'wx' }));
    prepared.forEach((file, i) => {
      fs.renameSync(temps[i], file.absolute);
      replaced.push(i);
    });
  } catch (error) {
    for (const i of replaced) {
      try { fs.writeFileSync(prepared[i].absolute, prepared[i].before, 'utf8'); } catch { /* reported below */ }
    }
    for (const temp of temps) fs.rmSync(temp, { force: true });
    throw new RenameApplyError('WRITE_FAILED', `${error instanceof Error ? error.message : String(error)}; ${replaced.length} file(s) restored`);
  }

  return {
    planId: plan.planId,
    files: prepared.map((file) => ({ filePath: file.filePath, edits: file.edits, sha256Before: sha256(file.before), sha256After: sha256(file.after) })),
  };
}
