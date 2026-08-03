import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSetupPlan } from '../../../src/cli/setup-plan.js';

const created: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-setup-plan-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) fs.rmSync(created.pop()!, { recursive: true, force: true });
});

describe('resolveSetupPlan', () => {
  it('returns missing and installs no agents when selection is absent', () => {
    const plan = resolveSetupPlan(makeRepo());
    assert.equal(plan.selectionStatus, 'missing');
    assert.deepEqual(plan.integrations, []);
  });

  it('resolves only integrations declared by selected agents', () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, '.code-intel'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.code-intel', 'agent-targets.json'), JSON.stringify({
      selectedAgents: ['cursor', 'copilot', 'kilocode'],
      targets: {
        cursor: { agentId: 'cursor', label: 'Cursor', path: '.cursor/rules/code-intel.mdc', format: 'markdown' },
        copilot: { agentId: 'copilot', label: 'Copilot', path: '.github/copilot-instructions.md', format: 'markdown' },
        kilocode: { agentId: 'kilocode', label: 'Kilo Code', path: 'AGENTS.md', format: 'markdown' },
      },
    }));
    const plan = resolveSetupPlan(repo);
    assert.equal(plan.selectionStatus, 'valid');
    assert.deepEqual(plan.integrations, ['cursor-hook']);
    assert.ok(!plan.integrations.includes('opencode-plugin'));
  });

  it('fails closed for malformed selection', () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, '.code-intel'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.code-intel', 'agent-targets.json'), '{ invalid');
    const plan = resolveSetupPlan(repo);
    assert.equal(plan.selectionStatus, 'invalid');
    assert.deepEqual(plan.integrations, []);
  });

  it('reports unknown agents without guessing an integration', () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, '.code-intel'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.code-intel', 'agent-targets.json'), JSON.stringify({
      selectedAgents: ['cursor', 'future-agent'],
      targets: {},
    }));
    const plan = resolveSetupPlan(repo);
    assert.deepEqual(plan.integrations, ['cursor-hook']);
    assert.deepEqual(plan.unknownAgents, ['future-agent']);
  });

  it('all-agents includes every supported global integration only', () => {
    const plan = resolveSetupPlan(makeRepo(), { allAgents: true });
    assert.equal(plan.selectionStatus, 'all-agents');
    assert.deepEqual(new Set(plan.integrations), new Set([
      'claude-hook',
      'cursor-hook',
      'gemini-hook',
      'opencode-plugin',
    ]));
  });
});
