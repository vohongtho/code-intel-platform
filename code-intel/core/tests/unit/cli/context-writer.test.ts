import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeContextFiles } from '../../../src/cli/context-writer.js';
import type { ContextStats } from '../../../src/cli/context-writer.js';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `context-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const stats: ContextStats = { nodes: 42, edges: 100, files: 10, duration: 1500 };

describe('writeContextFiles — creates new files when none exist', () => {
  let dir: string;

  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates AGENTS.md', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')));
  });

  it('creates CLAUDE.md', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
  });

  it('AGENTS.md contains project name', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('MyProject'));
  });

  it('AGENTS.md contains code-intel:start marker', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('<!-- code-intel:start -->'));
  });

  it('AGENTS.md contains code-intel:end marker', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('<!-- code-intel:end -->'));
  });

  it('AGENTS.md includes node/edge/file stats', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('42'));
    assert.ok(content.includes('100'));
    assert.ok(content.includes('10 files'));
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
    writeContextFiles(dir, 'Updated', stats, []);
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

  it('preserves original content', () => {
    writeContextFiles(dir, 'AppendTest', stats, []);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('Some existing notes'));
  });

  it('appends new block at end', () => {
    writeContextFiles(dir, 'AppendTest', stats, []);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('<!-- code-intel:start -->'));
    assert.ok(content.includes('AppendTest'));
  });
});

describe('writeContextFiles — skill rows in block', () => {
  let dir: string;

  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('includes skill label in table when skills provided', () => {
    writeContextFiles(dir, 'SkilledProject', stats, [
      { name: 'auth-module', label: 'Auth Module', symbolCount: 15, fileCount: 3 },
    ]);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('Auth Module'));
    assert.ok(content.includes('auth-module'));
  });

  it('includes "When to Load a Skill" section with skill name when skills provided', () => {
    writeContextFiles(dir, 'SkilledProject', stats, [
      { name: 'auth-module', label: 'Auth Module', symbolCount: 15, fileCount: 3 },
    ]);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('When to Load a Skill'), 'should include When to Load a Skill section');
    assert.ok(content.includes('Working in **Auth Module**'), 'should include skill-specific load instruction');
  });

  it('includes Development Workflow section', () => {
    writeContextFiles(dir, 'SkilledProject', stats, []);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('Development Workflow'), 'should include Development Workflow section');
    assert.ok(content.includes('Implement a New Feature'), 'should include feature workflow');
    assert.ok(content.includes('Fix a Bug'), 'should include bug fix workflow');
    assert.ok(content.includes('Study / Understand Code'), 'should include study workflow');
    assert.ok(content.includes('Code Review'), 'should include code review workflow');
    assert.ok(content.includes('Maintain / Refactor'), 'should include maintenance workflow');
  });
});

describe('writeContextFiles — does NOT create agent files when agent is absent', () => {
  let dir: string;

  // Use () => false to simulate no agent binaries on PATH — deterministic regardless
  // of what is actually installed in the test environment.
  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('does NOT create .cursor/rules/code-intel.mdc when cursor is not installed', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => false);
    assert.ok(!fs.existsSync(path.join(dir, '.cursor', 'rules', 'code-intel.mdc')));
  });

  it('does NOT create .github/copilot-instructions.md when code is not installed', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => false);
    assert.ok(!fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md')));
  });

  it('does NOT create .windsurfrules when windsurf is not installed', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => false);
    assert.ok(!fs.existsSync(path.join(dir, '.windsurfrules')));
  });

  it('does NOT create .clinerules (analyze never writes this — setup only)', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => false);
    assert.ok(!fs.existsSync(path.join(dir, '.clinerules')));
  });

  it('does NOT create .kiro/steering/code-intel.md (analyze never writes this — setup only)', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => false);
    assert.ok(!fs.existsSync(path.join(dir, '.kiro', 'steering', 'code-intel.md')));
  });

  it('does NOT create .kilocode/rules/code-intel-rules.md (analyze never writes this — setup only)', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => false);
    assert.ok(!fs.existsSync(path.join(dir, '.kilocode', 'rules', 'code-intel-rules.md')));
  });

  it('does NOT create .agents/rules/code-intel-rules.md (analyze never writes this — setup only)', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => false);
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'rules', 'code-intel-rules.md')));
  });

  it('always creates AGENTS.md regardless', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => false);
    assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')));
  });

  it('always creates CLAUDE.md regardless', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => false);
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
  });

  it('does NOT update pre-existing agent files that lack a binary', () => {
    // Even if files with our markers were previously written (e.g. by `setup`),
    // analyze must NOT touch them when the binary is absent.
    const seedBlock = `<!-- code-intel:start -->\nOldContent\n<!-- code-intel:end -->\n`;
    fs.mkdirSync(path.join(dir, '.cursor', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cursor', 'rules', 'code-intel.mdc'), seedBlock, 'utf-8');

    writeContextFiles(dir, 'MyProject', stats, [], () => false);

    const content = fs.readFileSync(path.join(dir, '.cursor', 'rules', 'code-intel.mdc'), 'utf-8');
    assert.ok(content.includes('OldContent'), 'pre-existing file should be left untouched');
  });
});

describe('writeContextFiles — creates agent files when binary is present', () => {
  let dir: string;

  // Use () => true to simulate all agent binaries on PATH — deterministic regardless
  // of what is actually installed in the test environment.
  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates .github/copilot-instructions.md when code binary is present', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => true);
    assert.ok(fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md')));
  });

  it('creates .cursor/rules/code-intel.mdc when cursor binary is present', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => true);
    assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'code-intel.mdc')));
  });

  it('creates .windsurfrules when windsurf binary is present', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => true);
    assert.ok(fs.existsSync(path.join(dir, '.windsurfrules')));
  });

  it('does NOT create .kiro/steering/code-intel.md even when all binaries present (setup only)', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => true);
    assert.ok(!fs.existsSync(path.join(dir, '.kiro', 'steering', 'code-intel.md')));
  });

  it('does NOT create .clinerules even when all binaries present (setup only)', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => true);
    assert.ok(!fs.existsSync(path.join(dir, '.clinerules')));
  });

  it('all created agent files contain the mandatory rules section', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => true);
    const files = [
      path.join(dir, '.github', 'copilot-instructions.md'),
      path.join(dir, '.cursor', 'rules', 'code-intel.mdc'),
      path.join(dir, '.windsurfrules'),
    ];
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf-8');
      assert.ok(content.includes('Mandatory Rules'), `${f} should contain Mandatory Rules`);
      assert.ok(content.includes('code-intel search'), `${f} should reference code-intel search`);
      assert.ok(content.includes('code-intel impact'), `${f} should reference code-intel impact`);
      assert.ok(content.includes('code-intel inspect'), `${f} should reference code-intel inspect`);
    }
  });

  it('block content mentions key agent names', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => true);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('Cursor'), 'should mention Cursor');
    assert.ok(content.includes('Copilot'), 'should mention Copilot');
    assert.ok(content.includes('Kiro'), 'should mention Kiro');
    assert.ok(content.includes('Aider'), 'should mention Aider');
    assert.ok(content.includes('Amp'), 'should mention Amp');
  });

  it('block content includes pr-impact command', () => {
    writeContextFiles(dir, 'MyProject', stats, [], () => true);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('pr-impact'), 'should include pr-impact command');
  });
});
