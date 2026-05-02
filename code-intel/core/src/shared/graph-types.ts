export type NodeKind =
  | 'file'
  | 'directory'
  | 'function'
  | 'class'
  | 'interface'
  | 'method'
  | 'constructor'
  | 'variable'
  | 'property'
  | 'struct'
  | 'enum'
  | 'trait'
  | 'namespace'
  | 'module'
  | 'type_alias'
  | 'constant'
  | 'route'
  | 'cluster'
  | 'flow'
  | 'vulnerability';

export type EdgeKind =
  | 'contains'
  | 'calls'
  | 'imports'
  | 'extends'
  | 'implements'
  | 'has_member'
  | 'accesses'
  | 'overrides'
  | 'belongs_to'
  | 'step_of'
  | 'handles'
  | 'has_vulnerability';

export interface CodeNode {
  id: string;
  kind: NodeKind;
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  exported?: boolean;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface CodeEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  weight?: number;
  label?: string;
}
