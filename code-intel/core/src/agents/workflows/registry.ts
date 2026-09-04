/**
 * registry.ts
 *
 * The 8 bundled workflow manifests. Every `tool` referenced here MUST exist
 * in `MCP_TOOL_DEFINITIONS` (`mcp-server/tool-definitions.ts`) — `validator.ts`
 * enforces this at release time so a renamed/removed tool fails validation
 * instead of shipping a workflow that tells an agent to call a tool that no
 * longer exists.
 */

import type { WorkflowId, WorkflowManifest, WorkflowTarget } from './types.js';

const CODE_INTEL_VERSION = '1.0.11';

function targetsFor(id: WorkflowId): WorkflowTarget[] {
  return [
    { agentId: 'claude', pathTemplate: `.claude/skills/code-intel-workflows/${id}/SKILL.md`, renderer: 'claude-skill' },
    { agentId: 'cursor', pathTemplate: `.cursor/rules/code-intel-workflow-${id}.mdc`, renderer: 'cursor-mdc' },
  ];
}

export const WORKFLOW_REGISTRY: Record<WorkflowId, WorkflowManifest> = {
  explore: {
    id: 'explore',
    title: 'Codebase Exploration',
    summary: 'Scope a repo/group, find the right symbols, and build an evidence-backed picture of how a part of the codebase works before changing anything.',
    assetPath: './assets/explore.md',
    minCodeIntelVersion: CODE_INTEL_VERSION,
    contentVersion: 1,
    targets: targetsFor('explore'),
    requiredTools: [
      { tool: 'search', fields: ['query', 'scope'], note: 'primary discovery step' },
      { tool: 'inspect', fields: ['symbol_name'], note: 'canonical 360° view of a selected symbol' },
      { tool: 'file_symbols', fields: ['file_path'], note: 'what a file exports without reading it raw' },
      { tool: 'context', fields: ['symbols', 'task'], note: 'token-budgeted evidence bundle for the selected symbols' },
    ],
    optionalTools: [
      {
        tool: 'routes',
        fallback: 'skip route-level architecture evidence',
        reducedGuarantee: 'cannot claim the explored area is (or is not) reachable via an HTTP route',
      },
      {
        tool: 'flows',
        fallback: 'skip execution-flow evidence',
        reducedGuarantee: 'cannot cite a named entry-to-exit flow for the explored area',
      },
      {
        tool: 'explain_relationship',
        fields: ['from', 'to'],
        fallback: 'use inspect + blast_radius to approximate the relationship instead of a direct path/heritage answer',
        reducedGuarantee: 'relationship claims are inferred from two one-sided views, not a proven path',
      },
      {
        tool: 'group_status',
        fields: ['name'],
        fallback: 'treat the scope as a single repo and say so explicitly',
        reducedGuarantee: 'cannot confirm every member repo of a group is indexed/fresh before cross-repo exploration',
      },
    ],
  },

  debug: {
    id: 'debug',
    title: 'Debugging / Root-Cause Investigation',
    summary: 'Localize a symptom to graph evidence, rank hypotheses by what the call graph actually shows, and require a falsification step before recommending an edit.',
    assetPath: './assets/debug.md',
    minCodeIntelVersion: CODE_INTEL_VERSION,
    contentVersion: 1,
    targets: targetsFor('debug'),
    requiredTools: [
      { tool: 'search', fields: ['query'], note: 'localize the symptom to candidate symbols' },
      { tool: 'inspect', fields: ['symbol_name'], note: 'canonical identity + callers/callees for a candidate' },
      { tool: 'blast_radius', fields: ['target', 'direction'], note: 'who calls/depends on the suspect symbol' },
      { tool: 'find_path', fields: ['from', 'to'], note: 'prove or disprove a suspected call path between two symbols' },
    ],
    optionalTools: [
      {
        tool: 'explain_relationship',
        fields: ['from', 'to'],
        fallback: 'rely on find_path alone for path evidence',
        reducedGuarantee: 'no shared-import or heritage evidence, only a raw call/import path',
      },
      {
        tool: 'detect_changes',
        fields: ['base_ref'],
        fallback: 'ask the user which files changed recently instead of deriving it from git',
        reducedGuarantee: 'cannot correlate the symptom with a specific recent change automatically',
      },
    ],
  },

  impact: {
    id: 'impact',
    title: 'Change / Blast-Radius Analysis',
    summary: 'Turn a diff into directly-changed symbols, exact downstream impact, candidate/heuristic impact, and suggested tests — never collapsing "small result count" into "low risk".',
    assetPath: './assets/impact.md',
    minCodeIntelVersion: CODE_INTEL_VERSION,
    contentVersion: 1,
    targets: targetsFor('impact'),
    requiredTools: [
      { tool: 'detect_changes', fields: ['base_ref', 'diff_text'], note: 'maps a git diff to changed graph symbols' },
      { tool: 'blast_radius', fields: ['target', 'direction', 'max_hops'], note: 'downstream impact per changed symbol' },
      { tool: 'pr_impact', fields: ['changedFiles', 'diff', 'maxHops'], note: 'combined multi-file blast radius with risk scoring' },
      { tool: 'suggest_tests', fields: ['symbol'], note: 'evidence-backed test suggestions per changed symbol' },
    ],
    optionalTools: [
      {
        tool: 'flows',
        fallback: 'skip flow-level impact and say execution-flow impact was not checked',
        reducedGuarantee: 'cannot state whether a named execution flow is affected',
      },
      {
        tool: 'routes',
        fallback: 'skip route-level impact',
        reducedGuarantee: 'cannot state whether an HTTP route is affected',
      },
      {
        tool: 'api_impact',
        fallback: 'approximate API impact from pr_impact/blast_radius on the route handler symbol only',
        reducedGuarantee: 'consumer match certainty for the route is not proven, only handler-level graph impact',
      },
      {
        tool: 'graph_diff',
        fields: ['base_ref', 'head_ref'],
        fallback: 'use pr_impact analysisMode=current-graph only (textual-hunk blast radius)',
        reducedGuarantee: 'no independent semantic-graph diff between refs — added/removed/renamed symbol detection is unavailable',
      },
      {
        tool: 'group_contracts',
        fields: ['name'],
        fallback: 'state that cross-repo consumer evidence is unavailable without a synced group',
        reducedGuarantee: 'cannot confirm or rule out impact on a consumer repo outside the current repo/group sync',
      },
    ],
  },

  plan: {
    id: 'plan',
    title: 'Implementation Planning',
    summary: 'Identify canonical target symbols, owners, consumers, contracts, flows, and tests before proposing any file edit, distinguishing required edits from candidate edits.',
    assetPath: './assets/plan.md',
    minCodeIntelVersion: CODE_INTEL_VERSION,
    contentVersion: 1,
    targets: targetsFor('plan'),
    requiredTools: [
      { tool: 'search', fields: ['query'], note: 'locate candidate target symbols' },
      { tool: 'inspect', fields: ['symbol_name'], note: 'canonical identity, callers/callees, source location' },
      { tool: 'blast_radius', fields: ['target', 'direction'], note: 'who is affected by editing the target' },
      { tool: 'context', fields: ['symbols', 'task', 'intent'], note: 'token-budgeted evidence bundle for plan steps' },
    ],
    optionalTools: [
      {
        tool: 'routes',
        fallback: 'skip route ownership evidence for the plan',
        reducedGuarantee: 'cannot state which HTTP route(s) a planned change affects',
      },
      {
        tool: 'api_contract',
        fields: ['method', 'path', 'route_node_id'],
        fallback: 'use routes + source reading for request/response shape',
        reducedGuarantee: 'request/response shape and known-consumer evidence for a route is not proven',
      },
      {
        tool: 'api_impact',
        fields: ['method', 'path', 'route_node_id'],
        fallback: 'use blast_radius on the route handler symbol as a proxy for consumer impact',
        reducedGuarantee: 'consumer match strategy/certainty for a route is not available, only handler-level graph proximity',
      },
      {
        tool: 'flows',
        fallback: 'skip named execution-flow evidence in the plan',
        reducedGuarantee: 'cannot cite which execution flow a planned change sits in',
      },
      {
        tool: 'suggest_tests',
        fields: ['symbol'],
        fallback: 'list existing tests found via file_symbols/search near the target instead of ranked suggestions',
        reducedGuarantee: 'test suggestions are not ranked by call-path coverage',
      },
      {
        tool: 'group_contracts',
        fields: ['name'],
        fallback: 'state that cross-repo consumer evidence is unavailable without a synced group',
        reducedGuarantee: 'cannot confirm which consumer repos a planned contract change affects',
      },
    ],
  },

  review: {
    id: 'review',
    title: 'Code Review',
    summary: 'Review changed symbols first, then broaden to impact/health/complexity/coverage/security signal only as relevant to the diff, with severity tied to demonstrated behavior.',
    assetPath: './assets/review.md',
    minCodeIntelVersion: CODE_INTEL_VERSION,
    contentVersion: 1,
    targets: targetsFor('review'),
    requiredTools: [
      { tool: 'detect_changes', fields: ['base_ref', 'diff_text'], note: 'changed files/symbols is the review scope' },
      { tool: 'pr_impact', fields: ['changedFiles', 'diff'], note: 'blast radius + risk scoring for the diff' },
      { tool: 'health_report', fields: ['scope'], note: 'dead code, cycles, god nodes, orphan files near the change' },
    ],
    optionalTools: [
      {
        tool: 'complexity_hotspots',
        fields: ['scope'],
        fallback: 'skip complexity-based findings',
        reducedGuarantee: 'cannot rank changed functions by cyclomatic complexity',
      },
      {
        tool: 'coverage_gaps',
        fields: ['scope'],
        fallback: 'skip coverage-based findings',
        reducedGuarantee: 'cannot flag changed exported symbols with no test coverage',
      },
      {
        tool: 'deprecated_usage',
        fields: ['scope'],
        fallback: 'skip deprecated-API findings',
        reducedGuarantee: 'cannot flag newly introduced calls to deprecated APIs',
      },
      {
        tool: 'secrets',
        fields: ['scope'],
        fallback: 'skip secret-scan findings',
        reducedGuarantee: 'cannot rule out hardcoded secrets in the diff',
      },
      {
        tool: 'vulnerability_scan',
        fields: ['scope', 'types'],
        fallback: 'skip vulnerability-scan findings',
        reducedGuarantee: 'cannot rule out OWASP-class issues in the diff',
      },
      {
        tool: 'blast_radius',
        fields: ['target', 'direction'],
        fallback: 'rely on pr_impact alone for a changed symbol\'s downstream impact',
        reducedGuarantee: 'cannot independently confirm a specific caller assumption beyond what pr_impact already reports',
      },
      {
        tool: 'explain_relationship',
        fields: ['from', 'to'],
        fallback: 'rely on blast_radius/pr_impact for relationship evidence instead of a direct path/heritage answer',
        reducedGuarantee: 'no proven direct path/heritage evidence for a specific caller assumption',
      },
    ],
  },

  'api-review': {
    id: 'api-review',
    title: 'API Contract Review',
    summary: 'Review HTTP method/path/request/response/consumer changes using graph-aware API contract tools when registered, falling back to routes + pr_impact with an explicit capability boundary otherwise.',
    assetPath: './assets/api-review.md',
    minCodeIntelVersion: CODE_INTEL_VERSION,
    contentVersion: 1,
    targets: targetsFor('api-review'),
    requiredTools: [
      { tool: 'routes', note: 'baseline route inventory, always available' },
      { tool: 'pr_impact', fields: ['changedFiles', 'diff'], note: 'always-available fallback impact for route handler symbols' },
    ],
    optionalTools: [
      {
        tool: 'api_contract',
        fields: ['method', 'path', 'route_node_id'],
        fallback: 'read routes + the handler source directly for request/response shape',
        reducedGuarantee: 'request/response field-level requiredness and coverage is not proven, only route existence',
      },
      {
        tool: 'api_impact',
        fields: ['method', 'path', 'route_node_id'],
        fallback: 'use pr_impact/blast_radius on the route handler symbol as a proxy for consumer impact',
        reducedGuarantee: 'consumer match strategy/certainty is not available — impact is graph-proximity only, not proven fetch/HttpClient call sites',
      },
      {
        tool: 'api_drift',
        fields: ['base_repo_id', 'head_repo_id'],
        fallback: 'call routes/api_contract on each indexed repo separately and diff the results manually',
        reducedGuarantee: 'no compatibility classification (compatible/breaking/unknown) — the agent must derive it and must label it as inferred',
      },
      {
        tool: 'group_contracts',
        fields: ['name', 'kind'],
        fallback: 'state that cross-repo consumer evidence is unavailable without a synced group',
        reducedGuarantee: 'cannot identify consumer repos outside the current repo/group sync',
      },
      {
        tool: 'group_contract_drift',
        fields: ['name', 'base_ref', 'head_ref'],
        fallback: 'use api_drift on the two indexed repos directly, or state that a synced-group drift check was not run',
        reducedGuarantee: 'no group-wide compatibility classification across every member repo/ref, only whatever pair was checked directly',
      },
    ],
  },

  'test-coverage': {
    id: 'test-coverage',
    title: 'Test Selection / Coverage Investigation',
    summary: 'Produce a minimal, evidence-backed test plan distinguishing tests that directly cover changed symbols from tests suggested by transitive impact, never claiming "no tests required" when coverage data is incomplete.',
    assetPath: './assets/test-coverage.md',
    minCodeIntelVersion: CODE_INTEL_VERSION,
    contentVersion: 1,
    targets: targetsFor('test-coverage'),
    requiredTools: [
      { tool: 'suggest_tests', fields: ['symbol'], note: 'call paths, suggested cases, existing tests, untested callers' },
      { tool: 'coverage_gaps', fields: ['scope'], note: 'exported symbols with no test coverage, ranked by blast radius' },
      { tool: 'blast_radius', fields: ['target', 'direction'], note: 'transitive impact used to rank suggested-but-not-direct tests' },
    ],
    optionalTools: [
      {
        tool: 'detect_changes',
        fields: ['base_ref', 'diff_text'],
        fallback: 'ask the user for the symbol/scope to evaluate instead of deriving it from git',
        reducedGuarantee: 'cannot automatically scope the test plan to a diff',
      },
      {
        tool: 'flows',
        fallback: 'skip flow-level test coverage evidence',
        reducedGuarantee: 'cannot cite which named execution flow a suggested test exercises',
      },
    ],
  },

  'security-investigation': {
    id: 'security-investigation',
    title: 'Security / Vulnerability Investigation',
    summary: 'Combine heuristic scanner signal (secrets, vulnerability_scan) with call-graph path evidence, always distinguishing a scanner finding from a proven exploitable flow.',
    assetPath: './assets/security-investigation.md',
    minCodeIntelVersion: CODE_INTEL_VERSION,
    contentVersion: 1,
    targets: targetsFor('security-investigation'),
    requiredTools: [
      { tool: 'secrets', fields: ['scope', 'includeTestFiles'], note: 'hardcoded secret scan' },
      { tool: 'vulnerability_scan', fields: ['scope', 'types', 'severity'], note: 'OWASP-class heuristic scan' },
      { tool: 'find_path', fields: ['from', 'to'], note: 'prove or disprove a source-to-sink call path for a scanner finding' },
    ],
    optionalTools: [
      {
        tool: 'explain_relationship',
        fields: ['from', 'to'],
        fallback: 'rely on find_path alone for path evidence',
        reducedGuarantee: 'no shared-import/heritage corroboration for the suspected flow',
      },
      {
        tool: 'context',
        fields: ['symbols', 'task'],
        fallback: 'read the flagged file directly with targeted source verification',
        reducedGuarantee: 'less token-efficient, no auto-ranked related-symbol evidence',
      },
    ],
  },
};

export function getWorkflowManifest(id: WorkflowId): WorkflowManifest {
  return WORKFLOW_REGISTRY[id];
}

export function listWorkflowManifests(): WorkflowManifest[] {
  return Object.values(WORKFLOW_REGISTRY);
}

export const WORKFLOW_IDS: WorkflowId[] = [
  'explore',
  'debug',
  'impact',
  'plan',
  'review',
  'api-review',
  'test-coverage',
  'security-investigation',
];
