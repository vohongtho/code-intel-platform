import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pythonWebFrameworkAdapter } from '../../../src/frameworks/adapters/python-web.js';

describe('python web framework adapter', () => {
  it('extracts FastAPI, Flask, and Django route facts plus FastAPI dependency facts', () => {
    const fastapi = [
      'from fastapi import FastAPI, Depends',
      'app = FastAPI()',
      'def get_db(): pass',
      '@app.get("/users")',
      'def list_users(db = Depends(get_db)):',
      '    return []',
    ].join('\n');
    const flask = [
      'from flask import Flask',
      'app = Flask(__name__)',
      '@app.route("/health", methods=["GET"])',
      'def health():',
      '    return "ok"',
    ].join('\n');
    const django = [
      'from django.urls import path',
      'urlpatterns = [',
      '    path("users/", users_view),',
      ']',
    ].join('\n');

    const detection = pythonWebFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['requirements.txt', 'fast.py'],
      fileCache: new Map([
        ['requirements.txt', 'fastapi\nflask\ndjango\n'],
        ['fast.py', fastapi],
      ]),
    });
    assert.equal(detection.exact, true);

    const bundle = pythonWebFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['fast.py', 'flask.py', 'urls.py'],
      fileCache: new Map([
        ['fast.py', fastapi],
        ['flask.py', flask],
        ['urls.py', django],
      ]),
    });

    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/users'));
    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/health'));
    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === 'users/'));
    assert.ok(bundle.facts.some((fact) => 'bindingKind' in fact && 'contractRef' in fact && fact.contractRef === 'get_db'));
  });
});
