import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { runPipeline } from '../../../src/pipeline/orchestrator.js';
import { scanPhase } from '../../../src/pipeline/phases/index.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';
import { loadMetadata } from '../../../src/storage/metadata.js';

const CORE_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CLI_MAIN = path.join(CORE_ROOT, 'dist-tests', 'src', 'cli', 'main.js');
const DIST_TESTS_ROOT = path.join(CORE_ROOT, 'dist-tests');

function ensureDistTestsPackageJson() {
  const target = path.join(DIST_TESTS_ROOT, 'package.json');
  if (!fs.existsSync(target)) {
    fs.copyFileSync(path.join(CORE_ROOT, 'package.json'), target);
  }
}

function mkRepo(name: string) {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'tmp-exclusions-repo', private: true }, null, 2),
    'src/index.ts': 'export const indexValue = 1;\n',
    'src/feature.ts': 'export const featureValue = 2;\n',
    'src/legacy/old.ts': 'export const oldValue = 3;\n',
    'src/legacy/deep/nested.ts': 'export const nestedValue = 4;\n',
    'tests/app.test.ts': 'export const appTest = true;\n',
    'tests/helpers.ts': 'export const helperValue = 5;\n',
    'generated/schema.generated.ts': 'export const generatedSchema = true;\n',
    'generated/model.generated.ts': 'export const generatedModel = true;\n',
    'examples/demo.ts': 'export const demoValue = 6;\n',
    'docs/guide.ts': 'export const guideValue = 7;\n',
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  return repoDir;
}

function runCli(repoDir: string, args: string[]) {
  ensureDistTestsPackageJson();
  const child = spawnSync(process.execPath, [CLI_MAIN, 'analyze', repoDir, '--skip-git', '--skip-agents-md', ...args], {
    cwd: CORE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 120000,
  });
  if (child.status !== 0) {
    throw new Error(`analyze failed (${child.status})\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);
  }
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    metadata: loadMetadata(repoDir),
  };
}

async function scanRepo(repoDir: string, opts?: { skipFolders?: string[]; skipFiles?: string[] }) {
  const graph = createKnowledgeGraph();
  const context: PipelineContext = {
    workspaceRoot: repoDir,
    graph,
    filePaths: [],
    skipFolders: opts?.skipFolders,
    skipFiles: opts?.skipFiles,
  };

  const result = await runPipeline([scanPhase], context);
  assert.equal(result.success, true, 'scan phase should succeed');
  return context.filePaths
    .map((filePath) => path.relative(repoDir, filePath))
    .sort();
}

describe('CLI analyze exclusions', () => {
  it('supports --skip-folders with a single value', () => {
    const repoDir = mkRepo('skip-folder-single');
    const out = runCli(repoDir, ['--skip-folders', 'tests']);

    assert.equal(out.metadata?.stats.files, 8);
  });

  it('supports --skip-folders with comma-separated values', () => {
    const repoDir = mkRepo('skip-folder-comma');
    const out = runCli(repoDir, ['--skip-folders', 'tests,examples']);

    assert.equal(out.metadata?.stats.files, 7);
  });

  it('supports repeatable --skip-folders flags', () => {
    const repoDir = mkRepo('skip-folder-repeat');
    const out = runCli(repoDir, ['--skip-folders', 'tests', '--skip-folders', 'examples']);

    assert.equal(out.metadata?.stats.files, 7);
  });

  it('supports --skip-files glob patterns', () => {
    const repoDir = mkRepo('skip-files-glob');
    const out = runCli(repoDir, ['--skip-files', '*.generated.ts']);

    assert.equal(out.metadata?.stats.files, 8);
  });

  it('combines .codeintelignore, .codeintelignore.local, and CLI exclusions with union semantics', async () => {
    const repoDir = mkRepo('skip-union-layers');
    fs.writeFileSync(path.join(repoDir, '.codeintelignore'), 'src/legacy\n');
    fs.writeFileSync(path.join(repoDir, '.codeintelignore.local'), 'docs\n');

    const cliOut = runCli(repoDir, ['--skip-folders', 'tests', '--skip-files', '*.generated.ts']);
    assert.equal(cliOut.metadata?.stats.files, 3);

    const filePaths = await scanRepo(repoDir, {
      skipFolders: ['tests'],
      skipFiles: ['*.generated.ts'],
    });

    assert.deepEqual(filePaths, [
      'examples/demo.ts',
      'src/feature.ts',
      'src/index.ts',
    ]);
  });

  it('shows exclusion reasons in verbose output', () => {
    const repoDir = mkRepo('skip-verbose');
    const out = runCli(repoDir, ['--verbose', '--skip-folders', 'tests', '--skip-files', '*.generated.ts']);

    assert.match(out.stdout, /\[skip-dir\] tests \(pattern match\)/);
    assert.match(out.stdout, /\[skip-file\] generated\/schema\.generated\.ts \(pattern match\)/);
  });

  it('preserves backward compatibility for existing directory-name-only .codeintelignore files', async () => {
    const repoDir = mkRepo('skip-backcompat');
    fs.writeFileSync(path.join(repoDir, '.codeintelignore'), 'tests\ngenerated\n');

    const cliOut = runCli(repoDir, []);
    assert.equal(cliOut.metadata?.stats.files, 6);

    const filePaths = await scanRepo(repoDir);
    assert.equal(filePaths.includes('tests/app.test.ts'), false);
    assert.equal(filePaths.includes('generated/schema.generated.ts'), false);
    assert.equal(filePaths.includes('src/index.ts'), true);
    assert.equal(filePaths.includes('examples/demo.ts'), true);
  });
});
