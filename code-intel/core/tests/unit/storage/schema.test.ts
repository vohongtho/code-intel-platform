import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_TABLE_MAP,
  ALL_NODE_TABLES,
  getCreateNodeTableDDL,
  getCreateEdgeTableDDL,
} from '../../../src/storage/schema.js';

describe('NODE_TABLE_MAP', () => {
  it('maps function to func_nodes', () => {
    assert.equal(NODE_TABLE_MAP['function'], 'func_nodes');
  });

  it('maps class to class_nodes', () => {
    assert.equal(NODE_TABLE_MAP['class'], 'class_nodes');
  });

  it('maps cluster to cluster_nodes', () => {
    assert.equal(NODE_TABLE_MAP['cluster'], 'cluster_nodes');
  });

  it('maps file to file_nodes', () => {
    assert.equal(NODE_TABLE_MAP['file'], 'file_nodes');
  });

  it('maps method to method_nodes', () => {
    assert.equal(NODE_TABLE_MAP['method'], 'method_nodes');
  });

  it('covers all NodeKind values', () => {
    const kinds = [
      'file', 'directory', 'function', 'class', 'interface', 'method',
      'constructor', 'variable', 'property', 'struct', 'enum', 'trait',
      'namespace', 'module', 'type_alias', 'constant', 'route', 'cluster', 'flow',
    ];
    for (const kind of kinds) {
      assert.ok(
        NODE_TABLE_MAP[kind as keyof typeof NODE_TABLE_MAP] !== undefined,
        `Missing mapping for ${kind}`,
      );
    }
  });
});

describe('ALL_NODE_TABLES', () => {
  it('is an array', () => {
    assert.ok(Array.isArray(ALL_NODE_TABLES));
  });

  it('has no duplicates', () => {
    const unique = new Set(ALL_NODE_TABLES);
    assert.equal(unique.size, ALL_NODE_TABLES.length);
  });

  it('includes func_nodes', () => {
    assert.ok(ALL_NODE_TABLES.includes('func_nodes'));
  });

  it('includes class_nodes', () => {
    assert.ok(ALL_NODE_TABLES.includes('class_nodes'));
  });
});

describe('getCreateNodeTableDDL', () => {
  it('returns a CREATE NODE TABLE statement', () => {
    const ddl = getCreateNodeTableDDL('func_nodes');
    assert.ok(ddl.includes('CREATE NODE TABLE'));
    assert.ok(ddl.includes('func_nodes'));
  });

  it('includes IF NOT EXISTS', () => {
    const ddl = getCreateNodeTableDDL('class_nodes');
    assert.ok(ddl.includes('IF NOT EXISTS'));
  });

  it('includes id field as PRIMARY KEY', () => {
    const ddl = getCreateNodeTableDDL('file_nodes');
    assert.ok(ddl.includes('id STRING'));
    assert.ok(ddl.includes('PRIMARY KEY (id)'));
  });

  it('includes name and file_path fields', () => {
    const ddl = getCreateNodeTableDDL('method_nodes');
    assert.ok(ddl.includes('name STRING'));
    assert.ok(ddl.includes('file_path STRING'));
  });

  it('includes start_line, end_line, exported fields', () => {
    const ddl = getCreateNodeTableDDL('var_nodes');
    assert.ok(ddl.includes('start_line'));
    assert.ok(ddl.includes('end_line'));
    assert.ok(ddl.includes('exported'));
  });
});

describe('getCreateEdgeTableDDL', () => {
  it('returns an array', () => {
    const ddls = getCreateEdgeTableDDL();
    assert.ok(Array.isArray(ddls));
    assert.ok(ddls.length > 0);
  });

  it('contains CREATE REL TABLE statement', () => {
    const ddls = getCreateEdgeTableDDL();
    assert.ok(ddls.some((d) => d.includes('CREATE REL TABLE')));
  });

  it('contains code_edges table name', () => {
    const ddls = getCreateEdgeTableDDL();
    assert.ok(ddls.some((d) => d.includes('code_edges')));
  });

  it('contains kind, weight, label fields', () => {
    const ddls = getCreateEdgeTableDDL();
    const combined = ddls.join('\n');
    assert.ok(combined.includes('kind'));
    assert.ok(combined.includes('weight'));
    assert.ok(combined.includes('label'));
  });

  it('contains FROM ... TO pairs for node tables', () => {
    const ddls = getCreateEdgeTableDDL();
    const combined = ddls.join('\n');
    assert.ok(combined.includes('FROM'));
    assert.ok(combined.includes('TO'));
  });
});
