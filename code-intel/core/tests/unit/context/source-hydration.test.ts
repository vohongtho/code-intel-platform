import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hydrateNodeSource } from '../../../src/context/source-hydration.js';
import type { CodeNode } from '../../../src/shared/index.js';

const SOURCE = `export function load(id: string) {\n${Array.from({ length: 40 }, (_, i) => `  const v${i} = read('k${i}') + ${i};`).join('\n')}\n  return v0;\n}`;
const LINES = SOURCE.split('\n').length;

// What the store hands back: first 1000 chars, newlines as the literal two characters `\n`.
const storedForm = (source: string): string => source.slice(0, 1000).replace(/\r/g, '\\r').replace(/\n/g, '\\n');

function nodeFor(content: string | undefined, over: Partial<CodeNode> = {}): CodeNode {
  return { id: 'load', kind: 'function', name: 'load', filePath: 'src/load.ts', startLine: 1, endLine: LINES, content, ...over };
}

describe('hydrateNodeSource', () => {
  let repo: string;
  let outside: string;

  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrate-repo-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrate-outside-'));
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src/load.ts'), `// header\n${SOURCE}\n// trailer\n`.replace('// header\n', ''));
    fs.writeFileSync(path.join(outside, 'secret-source.ts'), SOURCE);
    fs.symlinkSync(path.join(outside, 'secret-source.ts'), path.join(repo, 'src/link.ts'));
  });

  after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('restores real newlines and the full body for store-formatted content', () => {
    const result = hydrateNodeSource(nodeFor(storedForm(SOURCE)), repo);
    assert.equal(result.status, 'hydrated');
    assert.equal(result.content, SOURCE);
    assert.ok(result.content!.split('\n').length > 10);
  });

  it('accepts raw in-memory content (fresh analysis) without false drift', () => {
    const result = hydrateNodeSource(nodeFor(SOURCE.slice(0, 600)), repo);
    assert.equal(result.status, 'hydrated');
    assert.equal(result.content, SOURCE);
  });

  it('reports source-drift and keeps indexed content when the file changed', () => {
    const drifted = nodeFor(storedForm(SOURCE.replace('read(\'k0\')', 'read(\'old\')')));
    const result = hydrateNodeSource(drifted, repo);
    assert.equal(result.status, 'skipped');
    assert.equal(result.boundary, 'source-drift');
    assert.equal(result.content, drifted.content);
  });

  it('refuses paths that escape the repository root', () => {
    const traversal = nodeFor(storedForm(SOURCE), { filePath: path.relative(repo, path.join(outside, 'secret-source.ts')) });
    assert.equal(hydrateNodeSource(traversal, repo).boundary, 'source-outside-repo');
    const absolute = nodeFor(storedForm(SOURCE), { filePath: path.join(outside, 'secret-source.ts') });
    assert.equal(hydrateNodeSource(absolute, repo).boundary, 'source-outside-repo');
  });

  it('refuses symlinks that resolve outside the repository root', () => {
    const viaLink = nodeFor(storedForm(SOURCE), { filePath: 'src/link.ts' });
    const result = hydrateNodeSource(viaLink, repo);
    assert.equal(result.status, 'skipped');
    assert.equal(result.boundary, 'source-outside-repo');
  });

  it('skips without a boundary when there is nothing to verify or nowhere to read', () => {
    assert.deepEqual(hydrateNodeSource(nodeFor(undefined), repo), { status: 'skipped', content: undefined });
    assert.equal(hydrateNodeSource(nodeFor(storedForm(SOURCE)), undefined).status, 'skipped');
  });

  it('reports a missing line range and treats unresolvable paths as outside the repo', () => {
    assert.equal(hydrateNodeSource(nodeFor(storedForm(SOURCE), { endLine: undefined }), repo).boundary, 'source-range-missing');
    assert.equal(hydrateNodeSource(nodeFor(storedForm(SOURCE), { filePath: 'src/missing.ts' }), repo).boundary, 'source-outside-repo');
  });
});
