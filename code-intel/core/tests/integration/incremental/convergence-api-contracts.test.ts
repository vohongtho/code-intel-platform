import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEvidenceStore } from '../../../src/evidence/store.js';
import { diffConvergenceSnapshots } from '../../../src/incremental/convergence-snapshot.js';
import {
  applyIncrementalEdit,
  buildInitialState,
  runFullRebuild,
  snapshotOf,
  type WorkspaceFiles,
} from './convergence-harness.js';

/**
 * Proves IncrementalAnalyze ≡ FullAnalyze (see convergence-snapshot.ts) also holds for
 * API-contract facts (HttpRouteFact/HttpRequestShapeFact/HttpResponseShapeFact/HttpConsumerFact
 * and their `route`/`api_shape`/`api_consumer` graph projection) across the exact edit
 * categories task 9.3 names: route rename, response-key removal, consumer URL change, file
 * move, and deletion. `buildConvergenceSnapshot` is generic over CodeNode/CodeEdge, so no
 * API-contract-specific comparison code is needed — only the harness needed to also run the
 * Express/fetch adapters (see convergence-harness.ts), which was the same gap task 9.1 fixed
 * for `classifySemanticFact`.
 */
function withEvidenceStore<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convergence-api-evidence-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertConverges(dir: string, fullEvidenceFiles: WorkspaceFiles, nextState: Parameters<typeof snapshotOf>[0]): void {
  const fullEvidence = createEvidenceStore(dir);
  const full = runFullRebuild(fullEvidenceFiles, fullEvidence);
  const incrementalSnap = snapshotOf(nextState, fullEvidence);
  const fullSnap = snapshotOf(full, fullEvidence);
  fullEvidence.close();
  assert.deepEqual(diffConvergenceSnapshots(fullSnap, incrementalSnap), []);
}

describe('dependency-aware incremental convergence — API contracts', () => {
  it('converges after a route rename (path changes, same handler)', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = {
        'app.js': [
          "const express = require('express');",
          'const app = express();',
          "app.get('/users/:id', getUser);",
          'function getUser(req, res) {',
          "  res.status(200).json({ id: req.params.id, name: 'x' });",
          '}',
        ].join('\n'),
      };
      const state = buildInitialState(files, initialEvidence);

      const edited: WorkspaceFiles = {
        'app.js': [
          "const express = require('express');",
          'const app = express();',
          "app.get('/accounts/:id', getUser);",
          'function getUser(req, res) {',
          "  res.status(200).json({ id: req.params.id, name: 'x' });",
          '}',
        ].join('\n'),
      };
      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, { changedFiles: edited });
      initialEvidence.close();
      assert.equal(delta.requiresFullResolution, false);
      assert.ok(delta.addedFacts.length > 0 || delta.changedFacts.length > 0);

      assertConverges(dir, edited, nextState);
    });
  });

  it('converges after removing a consumed response key', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = {
        'app.js': [
          "const express = require('express');",
          'const app = express();',
          "app.get('/users/:id', getUser);",
          'function getUser(req, res) {',
          "  res.status(200).json({ id: req.params.id, name: 'x', ssn: '000' });",
          '}',
        ].join('\n'),
      };
      const state = buildInitialState(files, initialEvidence);

      const edited: WorkspaceFiles = {
        'app.js': [
          "const express = require('express');",
          'const app = express();',
          "app.get('/users/:id', getUser);",
          'function getUser(req, res) {',
          "  res.status(200).json({ id: req.params.id, name: 'x' });",
          '}',
        ].join('\n'),
      };
      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, { changedFiles: edited });
      initialEvidence.close();
      assert.equal(delta.requiresFullResolution, false);

      assertConverges(dir, edited, nextState);
    });
  });

  it('converges after a consumer changes which URL it calls', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = {
        'client.js': [
          'async function loadUser(id) {',
          "  const response = await fetch(`/users/${id}`);",
          '  return response.json();',
          '}',
        ].join('\n'),
      };
      const state = buildInitialState(files, initialEvidence);

      const edited: WorkspaceFiles = {
        'client.js': [
          'async function loadUser(id) {',
          "  const response = await fetch(`/accounts/${id}`);",
          '  return response.json();',
          '}',
        ].join('\n'),
      };
      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, { changedFiles: edited });
      initialEvidence.close();
      assert.equal(delta.requiresFullResolution, false);

      assertConverges(dir, edited, nextState);
    });
  });

  it('converges after moving the route file to a new path', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const source = [
        "const express = require('express');",
        'const app = express();',
        "app.get('/users/:id', getUser);",
        'function getUser(req, res) {',
        "  res.status(200).json({ id: req.params.id });",
        '}',
      ].join('\n');
      const files: WorkspaceFiles = { 'src/app.js': source };
      const state = buildInitialState(files, initialEvidence);

      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, {
        deletedFiles: ['src/app.js'],
        changedFiles: { 'src/server/app.js': source },
      });
      initialEvidence.close();
      if (delta.requiresFullResolution) return; // acceptable fallback; nothing further to compare

      assertConverges(dir, { 'src/server/app.js': source }, nextState);
    });
  });

  it('converges after deleting a file that contained a route and its consumer', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = {
        'app.js': [
          "const express = require('express');",
          'const app = express();',
          "app.get('/users/:id', getUser);",
          'function getUser(req, res) {',
          "  res.status(200).json({ id: req.params.id });",
          '}',
        ].join('\n'),
        'client.js': [
          'async function loadUser(id) {',
          "  const response = await fetch(`/users/${id}`);",
          '  return response.json();',
          '}',
        ].join('\n'),
      };
      const state = buildInitialState(files, initialEvidence);

      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, { deletedFiles: ['app.js'] });
      initialEvidence.close();
      if (delta.requiresFullResolution) return; // acceptable fallback; nothing further to compare

      const remaining: WorkspaceFiles = { 'client.js': files['client.js']! };
      assertConverges(dir, remaining, nextState);
    });
  });
});
