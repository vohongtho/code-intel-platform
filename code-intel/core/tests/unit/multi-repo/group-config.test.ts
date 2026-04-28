import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGroupConfig, saveGroupConfig } from '../../../src/multi-repo/group-config.js';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `group-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('loadGroupConfig', () => {
  let dir: string;
  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns null for nonexistent file', () => {
    const result = loadGroupConfig(path.join(dir, 'nonexistent.yml'));
    assert.equal(result, null);
  });

  it('returns null for empty file', () => {
    const f = path.join(dir, 'empty.yml');
    fs.writeFileSync(f, '');
    assert.equal(loadGroupConfig(f), null);
  });

  it('parses name and repos with name:path format', () => {
    const f = path.join(dir, 'valid.yml');
    fs.writeFileSync(f, [
      'name: my-group',
      'repos:',
      '  - frontend: /repos/frontend',
      '  - backend: /repos/backend',
    ].join('\n'));
    const result = loadGroupConfig(f);
    assert.ok(result !== null);
    assert.equal(result!.name, 'my-group');
    assert.equal(result!.repos.length, 2);
    assert.equal(result!.repos[0]!.name, 'frontend');
    assert.equal(result!.repos[0]!.path, '/repos/frontend');
    assert.equal(result!.repos[1]!.name, 'backend');
  });

  it('parses repo entry with path only (no colon)', () => {
    const f = path.join(dir, 'path-only.yml');
    fs.writeFileSync(f, [
      'name: simple',
      'repos:',
      '  - /repos/myrepo',
    ].join('\n'));
    const result = loadGroupConfig(f);
    assert.ok(result !== null);
    assert.equal(result!.repos.length, 1);
    assert.equal(result!.repos[0]!.path, '/repos/myrepo');
    assert.equal(result!.repos[0]!.name, 'myrepo'); // basename
  });

  it('skips comment lines', () => {
    const f = path.join(dir, 'comments.yml');
    fs.writeFileSync(f, [
      '# This is a comment',
      'name: group-with-comments',
      '# another comment',
      'repos:',
      '  - myapp: /repos/myapp',
      '  - service: /repos/service',
    ].join('\n'));
    const result = loadGroupConfig(f);
    assert.ok(result !== null);
    assert.equal(result!.name, 'group-with-comments');
    assert.equal(result!.repos.length, 2);
  });

  it('returns null when name is missing', () => {
    const f = path.join(dir, 'no-name.yml');
    fs.writeFileSync(f, [
      'repos:',
      '  - frontend: /repos/frontend',
    ].join('\n'));
    assert.equal(loadGroupConfig(f), null);
  });

  it('returns null when repos list is empty', () => {
    const f = path.join(dir, 'no-repos.yml');
    fs.writeFileSync(f, 'name: empty-group\nrepos:\n');
    assert.equal(loadGroupConfig(f), null);
  });

  it('skips blank lines', () => {
    const f = path.join(dir, 'blank-lines.yml');
    fs.writeFileSync(f, [
      '',
      'name: my-blank-group',
      '',
      'repos:',
      '',
      '  - svc: /repos/svc',
      '',
    ].join('\n'));
    const result = loadGroupConfig(f);
    assert.ok(result !== null);
    assert.equal(result!.name, 'my-blank-group');
  });
});

describe('saveGroupConfig + loadGroupConfig round-trip', () => {
  let dir: string;
  before(() => { dir = tmpDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('saves and reloads a group config', () => {
    const f = path.join(dir, 'roundtrip.yml');
    saveGroupConfig(f, {
      name: 'rt-group',
      repos: [
        { name: 'api', path: '/repos/api' },
        { name: 'web', path: '/repos/web' },
      ],
    });
    assert.ok(fs.existsSync(f));
    const loaded = loadGroupConfig(f);
    assert.ok(loaded !== null);
    assert.equal(loaded!.name, 'rt-group');
    assert.equal(loaded!.repos.length, 2);
    assert.equal(loaded!.repos[0]!.name, 'api');
    assert.equal(loaded!.repos[1]!.path, '/repos/web');
  });

  it('creates parent directories if needed', () => {
    const nested = path.join(dir, 'nested', 'deep', 'config.yml');
    saveGroupConfig(nested, { name: 'nested-group', repos: [{ name: 'a', path: '/a' }] });
    assert.ok(fs.existsSync(nested));
  });

  it('file content has name: prefix', () => {
    const f = path.join(dir, 'content-check.yml');
    saveGroupConfig(f, { name: 'check-group', repos: [{ name: 'svc', path: '/svc' }] });
    const content = fs.readFileSync(f, 'utf-8');
    assert.ok(content.includes('name: check-group'));
    assert.ok(content.includes('repos:'));
    assert.ok(content.includes('svc:'));
  });
});
