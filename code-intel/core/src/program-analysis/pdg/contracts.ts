/**
 * pdg/contracts.ts
 *
 * A program dependence graph: statement nodes with control-dependence
 * edges (cfg/control-dependence.ts, lifted to statement granularity) and
 * data-dependence edges (dataflow/def-use.ts). Kept as its own artifact —
 * never materialized into the main symbol graph by default (spec:
 * "Detailed CFG/PDG artifacts MUST not explode the main graph by default").
 */
export type PdgEdgeKind = 'control' | 'data';

export interface PdgEdge {
  kind: PdgEdgeKind;
  /** The controlling statement (control edge) or the definition's statement (data edge). */
  fromStatementId: string;
  /** The dependent statement (control edge) or the use's statement (data edge). */
  toStatementId: string;
}

export interface ProgramDependenceGraph {
  version: string;
  functionId: string;
  /** Every statement id, sorted — present even if it has no edges. */
  statementIds: readonly string[];
  /** Sorted by (kind, from, to) for determinism. */
  edges: readonly PdgEdge[];
  truncated: boolean;
  reason?: string;
}

export const PDG_VERSION = 'pdg-v1';
