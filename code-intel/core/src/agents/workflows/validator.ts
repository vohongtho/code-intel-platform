/**
 * validator.ts
 *
 * Release-time validation for the workflow registry. Fails when a manifest
 * references an MCP tool or input field that no longer exists, when an
 * asset file is missing/empty, or when a target names an unknown agent —
 * so a renamed/removed tool breaks CI instead of shipping broken workflow
 * instructions (spec: "Workflow references MUST match runtime schemas").
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_OPTIONS } from '../../cli/agent-targets.js';
import { resolveRuntimeCapabilities, resolveWorkflowCapabilities, type RuntimeCapabilities } from './capabilities.js';
import { listWorkflowManifests } from './registry.js';
import type { WorkflowManifest } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WorkflowValidationIssue {
  workflowId: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface WorkflowValidationReport {
  ok: boolean;
  issues: WorkflowValidationIssue[];
}

function validateToolReferences(manifest: WorkflowManifest, caps: RuntimeCapabilities): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const resolution = resolveWorkflowCapabilities(manifest, caps);

  for (const missing of resolution.missingRequired) {
    issues.push({
      workflowId: manifest.id,
      severity: 'error',
      message:
        missing.reason === 'tool-missing'
          ? `required tool '${missing.tool}' is not registered by the MCP server${missing.note ? ` (${missing.note})` : ''}`
          : `required tool '${missing.tool}' no longer has input field '${missing.field}'${missing.note ? ` (${missing.note})` : ''}`,
    });
  }

  // Optional tools only *degrade* a workflow when absent at runtime, but a
  // typo'd/renamed optional tool name in the manifest would silently never
  // fire its intended capability check — that's still a manifest bug.
  for (const opt of manifest.optionalTools) {
    if (!caps.toolNames.has(opt.tool)) {
      issues.push({
        workflowId: manifest.id,
        severity: 'error',
        message: `optional tool '${opt.tool}' referenced by manifest does not exist in the MCP tool inventory — check for a rename/typo`,
      });
      continue;
    }
    const fields = caps.toolFields.get(opt.tool) ?? new Set<string>();
    for (const field of opt.fields ?? []) {
      if (!fields.has(field)) {
        issues.push({
          workflowId: manifest.id,
          severity: 'error',
          message: `optional tool '${opt.tool}' no longer has input field '${field}'`,
        });
      }
    }
  }

  return issues;
}

function validateAsset(manifest: WorkflowManifest): WorkflowValidationIssue[] {
  const assetAbsPath = path.join(__dirname, manifest.assetPath);
  if (!fs.existsSync(assetAbsPath)) {
    return [{ workflowId: manifest.id, severity: 'error', message: `asset file missing: ${manifest.assetPath}` }];
  }
  if (fs.readFileSync(assetAbsPath, 'utf-8').trim().length === 0) {
    return [{ workflowId: manifest.id, severity: 'error', message: `asset file is empty: ${manifest.assetPath}` }];
  }
  return [];
}

const TOOL_MENTION = /`([a-z][a-z0-9_]*)`/g;

function mentionedTools(text: string, caps: RuntimeCapabilities): string[] {
  return [...new Set([...text.matchAll(TOOL_MENTION)].map((match) => match[1]!).filter((name) => caps.toolNames.has(name)))].sort();
}

/**
 * An asset may only name MCP tools its manifest declares (required or
 * optional) — declared tools are in turn checked against the live inventory
 * above, so an asset can never tell an agent to call a tool the runtime does
 * not register without failing release validation.
 */
function validateAssetToolMentions(manifest: WorkflowManifest, caps: RuntimeCapabilities): WorkflowValidationIssue[] {
  const assetAbsPath = path.join(__dirname, manifest.assetPath);
  if (!fs.existsSync(assetAbsPath)) return [];
  const declared = new Set([...manifest.requiredTools, ...manifest.optionalTools].map((req) => req.tool));
  return mentionedTools(fs.readFileSync(assetAbsPath, 'utf-8'), caps)
    .filter((tool) => !declared.has(tool))
    .map((tool) => ({ workflowId: manifest.id, severity: 'error' as const, message: `asset names tool '${tool}' that the manifest does not declare (add it to requiredTools/optionalTools)` }));
}

