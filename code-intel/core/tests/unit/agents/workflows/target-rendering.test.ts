import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installWorkflows } from '../../../../src/agents/workflows/installer.js';
import { listWorkflowManifests } from '../../../../src/agents/workflows/registry.js';
import { MCP_TOOL_DEFINITIONS } from '../../../../src/mcp-server/tool-definitions.js';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `workflow-target-render-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const ALL_TOOL_NAMES = new Set(MCP_TOOL_DEFINITIONS.map((t) => t.name));

describe('per-target rendering — every supported (workflow, agent) pair', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('renders a Claude Code SKILL.md with YAML frontmatter at the documented path', () => {
    const states = installWorkflows(dir, ['claude']);
    for (const state of states) {
      assert.equal(state.action, 'create');
      assert.equal(state.relativePath, `.claude/skills/code-intel-workflows/${state.workflowId}/SKILL.md`);
      const content = fs.readFileSync(path.join(dir, state.relativePath), 'utf-8');
      const frontmatter = content.split('\n').slice(0, 4);
      assert.equal(frontmatter[0], '---');
      assert.equal(frontmatter[1], `name: code-intel-workflow-${state.workflowId}`);
      assert.match(frontmatter[2]!, /^description: "/);
      assert.equal(frontmatter[3], '---');
    }
  });

  it('renders a Cursor .mdc rule with description/alwaysApply frontmatter at the documented path', () => {
    const states = installWorkflows(dir, ['cursor']);
    for (const state of states) {
      assert.equal(state.action, 'create');
      assert.equal(state.relativePath, `.cursor/rules/code-intel-workflow-${state.workflowId}.mdc`);
      const content = fs.readFileSync(path.join(dir, state.relativePath), 'utf-8');
      const frontmatter = content.split('\n').slice(0, 4);
      assert.equal(frontmatter[0], '---');
      assert.match(frontmatter[1]!, /^description: "/);
      assert.equal(frontmatter[2], 'alwaysApply: false');
      assert.equal(frontmatter[3], '---');
    }
  });

  it('shares identical body content (title + workflow prose + evidence guide) across every target renderer', () => {
    const claudeStates = installWorkflows(dir, ['claude']);
    const dir2 = tmpDir();
    try {
      const cursorStates = installWorkflows(dir2, ['cursor']);
      for (const manifest of listWorkflowManifests()) {
        const claude = claudeStates.find((s) => s.workflowId === manifest.id)!;
        const cursor = cursorStates.find((s) => s.workflowId === manifest.id)!;
        const claudeBody = fs.readFileSync(path.join(dir, claude.relativePath), 'utf-8').split('---\n').slice(2).join('---\n');
        const cursorBody = fs.readFileSync(path.join(dir2, cursor.relativePath), 'utf-8').split('---\n').slice(2).join('---\n');
        const stripFingerprint = (s: string) => s.replace(/<!-- code-intel:workflow-fingerprint[^>]*-->\n\n?/, '');
        assert.equal(stripFingerprint(claudeBody), stripFingerprint(cursorBody), `workflow '${manifest.id}' body diverged between renderers`);
      }
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('never references an MCP tool name in its own workflow-specific body that is not declared in the manifest', () => {
    // A coarse content check on the workflow-specific portion only (title +
    // asset body) — every backtick-quoted `snake_case_word` token that also
    // happens to be a real MCP tool name must be one of the manifest's
    // declared required/optional tools. The shared evidence guide is
    // deliberately excluded: it's generic advice shared by every workflow
    // and illustrates its points with tool names that belong to other
    // workflows, not this one.
    const SHARED_GUIDE_HEADING = '## Evidence rules (apply to every Code Intel workflow)';
    const states = installWorkflows(dir, ['claude']);
    for (const manifest of listWorkflowManifests()) {
      const state = states.find((s) => s.workflowId === manifest.id)!;
      const content = fs.readFileSync(path.join(dir, state.relativePath), 'utf-8');
      const ownBody = content.split(SHARED_GUIDE_HEADING)[0]!;
      const declared = new Set([...manifest.requiredTools, ...manifest.optionalTools].map((t) => t.tool));
      const mentioned = new Set([...ownBody.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]).filter((name) => ALL_TOOL_NAMES.has(name!)));
      for (const name of mentioned) {
        assert.ok(declared.has(name!), `workflow '${manifest.id}' mentions tool '${name}' in its own asset body but it is not declared in requiredTools/optionalTools`);
      }
    }
  });
});
