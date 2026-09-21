/**
 * capabilities.ts
 *
 * Resolves what a connected MCP runtime can actually do, from the same
 * canonical tool inventory the server registers (`MCP_TOOL_DEFINITIONS`) —
 * never a handwritten list. `resolveWorkflowCapabilities` compares that
 * against a workflow's required/optional tool requirements so an unsupported
 * optional capability downgrades the workflow explicitly (see
 * `WorkflowOptionalCapability.fallback`) instead of the workflow inventing a
 * tool call that doesn't exist.
 */

import { MCP_TOOL_DEFINITIONS } from '../../mcp-server/tool-definitions.js';
import type { WorkflowManifest, WorkflowOptionalCapability } from './types.js';

export interface RuntimeCapabilities {
  /** Tool names registered by the connected MCP runtime. */
  toolNames: ReadonlySet<string>;
  /** Tool name -> set of top-level input schema property names. */
  toolFields: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Build `RuntimeCapabilities` from a tool definition list shaped like
 * `MCP_TOOL_DEFINITIONS` (defaults to the live inventory). Accepts an
 * override so `validator.ts` and tests can check a manifest against a
 * different/older tool set without a live server.
 */
export function resolveRuntimeCapabilities(
  toolDefinitions: ReadonlyArray<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> = MCP_TOOL_DEFINITIONS,
): RuntimeCapabilities {
  const toolNames = new Set<string>();
  const toolFields = new Map<string, ReadonlySet<string>>();
  for (const tool of toolDefinitions) {
    toolNames.add(tool.name);
    toolFields.set(tool.name, new Set(Object.keys(tool.inputSchema?.properties ?? {})));
  }
  return { toolNames, toolFields };
}

export interface MissingRequirement {
  tool: string;
  reason: 'tool-missing' | 'field-missing';
  field?: string;
  note?: string;
}

export interface DegradedCapability {
  tool: string;
  field?: string;
  fallback: string;
  reducedGuarantee: string;
}

export interface WorkflowCapabilityResolution {
  workflowId: string;
  /** True only when every required tool/field is present in `RuntimeCapabilities`. */
  satisfied: boolean;
  missingRequired: MissingRequirement[];
  /** Optional capabilities that are unavailable — the workflow must degrade using these. */
  degraded: DegradedCapability[];
}

function checkRequirement(
  req: { tool: string; fields?: string[]; note?: string },
  caps: RuntimeCapabilities,
): MissingRequirement[] {
  const missing: MissingRequirement[] = [];
  if (!caps.toolNames.has(req.tool)) {
    missing.push({ tool: req.tool, reason: 'tool-missing', note: req.note });
    return missing;
  }
  const fields = caps.toolFields.get(req.tool) ?? new Set<string>();
  for (const field of req.fields ?? []) {
    if (!fields.has(field)) {
      missing.push({ tool: req.tool, reason: 'field-missing', field, note: req.note });
    }
  }
  return missing;
}

export function resolveWorkflowCapabilities(
  manifest: WorkflowManifest,
  caps: RuntimeCapabilities = resolveRuntimeCapabilities(),
): WorkflowCapabilityResolution {
  const missingRequired = manifest.requiredTools.flatMap((req) => checkRequirement(req, caps));

  const degraded: DegradedCapability[] = [];
  for (const opt of manifest.optionalTools) {
    const missing = checkRequirement(opt, caps);
    if (missing.length === 0) continue;
    degraded.push(...missingToDegraded(opt, missing));
  }

  return {
    workflowId: manifest.id,
    satisfied: missingRequired.length === 0,
    missingRequired,
    degraded,
  };
}

function missingToDegraded(opt: WorkflowOptionalCapability, missing: MissingRequirement[]): DegradedCapability[] {
  // A missing tool degrades the whole optional capability once; missing
  // individual fields degrade per-field so the fallback text can be specific.
  const toolMissing = missing.some((m) => m.reason === 'tool-missing');
  if (toolMissing) {
    return [{ tool: opt.tool, fallback: opt.fallback, reducedGuarantee: opt.reducedGuarantee }];
  }
  return missing.map((m) => ({ tool: opt.tool, field: m.field, fallback: opt.fallback, reducedGuarantee: opt.reducedGuarantee }));
}
