import type { NodeKind } from '../shared/index.js';

export const NODE_TABLE_MAP: Record<NodeKind, string> = {
  file: 'file_nodes',
  directory: 'dir_nodes',
  function: 'func_nodes',
  class: 'class_nodes',
  interface: 'iface_nodes',
  method: 'method_nodes',
  constructor: 'ctor_nodes',
  variable: 'var_nodes',
  property: 'prop_nodes',
  struct: 'struct_nodes',
  enum: 'enum_nodes',
  trait: 'trait_nodes',
  namespace: 'ns_nodes',
  module: 'mod_nodes',
  type_alias: 'type_nodes',
  constant: 'const_nodes',
  route: 'route_nodes',
  cluster: 'cluster_nodes',
  flow: 'flow_nodes',
};

export const ALL_NODE_TABLES = [...new Set(Object.values(NODE_TABLE_MAP))];

export function getCreateNodeTableDDL(tableName: string): string {
  return `CREATE NODE TABLE IF NOT EXISTS ${tableName} (
  id STRING,
  name STRING,
  file_path STRING,
  start_line INT64,
  end_line INT64,
  exported BOOLEAN,
  content STRING,
  metadata STRING,
  PRIMARY KEY (id)
)`;
}

export function getCreateEdgeTableDDL(): string[] {
  const uniqueTables = ALL_NODE_TABLES;

  // Create edge table group connecting all node table pairs.
  // REL TABLE GROUP supports multiple FROM-TO pairs without duplicate errors,
  // and allows per-pair COPY: COPY code_edges FROM '...' (HEADER=TRUE, FROM='x', TO='y')
  const fromToPairs: string[] = [];
  for (const from of uniqueTables) {
    for (const to of uniqueTables) {
      fromToPairs.push(`FROM ${from} TO ${to}`);
    }
  }

  return [`CREATE REL TABLE GROUP IF NOT EXISTS code_edges (
  ${fromToPairs.join(',\n  ')},
  kind STRING,
  weight DOUBLE,
  label STRING
)`];
}
