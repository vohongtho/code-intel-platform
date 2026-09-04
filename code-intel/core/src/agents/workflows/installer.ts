/**
 * installer.ts
 *
 * Renders workflow manifests into per-agent files and writes them under the
 * existing agent-target-aware setup flow (`code-intel analyze` calls
 * `installWorkflows` right after `writeContextFiles` — see `cli/app.ts`).
 * There is no separate `setup-workflows` command; workflow installation is a
 * managed-file concern like `context-writer.ts`, just for files that are
 * naturally standalone (a skill/rule file per workflow) instead of a single
 * shared instruction file.
 *
 * Ownership: every installed file carries an HTML-comment fingerprint marker
 * (`<!-- code-intel:workflow-fingerprint sha256=... contentVersion=N -->`)
 * recording the sha256 of its own managed content. On the next install we
 * recompute that hash from the file *as it currently sits on disk* — if it
 * no longer matches the marker, a person edited the file since install and
 * we leave it alone (`conflict`), never silently overwriting user edits.
 * If it still matches, the file is safe to update in place, and rerunning
 * with identical manifest content produces `skip` (no file churn).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ManagedWorkflowAsset, WorkflowId, WorkflowManifest, WorkflowTarget } from './types.js';
import { listWorkflowManifests } from './registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FINGERPRINT_PREFIX = '<!-- code-intel:workflow-fingerprint ';
const FINGERPRINT_SUFFIX = ' -->';
const FINGERPRINT_RE = /sha256=([0-9a-f]{64}) contentVersion=(\d+)/;

export type WorkflowInstallAction = 'create' | 'update' | 'skip' | 'conflict' | 'not-supported';

export interface WorkflowFileState {
  workflowId: WorkflowId;
  agentId: string;
  /** Repo-relative path; empty for `not-supported`. */
  relativePath: string;
  action: WorkflowInstallAction;
  reason?: string;
  /** Populated for create/update/skip/conflict — the content that is (or would be) on disk after install. */
  asset?: ManagedWorkflowAsset;
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function atomicWriteText(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function readAssetBody(manifest: WorkflowManifest): string {
  return fs.readFileSync(path.join(__dirname, manifest.assetPath), 'utf-8').trim();
}

let cachedSharedGuide: string | null = null;
function readSharedGuide(): string {
  if (cachedSharedGuide !== null) return cachedSharedGuide;
  const raw = fs.readFileSync(path.join(__dirname, 'assets/_shared-evidence-guide.md'), 'utf-8');
  cachedSharedGuide = raw
    .replace(/^<!-- code-intel:workflow-shared-fragment -->\n?/, '')
    .replace(/\n?<!-- \/code-intel:workflow-shared-fragment -->\s*$/, '')
    .trim();
  return cachedSharedGuide;
}

interface RenderedParts {
  frontmatter: string[];
  body: string;
}

function renderParts(manifest: WorkflowManifest, target: WorkflowTarget, body: string, sharedGuide: string): RenderedParts {
  const composedBody = [`# ${manifest.title}`, '', body, '', sharedGuide, ''].join('\n');
  if (target.renderer === 'claude-skill') {
    return {
      frontmatter: ['---', `name: code-intel-workflow-${manifest.id}`, `description: ${yamlString(manifest.summary)}`, '---'],
      body: composedBody,
    };
  }
  if (target.renderer === 'cursor-mdc') {
    return {
      frontmatter: ['---', `description: ${yamlString(manifest.summary)}`, 'alwaysApply: false', '---'],
      body: composedBody,
    };
  }
  throw new Error(`Unknown workflow renderer: ${target.renderer satisfies never}`);
}

function buildMarker(fingerprint: string, contentVersion: number): string {
  return `${FINGERPRINT_PREFIX}sha256=${fingerprint} contentVersion=${contentVersion}${FINGERPRINT_SUFFIX}`;
}

/**
 * Strip a previously-inserted fingerprint marker line to recover the logical
 * content it was computed over. `assemble()` lays out
 * `[...frontmatter, '', marker, '', body]` — i.e. one blank line on each
 * side of the marker — while `logicalContent` (what the fingerprint is
 * actually hashed over) is `[...frontmatter, '', body]`, a single blank
 * line. So exactly one of the two blank lines around the marker belongs to
 * the logical content and must be kept; only the other one is removed along
 * with the marker line itself.
 */
function stripMarker(content: string): string {
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(FINGERPRINT_PREFIX));
  if (idx === -1) return content;
  const before = lines.slice(0, idx);
  const after = lines.slice(idx + 1);
  if (before[before.length - 1] === '') before.pop();
  return [...before, ...after].join('\n');
}

