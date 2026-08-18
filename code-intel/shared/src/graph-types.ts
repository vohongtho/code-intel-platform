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
  | 'has_vulnerability'
  | 'deprecated_use'
  | 'tested_by';

export type SecuritySignalType =
  | 'SQL_INJECTION'
  | 'XSS'
  | 'SSRF'
  | 'PATH_TRAVERSAL'
  | 'COMMAND_INJECTION';

export interface SecuritySignal {
  type: SecuritySignalType;
  sink: string;
  line: number;
  expression: string;
  source: string;
  language?: string;
  confidence?: number;
  tier: 'fixture-tested' | 'generic-heuristic';
  flags: {
    hasUserInput: boolean;
    isDynamic: boolean;
    hasStringConcat: boolean;
    hasTemplateInterpolation: boolean;
    isParameterized: boolean;
    hasSanitizer: boolean;
  };
}

export interface CodeNode {
  id: string;
  kind: NodeKind;
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  exported?: boolean;
  content?: string;
  metadata?: Record<string, unknown> & {
    securitySignals?: SecuritySignal[];
  };
}

export interface CodeEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  weight?: number;
  label?: string;
  metadata?: Record<string, unknown>;
}
