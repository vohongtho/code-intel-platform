import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installWorkflows, planWorkflowInstall } from '../../../../src/agents/workflows/installer.js';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `workflow-installer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('installWorkflows', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates a skill file per (workflow, selected agent) for supported targets', () => {
    const states = installWorkflows(dir, ['claude']);
    const explore = states.find((s) => s.workflowId === 'explore' && s.agentId === 'claude');
    assert.ok(explore);
    assert.equal(explore!.action, 'create');
    const absPath = path.join(dir, explore!.relativePath);
    assert.ok(fs.existsSync(absPath));
    const content = fs.readFileSync(absPath, 'utf-8');
    assert.match(content, /^---\nname: code-intel-workflow-explore/);
    assert.match(content, /<!-- code-intel:workflow-fingerprint sha256=[0-9a-f]{64} contentVersion=1 -->/);
    assert.match(content, /## Evidence rules/);
  });

  it('reports not-supported for an agent with no workflow renderer', () => {
    const states = installWorkflows(dir, ['windsurf']);
    assert.ok(states.every((s) => s.action === 'not-supported'));
    assert.equal(states.length, 8); // one per workflow, all not-supported
  });

  it('is idempotent — rerunning with identical content produces only skips, no file churn', () => {
    installWorkflows(dir, ['claude', 'cursor']);
    const before = fs.readFileSync(path.join(dir, '.claude/skills/code-intel-workflows/explore/SKILL.md'), 'utf-8');
    const beforeMtime = fs.statSync(path.join(dir, '.claude/skills/code-intel-workflows/explore/SKILL.md')).mtimeMs;

    const secondRun = installWorkflows(dir, ['claude', 'cursor']);
    assert.ok(secondRun.every((s) => s.action === 'skip'));

    const after = fs.readFileSync(path.join(dir, '.claude/skills/code-intel-workflows/explore/SKILL.md'), 'utf-8');
    const afterMtime = fs.statSync(path.join(dir, '.claude/skills/code-intel-workflows/explore/SKILL.md')).mtimeMs;
    assert.equal(before, after);
    assert.equal(beforeMtime, afterMtime, 'file must not be rewritten when content is unchanged');
  });

  it('detects a user-modified managed file and refuses to overwrite it (conflict)', () => {
    installWorkflows(dir, ['claude']);
    const filePath = path.join(dir, '.claude/skills/code-intel-workflows/explore/SKILL.md');
    const original = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(filePath, original.replace('# Codebase Exploration', '# Codebase Exploration (my custom notes)'), 'utf-8');

    const states = installWorkflows(dir, ['claude']);
    const exploreState = states.find((s) => s.workflowId === 'explore' && s.agentId === 'claude');
    assert.equal(exploreState!.action, 'conflict');

    const onDisk = fs.readFileSync(filePath, 'utf-8');
    assert.match(onDisk, /my custom notes/, 'user edit must be preserved, never silently overwritten');
  });

  it('treats a pre-existing unmanaged file (no fingerprint marker) as a conflict, not an overwrite', () => {
    const filePath = path.join(dir, '.claude/skills/code-intel-workflows/explore/SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# My own notes, not managed by code-intel\n', 'utf-8');

    const states = installWorkflows(dir, ['claude']);
    const exploreState = states.find((s) => s.workflowId === 'explore' && s.agentId === 'claude');
    assert.equal(exploreState!.action, 'conflict');
    assert.equal(fs.readFileSync(filePath, 'utf-8'), '# My own notes, not managed by code-intel\n');
  });

  it('deselecting a previously-installed agent target does not delete its workflow files (never destructive)', () => {
    installWorkflows(dir, ['claude', 'cursor']);
    const claudeFile = path.join(dir, '.claude/skills/code-intel-workflows/explore/SKILL.md');
    const cursorFile = path.join(dir, '.cursor/rules/code-intel-workflow-explore.mdc');
    assert.ok(fs.existsSync(claudeFile));
    assert.ok(fs.existsSync(cursorFile));

    // Rerun with only 'claude' selected — as if the user deselected Cursor in a later `code-intel analyze`.
    const states = installWorkflows(dir, ['claude']);
    assert.ok(states.every((s) => s.agentId === 'claude'), 'installer only acts on the currently-selected agent set, it never enumerates or touches previously-installed targets');
    assert.ok(fs.existsSync(claudeFile), 'still-selected target file must remain');
    assert.ok(fs.existsSync(cursorFile), 'deselected target file must be left in place, not deleted — installation is additive/idempotent only, never destructive');
  });

  it('dry-run (planWorkflowInstall) never writes to disk', () => {
    const states = planWorkflowInstall(dir, ['claude']);
    assert.ok(states.some((s) => s.action === 'create'));
    assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
  });

  it('bumping contentVersion on an unmodified file produces update, not conflict, and rewrites content', () => {
    installWorkflows(dir, ['claude']);
    const manifestOverride = [
      {
        id: 'explore' as const,
        title: 'Codebase Exploration',
        summary: 'Updated summary text for the update test.',
        assetPath: './assets/explore.md',
        minCodeIntelVersion: '1.0.11',
        contentVersion: 2,
        targets: [{ agentId: 'claude', pathTemplate: '.claude/skills/code-intel-workflows/explore/SKILL.md', renderer: 'claude-skill' as const }],
        requiredTools: [],
        optionalTools: [],
      },
    ];
    const states = installWorkflows(dir, ['claude'], { manifests: manifestOverride });
    assert.equal(states[0]!.action, 'update');
    const content = fs.readFileSync(path.join(dir, '.claude/skills/code-intel-workflows/explore/SKILL.md'), 'utf-8');
    assert.match(content, /contentVersion=2/);
    assert.match(content, /Updated summary text for the update test\./);
  });
});