function parseMarker(content: string): { fingerprint: string; contentVersion: number } | null {
  const line = content.split('\n').find((l) => l.startsWith(FINGERPRINT_PREFIX));
  if (!line) return null;
  const m = FINGERPRINT_RE.exec(line);
  if (!m) return null;
  return { fingerprint: m[1] ?? '', contentVersion: Number(m[2]) };
}

function renderAsset(manifest: WorkflowManifest, target: WorkflowTarget, body: string, sharedGuide: string): ManagedWorkflowAsset {
  const parts = renderParts(manifest, target, body, sharedGuide);
  const logicalContent = [...parts.frontmatter, '', parts.body].join('\n');
  const fingerprint = sha256(logicalContent);
  const marker = buildMarker(fingerprint, manifest.contentVersion);
  const content = [...parts.frontmatter, '', marker, '', parts.body].join('\n');
  return {
    workflowId: manifest.id,
    agentId: target.agentId,
    path: target.pathTemplate,
    format: 'markdown',
    content,
    fingerprint,
    contentVersion: manifest.contentVersion,
  };
}

function planOne(workspaceRoot: string, manifest: WorkflowManifest, target: WorkflowTarget, body: string, sharedGuide: string): WorkflowFileState {
  const asset = renderAsset(manifest, target, body, sharedGuide);
  const absPath = path.join(workspaceRoot, asset.path);

  if (!fs.existsSync(absPath)) {
    return { workflowId: manifest.id, agentId: target.agentId, relativePath: asset.path, action: 'create', asset };
  }

  const existing = fs.readFileSync(absPath, 'utf-8');
  const existingMarker = parseMarker(existing);
  if (!existingMarker) {
    return {
      workflowId: manifest.id,
      agentId: target.agentId,
      relativePath: asset.path,
      action: 'conflict',
      reason: 'existing file has no Code Intel fingerprint marker — not managed by this installer',
      asset,
    };
  }

  const existingLogicalFingerprint = sha256(stripMarker(existing));
  if (existingLogicalFingerprint !== existingMarker.fingerprint) {
    return {
      workflowId: manifest.id,
      agentId: target.agentId,
      relativePath: asset.path,
      action: 'conflict',
      reason: 'file was modified since the last managed install — refusing to overwrite user edits',
      asset,
    };
  }

  if (existingMarker.fingerprint === asset.fingerprint) {
    return { workflowId: manifest.id, agentId: target.agentId, relativePath: asset.path, action: 'skip', reason: 'unchanged', asset };
  }

  return { workflowId: manifest.id, agentId: target.agentId, relativePath: asset.path, action: 'update', asset };
}

/**
 * Compute the install plan for the given selected agent ids, without writing
 * anything. Every (workflow, selected agent) pair produces exactly one
 * `WorkflowFileState` — `not-supported` when the agent has no renderer.
 */
export function planWorkflowInstall(
  workspaceRoot: string,
  selectedAgentIds: string[],
  manifests: WorkflowManifest[] = listWorkflowManifests(),
): WorkflowFileState[] {
  const sharedGuide = readSharedGuide();
  const states: WorkflowFileState[] = [];
  for (const manifest of manifests) {
    const body = readAssetBody(manifest);
    for (const agentId of selectedAgentIds) {
      const target = manifest.targets.find((t) => t.agentId === agentId);
      if (!target) {
        states.push({ workflowId: manifest.id, agentId, relativePath: '', action: 'not-supported' });
        continue;
      }
      states.push(planOne(workspaceRoot, manifest, target, body, sharedGuide));
    }
  }
  return states;
}

export interface InstallWorkflowsOptions {
  manifests?: WorkflowManifest[];
  /** When true, only compute the plan — never write. Equivalent to `planWorkflowInstall`, kept for call-site symmetry with the writing path. */
  dryRun?: boolean;
}

/** Compute the plan and, unless `dryRun`, write every `create`/`update` file. Idempotent: rerunning with unchanged manifests writes nothing (all `skip`). */
export function installWorkflows(
  workspaceRoot: string,
  selectedAgentIds: string[],
  options: InstallWorkflowsOptions = {},
): WorkflowFileState[] {
  const states = planWorkflowInstall(workspaceRoot, selectedAgentIds, options.manifests);
  if (options.dryRun) return states;
  for (const state of states) {
    if ((state.action !== 'create' && state.action !== 'update') || !state.asset) continue;
    const absPath = path.join(workspaceRoot, state.relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    atomicWriteText(absPath, state.asset.content);
  }
  return states;
}
