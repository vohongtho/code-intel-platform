/**
 * types.ts
 *
 * Type contracts for Code Intel's graph-backed agent workflows: task-specific
 * playbooks (exploration, debugging, impact analysis, planning, review,
 * API review, test/coverage, security investigation) that guide an agent to
 * use existing MCP tools in the right order, with explicit trust/uncertainty
 * handling. Workflows are versioned product assets, not strings baked into
 * the MCP handlers — see `registry.ts` for the manifest instances and
 * `installer.ts` for how they get written into a repo.
 */

/** Stable identifier for one of Code Intel's bundled workflows. */
export type WorkflowId =
  | 'explore'
  | 'debug'
  | 'impact'
  | 'plan'
  | 'review'
  | 'api-review'
  | 'test-coverage'
  | 'security-investigation';

/** Bump when the shape of `WorkflowManifest`/`ManagedWorkflowAsset` changes. */
export const WORKFLOW_MANIFEST_SCHEMA_VERSION = 1;

/**
 * A requirement on one MCP tool. `fields`, when present, are input property
 * names the workflow asset references by name (e.g. "target" on
 * `blast_radius`) — `validator.ts` checks these against the tool's live
 * input schema so a renamed/removed field fails release validation instead
 * of shipping broken instructions.
 */
export interface WorkflowCapabilityRequirement {
  /** MCP tool name, must exist in `MCP_TOOL_DEFINITIONS`. */
  tool: string;
  /** Input schema property names this workflow relies on, if any. */
  fields?: string[];
  /**
   * Short note on why the workflow needs this tool/field — surfaced in
   * validation failures and docs, not shown to the agent at runtime.
   */
  note?: string;
}

/**
 * An optional capability requirement. Unlike `WorkflowCapabilityRequirement`,
 * this MUST declare `fallback`: what the workflow does instead, and what
 * guarantee is lost, when the capability is unavailable on the connected
 * runtime. `capabilities.ts` uses this to decide whether a workflow step
 * should be downgraded rather than invented.
 */
export interface WorkflowOptionalCapability extends WorkflowCapabilityRequirement {
  /** What the workflow falls back to when this capability is absent. */
  fallback: string;
  /** The guarantee that is lost while running in the fallback mode. */
  reducedGuarantee: string;
}

/** One agent target a workflow can be rendered/installed for. */
export interface WorkflowTarget {
  /** Matches `AgentOption.id` in `cli/agent-targets.ts`. */
  agentId: string;
  /**
   * Repo-relative destination path template. `{id}` is substituted with the
   * workflow id. Directory is created if missing.
   */
  pathTemplate: string;
  /** Rendering flavor — front matter/wrapper differs slightly per format. */
  renderer: 'claude-skill' | 'cursor-mdc';
}

/** A workflow manifest: everything needed to validate, render, and install one workflow. */
export interface WorkflowManifest {
  id: WorkflowId;
  title: string;
  /** One-sentence summary, used in docs and in generated front matter/description fields. */
  summary: string;
  /** Path (relative to this file's directory) to the markdown source asset. */
  assetPath: string;
  /** MCP tools/fields the workflow requires — validation fails release if any is missing. */
  requiredTools: WorkflowCapabilityRequirement[];
  /** MCP tools/fields the workflow uses opportunistically, with a stated fallback. */
  optionalTools: WorkflowOptionalCapability[];
  /** Minimum Code Intel package version this workflow assumes (semver). */
  minCodeIntelVersion: string;
  /** Agent targets this workflow has a renderer for; others report `not-supported`. */
  targets: WorkflowTarget[];
  /** Bumped whenever `assetPath`'s content changes in a way that should force a reinstall prompt for modified files. */
  contentVersion: number;
}

/** A workflow rendered for one concrete agent target, ready to write to disk. */
export interface ManagedWorkflowAsset {
  workflowId: WorkflowId;
  agentId: string;
  /** Repo-relative destination path. */
  path: string;
  format: 'markdown';
  content: string;
  /** sha256 of `content`, used for ownership/idempotency checks by `installer.ts`. */
  fingerprint: string;
  contentVersion: number;
}