const SHARED_FRAGMENTS = [
  { file: 'assets/_shared-evidence-guide.md', requiresTool: undefined },
  { file: 'assets/_change-session-guide.md', requiresTool: 'change_workflow' },
] as const;

/**
 * Shared fragments are rendered into many workflows: every tool they name
 * must exist in the live inventory, and a gated fragment (the change-session
 * guide) may only name its gating tool plus tools every gated manifest declares.
 */
function validateSharedFragments(manifests: WorkflowManifest[], caps: RuntimeCapabilities): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  for (const fragment of SHARED_FRAGMENTS) {
    const abs = path.join(__dirname, fragment.file);
    if (!fs.existsSync(abs) || fs.readFileSync(abs, 'utf-8').trim().length === 0) {
      issues.push({ workflowId: '*', severity: 'error', message: `shared fragment missing or empty: ${fragment.file}` });
      continue;
    }
    const text = fs.readFileSync(abs, 'utf-8');
    const backticked = [...new Set([...text.matchAll(TOOL_MENTION)].map((match) => match[1]!))];
    if (fragment.requiresTool && !caps.toolNames.has(fragment.requiresTool)) {
      issues.push({ workflowId: '*', severity: 'error', message: `${fragment.file} is gated on '${fragment.requiresTool}', which the MCP server does not register` });
    }
    if (!fragment.requiresTool) continue;
    const gated = manifests.filter((m) => [...m.requiredTools, ...m.optionalTools].some((req) => req.tool === fragment.requiresTool));
    for (const tool of mentionedTools(text, caps)) {
      if (tool === fragment.requiresTool) continue;
      for (const manifest of gated) {
        if (![...manifest.requiredTools, ...manifest.optionalTools].some((req) => req.tool === tool)) {
          issues.push({ workflowId: manifest.id, severity: 'error', message: `${fragment.file} names tool '${tool}' that this manifest does not declare` });
        }
      }
    }
    // Field names the gated fragment relies on must still exist on the gating tool.
    const fields = caps.toolFields.get(fragment.requiresTool) ?? new Set<string>();
    for (const field of ['action', 'session_id', 'expected_revision', 'conditions', 'remove_condition_ids', 'step_id', 'targets', 'scope', 'group']) {
      if (backticked.includes(field) && !fields.has(field)) {
        issues.push({ workflowId: '*', severity: 'error', message: `${fragment.file} references '${fragment.requiresTool}' field '${field}', which no longer exists` });
      }
    }
  }
  return issues;
}

function validateTargets(manifest: WorkflowManifest, knownAgentIds: ReadonlySet<string>): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  if (manifest.targets.length === 0) {
    issues.push({ workflowId: manifest.id, severity: 'error', message: 'manifest declares no targets' });
  }
  for (const target of manifest.targets) {
    if (!knownAgentIds.has(target.agentId)) {
      issues.push({
        workflowId: manifest.id,
        severity: 'error',
        message: `target agentId '${target.agentId}' is not a known agent (see AGENT_OPTIONS in cli/agent-targets.ts)`,
      });
    }
  }
  return issues;
}

/**
 * Validate every workflow manifest against a live (or injected, for tests)
 * runtime tool inventory. Pass a narrower `caps` to simulate an older
 * runtime missing a specific tool.
 */
export function validateWorkflowRegistry(
  manifests: WorkflowManifest[] = listWorkflowManifests(),
  caps: RuntimeCapabilities = resolveRuntimeCapabilities(),
): WorkflowValidationReport {
  const knownAgentIds = new Set(AGENT_OPTIONS.map((a) => a.id));
  const issues = [
    ...manifests.flatMap((manifest) => [
      ...validateToolReferences(manifest, caps),
      ...validateAsset(manifest),
      ...validateAssetToolMentions(manifest, caps),
      ...validateTargets(manifest, knownAgentIds),
    ]),
    ...validateSharedFragments(manifests, caps),
  ];
  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}
