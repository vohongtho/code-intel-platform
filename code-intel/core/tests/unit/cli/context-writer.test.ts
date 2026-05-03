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
});

describe('writeContextFiles — creates agent-specific context files', () => {
  let dir: string;

  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates .github/copilot-instructions.md for GitHub Copilot', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    assert.ok(fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md')));
  });

  it('creates .cursor/rules/code-intel.mdc for Cursor IDE', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'code-intel.mdc')));
  });

  it('creates .kiro/steering/code-intel.md for Kiro IDE', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    assert.ok(fs.existsSync(path.join(dir, '.kiro', 'steering', 'code-intel.md')));
  });

  it('all agent files contain the mandatory rules section', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    const files = [
      path.join(dir, '.github', 'copilot-instructions.md'),
      path.join(dir, '.cursor', 'rules', 'code-intel.mdc'),
      path.join(dir, '.kiro', 'steering', 'code-intel.md'),
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
    writeContextFiles(dir, 'MyProject', stats, []);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('Cursor'), 'should mention Cursor');
    assert.ok(content.includes('Copilot'), 'should mention Copilot');
    assert.ok(content.includes('Kiro'), 'should mention Kiro');
    assert.ok(content.includes('Aider'), 'should mention Aider');
    assert.ok(content.includes('Amp'), 'should mention Amp');
  });

  it('block content includes pr-impact command', () => {
    writeContextFiles(dir, 'MyProject', stats, []);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('pr-impact'), 'should include pr-impact command');
  });
});
