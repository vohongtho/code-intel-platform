import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectWorkspace } from '../../../src/multi-repo/workspace-detector.js';

// Create a temp dir for each test scenario
let tmpDir: string;
before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-')); });
after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('detectWorkspace', () => {
  it('npm workspaces glob → all packages discovered', async () => {
    const root = fs.mkdtempSync(path.join(tmpDir, 'npm-'));
    // Create package.json with workspaces
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'my-monorepo', workspaces: ['packages/*']
    }));
    // Create packages/api and packages/web
    const pkgApi = path.join(root, 'packages', 'api');
    const pkgWeb = path.join(root, 'packages', 'web');
    fs.mkdirSync(pkgApi, { recursive: true });
    fs.mkdirSync(pkgWeb, { recursive: true });
    fs.writeFileSync(path.join(pkgApi, 'package.json'), JSON.stringify({ name: '@my/api' }));
    fs.writeFileSync(path.join(pkgWeb, 'package.json'), JSON.stringify({ name: '@my/web' }));

    const ws = await detectWorkspace(root);
    assert.ok(ws);
    assert.equal(ws.type, 'npm');
    assert.equal(ws.packages.length, 2);
    assert.ok(ws.packages.some(p => p.name === '@my/api'));
    assert.ok(ws.packages.some(p => p.name === '@my/web'));
  });

  it('pnpm workspace → all packages discovered', async () => {
    const root = fs.mkdtempSync(path.join(tmpDir, 'pnpm-'));
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const pkgA = path.join(root, 'packages', 'alpha');
    fs.mkdirSync(pkgA, { recursive: true });
    fs.writeFileSync(path.join(pkgA, 'package.json'), JSON.stringify({ name: 'alpha' }));

    const ws = await detectWorkspace(root);
    assert.ok(ws);
    assert.equal(ws.type, 'pnpm');
    assert.ok(ws.packages.some(p => p.name === 'alpha'));
  });

  it('Nx workspace with project.json → projects discovered', async () => {
    const root = fs.mkdtempSync(path.join(tmpDir, 'nx-'));
    fs.writeFileSync(path.join(root, 'nx.json'), JSON.stringify({ version: 2 }));
    const appDir = path.join(root, 'apps', 'api');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'project.json'), JSON.stringify({ name: 'api-app' }));

    const ws = await detectWorkspace(root);
    assert.ok(ws);
    assert.equal(ws.type, 'nx');
    assert.ok(ws.packages.some(p => p.name === 'api-app'));
  });

  it('Turborepo → detected', async () => {
    const root = fs.mkdtempSync(path.join(tmpDir, 'turbo-'));
    fs.writeFileSync(path.join(root, 'turbo.json'), JSON.stringify({ pipeline: {} }));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'turbo-root', workspaces: ['apps/*']
    }));
    const app = path.join(root, 'apps', 'main');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'main-app' }));

    const ws = await detectWorkspace(root);
    assert.ok(ws);
    assert.equal(ws.type, 'turborepo');
  });

  it('non-monorepo directory → returns null', async () => {
    const root = fs.mkdtempSync(path.join(tmpDir, 'plain-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'plain-app' }));
    const ws = await detectWorkspace(root);
    assert.equal(ws, null);
  });
});
