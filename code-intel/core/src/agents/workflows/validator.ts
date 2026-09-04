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
  const issues = manifests.flatMap((manifest) => [
    ...validateToolReferences(manifest, caps),
    ...validateAsset(manifest),
    ...validateTargets(manifest, knownAgentIds),
  ]);
  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}
