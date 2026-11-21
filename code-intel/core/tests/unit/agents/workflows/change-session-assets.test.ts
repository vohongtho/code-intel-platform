import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { declaresChangeSession, installWorkflows } from '../../../../src/agents/workflows/installer.js';
import { listWorkflowManifests, WORKFLOW_IDS } from '../../../../src/agents/workflows/registry.js';
import { resolveRuntimeCapabilities } from '../../../../src/agents/workflows/capabilities.js';
import { validateWorkflowRegistry } from '../../../../src/agents/workflows/validator.js';
import { CHANGE_WORKFLOW_ACTIONS } from '../../../../src/agents/workflows/session-service.js';
import { CONDITION_STATUSES, CHANGE_WORKFLOW_PHASES } from '../../../../src/agents/workflows/session-types.js';
import { MCP_TOOL_DEFINITIONS } from '../../../../src/mcp-server/tool-definitions.js';
import type { WorkflowManifest } from '../../../../src/agents/workflows/types.js';

const WORKFLOWS_DIR = path.resolve(import.meta.dirname, '../../../../src/agents/workflows');
const FRAGMENT_SOURCE = path.resolve(import.meta.dirname, '../../../../../src/agents/workflows/assets/_change-session-guide.md');
const SNAPSHOT = path.resolve(import.meta.dirname, '../../../../../tests/fixtures/workflows/change-session-section.snapshot.md');
const SECTION_START = '## Change session';
const SHARED_GUIDE_HEADING = '## Evidence rules';

function renderedSection(content: string): string | undefined {
  const start = content.indexOf(SECTION_START);
  if (start === -1) return undefined;
  return content.slice(start, content.indexOf(SHARED_GUIDE_HEADING, start)).trim();
}

describe('change-session workflow assets', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-assets-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('keeps all eight static workflow IDs', () => {
    assert.deepEqual([...WORKFLOW_IDS].sort(), ['api-review', 'debug', 'explore', 'impact', 'plan', 'review', 'security-investigation', 'test-coverage']);
  });

  it('renders the change-session section exactly for manifests declaring change_workflow, matching the snapshot', () => {
    const snapshot = fs.readFileSync(SNAPSHOT, 'utf-8').trim();
    const states = installWorkflows(dir, ['claude', 'cursor']);
    const gated = new Set(listWorkflowManifests().filter(declaresChangeSession).map((m) => m.id));
    assert.ok(gated.size >= 7, 'every edit-capable workflow can join a session');
    assert.ok(!gated.has('explore'), 'read-only exploration does not start change sessions');
    for (const state of states) {
      const content = fs.readFileSync(path.join(dir, state.relativePath), 'utf-8');
      const section = renderedSection(content);
      if (gated.has(state.workflowId)) {
        assert.equal(section, snapshot, `${state.workflowId}/${state.agentId} change-session section drifted from the snapshot`);
        assert.ok(content.indexOf(SECTION_START) < content.indexOf(SHARED_GUIDE_HEADING));
      } else {
        assert.equal(section, undefined, `${state.workflowId} must not render a change-session section`);
      }
    }
  });

  it('requires reindex + verify before completion and stops on blocked/unknown', () => {
    const fragment = fs.readFileSync(FRAGMENT_SOURCE, 'utf-8');
    assert.match(fragment, /code-intel analyze/);
    assert.match(fragment, /action: "verify"/);
    assert.match(fragment, /Complete only after `passed`/);
    assert.match(fragment, /stop and report\*\*; do not claim completion/);
    assert.match(fragment, /never edits files or touches Git/);
    assert.match(fragment, /does not list `change_workflow`, skip this section/, 'degrades explicitly when the capability is absent');
  });

  it('cites only signals the change_workflow tool actually emits (evaluation fixture)', () => {
    const fragment = fs.readFileSync(FRAGMENT_SOURCE, 'utf-8');
    const tool = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'change_workflow')!;
    const fields = new Set(Object.keys(tool.inputSchema.properties as object));
    const outcomes = new Set(['passed', 'needs-revision', 'reindex-required', 'blocked']);
    const known = new Set<string>([...CONDITION_STATUSES, ...CHANGE_WORKFLOW_PHASES, ...outcomes, 'required', 'candidate', 'optional']);
    for (const [, action] of fragment.matchAll(/action: "([a-z]+)"/g)) assert.ok((CHANGE_WORKFLOW_ACTIONS as readonly string[]).includes(action!), `unknown action ${action}`);
    for (const [, field] of fragment.matchAll(/`([a-z_]+)`/g)) {
      if (field === 'change_workflow' || field === 'passed') continue;
      if (field!.includes('_') || ['task', 'targets', 'scope', 'group', 'conditions'].includes(field!)) assert.ok(fields.has(field!), `fragment cites unknown change_workflow field ${field}`);
    }
    for (const [, literal] of fragment.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)) assert.ok(known.has(literal!), `fragment cites ${literal}, which the workflow never emits`);
  });
});

describe('workflow validator: change-session capability', () => {
  it('passes against the live tool inventory', () => {
    const report = validateWorkflowRegistry();
    assert.deepEqual(report.issues.filter((i) => i.severity === 'error'), []);
  });

  it('fails release validation when change_workflow (or a field the fragment cites) disappears', () => {
    const withoutTool = resolveRuntimeCapabilities(MCP_TOOL_DEFINITIONS.filter((t) => t.name !== 'change_workflow'));
    const report = validateWorkflowRegistry(undefined, withoutTool);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((i) => /gated on 'change_workflow'/.test(i.message)));

    const withoutField = resolveRuntimeCapabilities(MCP_TOOL_DEFINITIONS.map((t) => (t.name === 'change_workflow'
      ? { ...t, inputSchema: { ...t.inputSchema, properties: Object.fromEntries(Object.entries(t.inputSchema.properties as object).filter(([k]) => k !== 'expected_revision')) } }
      : t)));
    const fieldReport = validateWorkflowRegistry(undefined, withoutField);
    assert.equal(fieldReport.ok, false);
    assert.ok(fieldReport.issues.some((i) => /expected_revision/.test(i.message)));
  });

  it('fails when an asset names a live tool its manifest does not declare', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-asset-'));
    try {
      const assetFile = path.join(tmp, 'rogue.md');
      fs.writeFileSync(assetFile, '## Steps\n\n1. Call `change_workflow` then `pr_impact`.\n');
      const manifest: WorkflowManifest = {
        ...listWorkflowManifests().find((m) => m.id === 'review')!,
        assetPath: path.relative(WORKFLOWS_DIR, assetFile),
        optionalTools: [],
        requiredTools: [{ tool: 'search' }],
      };
      const report = validateWorkflowRegistry([manifest]);
      const messages = report.issues.map((i) => i.message);
      assert.ok(messages.some((m) => /names tool 'change_workflow'/.test(m)), messages.join('\n'));
      assert.ok(messages.some((m) => /names tool 'pr_impact'/.test(m)));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
