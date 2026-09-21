/**
 * cfg/contracts.ts
 *
 * Per-function basic-block control-flow graph, built from the universal IR
 * (ir/contracts.ts) rather than any language-specific AST. Every function
 * gets an explicit entry block and a single explicit exit block; every
 * other block is reachable from entry only through recorded edges (a block
 * with zero predecessors represents source-level unreachable/dead code,
 * which is valid, not an error).
 */
import { generateIrNodeId } from '../contracts.js';

export type CfgEdgeKind =
  | 'normal'
  | 'true'
  | 'false'
  | 'loop-entry'
  | 'loop-back'
  | 'loop-exit'
  | 'case'
  | 'return'
  | 'throw'
  | 'exceptional'
  | 'finally'
  | 'break'
  | 'continue';

export interface CfgEdge {
  kind: CfgEdgeKind;
  targetBlockId: string;
}

export interface CfgBlock {
  id: string;
  functionId: string;
  /** IR statement ids in this block, straight-line (no internal control transfer); may be empty (e.g. the exit block, or an empty branch). */
  statementIds: readonly string[];
  /** Deterministic — edges are recorded in construction order. */
  successors: readonly CfgEdge[];
  /** Deterministic — block ids in the order they were discovered as a predecessor, by function-wide construction order. */
  predecessors: readonly string[];
}

export interface FunctionCfg {
  version: string;
  functionId: string;
  entryBlockId: string;
  exitBlockId: string;
  blocks: Readonly<Record<string, CfgBlock>>;
  /** Every block id, in construction order. */
  order: readonly string[];
  truncated: boolean;
  reason?: string;
}

export const CFG_VERSION = 'cfg-v1';

export function generateBlockId(functionArtifactId: string, localIndex: number): string {
  return generateIrNodeId(`${functionArtifactId}:block`, localIndex);
}
