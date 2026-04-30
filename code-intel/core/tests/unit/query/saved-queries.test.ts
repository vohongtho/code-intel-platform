import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveQuery,
  loadQuery,
  listQueries,
  deleteQuery,
  queryExists,
} from '../../../src/query/saved-queries.js';

let tmpDir: string;

describe('Saved Queries', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves a query and loads it back', () => {
    const gql = 'FIND function WHERE name CONTAINS "auth"';
    saveQuery(tmpDir, 'auth-search', gql);
    const loaded = loadQuery(tmpDir, 'auth-search');
    assert.equal(loaded, gql);
  });

  it('creates queries directory automatically', () => {
    const gql = 'FIND class';
    saveQuery(tmpDir, 'test', gql);
    const dir = path.join(tmpDir, '.code-intel', 'queries');
    assert.ok(fs.existsSync(dir));
  });

  it('returns null for nonexistent query', () => {
    const result = loadQuery(tmpDir, 'nonexistent');
    assert.equal(result, null);
  });

  it('lists saved queries', () => {
    saveQuery(tmpDir, 'query-a', 'FIND function');
    saveQuery(tmpDir, 'query-b', 'FIND class');
    const queries = listQueries(tmpDir);
    assert.equal(queries.length, 2);
    const names = queries.map((q) => q.name);
    assert.ok(names.includes('query-a'));
    assert.ok(names.includes('query-b'));
  });

  it('returns empty list when no queries', () => {
    const queries = listQueries(tmpDir);
    assert.deepEqual(queries, []);
  });

  it('returns empty list when directory does not exist', () => {
    const queries = listQueries('/nonexistent/path/that/does/not/exist');
    assert.deepEqual(queries, []);
  });

  it('deletes a saved query', () => {
    saveQuery(tmpDir, 'to-delete', 'FIND function');
    assert.ok(queryExists(tmpDir, 'to-delete'));
    const deleted = deleteQuery(tmpDir, 'to-delete');
    assert.ok(deleted);
    assert.ok(!queryExists(tmpDir, 'to-delete'));
    assert.equal(loadQuery(tmpDir, 'to-delete'), null);
  });

  it('returns false when deleting nonexistent query', () => {
    const deleted = deleteQuery(tmpDir, 'nonexistent');
    assert.ok(!deleted);
  });

  it('queryExists returns false for nonexistent', () => {
    assert.ok(!queryExists(tmpDir, 'nonexistent'));
  });

  it('queryExists returns true for existing', () => {
    saveQuery(tmpDir, 'my-query', 'FIND function');
    assert.ok(queryExists(tmpDir, 'my-query'));
  });

  it('query list includes content', () => {
    const gql = 'COUNT function GROUP BY cluster';
    saveQuery(tmpDir, 'count-query', gql);
    const queries = listQueries(tmpDir);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].content, gql);
    assert.equal(queries[0].name, 'count-query');
    assert.ok(queries[0].filePath.endsWith('.gql'));
    assert.ok(queries[0].savedAt);
  });

  it('save-list-run-delete lifecycle', () => {
    // Save
    saveQuery(tmpDir, 'lifecycle', 'FIND function LIMIT 10');
    // List
    const list1 = listQueries(tmpDir);
    assert.equal(list1.length, 1);
    // Run (load)
    const content = loadQuery(tmpDir, 'lifecycle');
    assert.equal(content, 'FIND function LIMIT 10');
    // Delete
    deleteQuery(tmpDir, 'lifecycle');
    // List again
    const list2 = listQueries(tmpDir);
    assert.equal(list2.length, 0);
  });

  it('overwrites existing query on save', () => {
    saveQuery(tmpDir, 'my-query', 'FIND function');
    saveQuery(tmpDir, 'my-query', 'FIND class');
    const loaded = loadQuery(tmpDir, 'my-query');
    assert.equal(loaded, 'FIND class');
    // Only one file
    const queries = listQueries(tmpDir);
    assert.equal(queries.length, 1);
  });
});
