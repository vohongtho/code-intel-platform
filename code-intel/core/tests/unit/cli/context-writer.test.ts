import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeContextFiles } from '../../../src/cli/context-writer.js';
import type { ContextStats } from '../../../src/cli/context-writer.js';
import type { AgentTargetConfig } from '../../../src/storage/metadata.js';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `context-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const stats: ContextStats = { nodes: 42, edges: 100, files: 10, duration: 1500 };
const defaultTargets: AgentTargetConfig[] = [
  { agentId: 'codex', label: 'Codex', path: 'AGENTS.md', format: 'markdown', builtin: true },
  { agentId: 'claude', label: 'Claude Code', path: 'CLAUDE.md', format: 'markdown', builtin: true },
  { agentId: 'copilot', label: 'GitHub Copilot', path: '.github/copilot-instructions.md', format: 'markdown', builtin: true },
  { agentId: 'cursor', label: 'Cursor', path: '.cursor/rules/code-intel.mdc', format: 'markdown', builtin: true },
  { agentId: 'kiro', label: 'Kiro', path: '.kiro/steering/code-intel.md', format: 'markdown', builtin: true },
  { agentId: 'cline', label: 'Cline', path: '.clinerules', format: 'markdown', builtin: true },
  { agentId: 'windsurf', label: 'Windsurf', path: '.windsurfrules', format: 'markdown', builtin: true },
  { agentId: 'kilocode-legacy', label: 'Kilo Code', path: '.kilocode/rules/code-intel-rules.md', format: 'markdown', builtin: true },
  { agentId: 'antigravity', label: 'Antigravity', path: '.agents/rules/code-intel-rules.md', format: 'markdown', builtin: true },
];

describe('writeContextFiles — creates new files when none exist', () => {
  let dir: string;

  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates AGENTS.md', () => {
    writeContextFiles(dir, 'MyProject', stats, defaultTargets);
    assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')));
  });

  it('creates CLAUDE.md', () => {
    writeContextFiles(dir, 'MyProject', stats, defaultTargets);
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
  });

  it('managed block contains markers and project name', () => {
    writeContextFiles(dir, 'MyProject', stats, defaultTargets);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('<!-- code-intel:start -->'));
    assert.ok(content.includes('<!-- code-intel:end -->'));
    assert.ok(content.includes('# Code Intelligence — MyProject'));
  });
});

describe('writeContextFiles — updates existing file with markers', () => {
  let dir: string;

  before(() => {
    dir = tmpDir();
    const initial = `# AGENTS.md\n\n<!-- code-intel:start -->\nOLD CONTENT\n<!-- code-intel:end -->\n\nUser notes here.\n`;
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), initial, 'utf-8');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), initial, 'utf-8');
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('replaces managed block without touching user notes', () => {
    writeContextFiles(dir, 'Updated', stats, defaultTargets);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(!content.includes('OLD CONTENT'));
    assert.ok(content.includes('Updated'));
    assert.ok(content.includes('User notes here.'));
  });
});

describe('writeContextFiles — appends to existing file without markers', () => {
  let dir: string;

  before(() => {
    dir = tmpDir();
    const existing = `# AGENTS.md\n\nSome existing notes without markers.\n`;
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), existing, 'utf-8');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), existing, 'utf-8');
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('preserves original content and appends managed block', () => {
    writeContextFiles(dir, 'AppendTest', stats, defaultTargets);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('Some existing notes'));
    assert.ok(content.includes('<!-- code-intel:start -->'));
    assert.ok(content.includes('AppendTest'));
  });
});

describe('writeContextFiles — concise block', () => {
  let dir: string;

  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('includes requested block shape', () => {
    writeContextFiles(dir, 'MyProject', stats, defaultTargets);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('# Code Intelligence — MyProject'));
    assert.match(content, /Auto-managed by `code-intel analyze` \(v[^)]+\)/);
    assert.ok(content.includes('**complements** reading files'));
    assert.ok(content.includes('## Reach for it when you need'));
    assert.ok(content.includes('## CLI reference'));
    assert.ok(content.includes('Also available: `complexity`, `coverage`, `secrets`, `scan`, `deprecated`, `status`, `clean`.'));
  });

  it('includes expected command examples', () => {
    writeContextFiles(dir, 'MyProject', stats, defaultTargets);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('code-intel impact <symbol>'));
    assert.ok(content.includes('code-intel pr-impact --base master --head HEAD'));
    assert.ok(content.includes('code-intel query "TRAVERSE CALLS FROM \'<symbol>\' DEPTH 3"'));
  });

  it('does not include removed skill-heavy sections', () => {
    writeContextFiles(dir, 'MyProject', stats, defaultTargets);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(!content.includes('## Skills'));
    assert.ok(!content.includes('When to Load a Skill'));
    assert.ok(!content.includes('SKILL.md'));
    assert.ok(!content.includes('Mandatory Rules'));
    assert.ok(!content.includes('Development Workflow'));
  });
});

describe('writeContextFiles — creates agent-specific context files', () => {
  let dir: string;

  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates selected agent files', () => {
    writeContextFiles(dir, 'MyProject', stats, defaultTargets);
    assert.ok(fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md')));
    assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'code-intel.mdc')));
    assert.ok(fs.existsSync(path.join(dir, '.kiro', 'steering', 'code-intel.md')));
  });

  it('all selected agent files contain the concise block', () => {
    writeContextFiles(dir, 'MyProject', stats, defaultTargets);
    const files = [
      path.join(dir, '.github', 'copilot-instructions.md'),
      path.join(dir, '.cursor', 'rules', 'code-intel.mdc'),
      path.join(dir, '.kiro', 'steering', 'code-intel.md'),
    ];
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf-8');
      assert.ok(content.includes('Code Intelligence — MyProject'));
      assert.ok(content.includes('## Reach for it when you need'));
      assert.ok(content.includes('## CLI reference'));
      assert.ok(!content.includes('SKILL.md'));
    }
  });

  it('writes only selected targets', () => {
    const isolatedDir = tmpDir();
    try {
      writeContextFiles(isolatedDir, 'MyProject', stats, [
        { agentId: 'cursor', label: 'Cursor', path: '.cursor/rules/code-intel.mdc', format: 'markdown', builtin: true },
      ]);
      assert.ok(fs.existsSync(path.join(isolatedDir, '.cursor', 'rules', 'code-intel.mdc')));
      assert.ok(!fs.existsSync(path.join(isolatedDir, 'AGENTS.md')));
      assert.ok(!fs.existsSync(path.join(isolatedDir, 'CLAUDE.md')));
      assert.ok(!fs.existsSync(path.join(isolatedDir, '.github', 'copilot-instructions.md')));
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  it('writes custom json targets', () => {
    const isolatedDir = tmpDir();
    try {
      writeContextFiles(isolatedDir, 'MyProject', stats, [
        { agentId: 'custom-json', label: 'Custom JSON', path: '.custom/agent.json', format: 'json', builtin: false },
      ]);
      const content = JSON.parse(fs.readFileSync(path.join(isolatedDir, '.custom', 'agent.json'), 'utf-8')) as Record<string, string>;
      assert.ok(typeof content['code-intel'] === 'string');
      assert.ok(content['code-intel'].includes('Code Intelligence — MyProject'));
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});
