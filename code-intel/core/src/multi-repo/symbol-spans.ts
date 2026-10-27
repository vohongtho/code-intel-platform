/**
 * symbol-spans.ts
 *
 * Resolves a source location to the function/method that encloses it, using
 * only nodes with a *real* line span (`endLine > startLine`). A symbol whose
 * span is only a declaration anchor is never used as a nearest-preceding
 * guess: cross-repository boundaries built on top of this must be exact or
 * stay unresolved.
 */

import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode } from '../shared/index.js';

const CONTAINER_KINDS = new Set(['function', 'method']);

export interface SymbolSpanIndex {
  /** filePath -> function/method nodes with real spans. */
  containersByFile: Map<string, CodeNode[]>;
  /** filePath -> every function/method node (anchor or span), sorted by startLine. */
  declarationsByFile: Map<string, CodeNode[]>;
}

export function buildSymbolSpanIndex(graph: KnowledgeGraph): SymbolSpanIndex {
  const containersByFile = new Map<string, CodeNode[]>();
  const declarationsByFile = new Map<string, CodeNode[]>();
  for (const node of graph.allNodes()) {
    if (!CONTAINER_KINDS.has(node.kind) || node.startLine === undefined) continue;
    const all = declarationsByFile.get(node.filePath) ?? [];
    all.push(node);
    declarationsByFile.set(node.filePath, all);
    if (node.endLine !== undefined && node.endLine > node.startLine) {
      const spans = containersByFile.get(node.filePath) ?? [];
      spans.push(node);
      containersByFile.set(node.filePath, spans);
    }
  }
  for (const list of declarationsByFile.values()) list.sort((a, b) => a.startLine! - b.startLine! || a.id.localeCompare(b.id));
  return { containersByFile, declarationsByFile };
}

/** Innermost function/method whose real line span contains `line`. */
export function enclosingSymbol(index: SymbolSpanIndex, filePath: string, line: number): CodeNode | undefined {
  let best: CodeNode | undefined;
  for (const candidate of index.containersByFile.get(filePath) ?? []) {
    if (candidate.startLine! > line || candidate.endLine! < line) continue;
    if (!best || candidate.startLine! > best.startLine! || (candidate.startLine === best.startLine && candidate.endLine! < best.endLine!)) best = candidate;
  }
  return best;
}

/**
 * The method a decorator on `line` applies to: the first declaration starting
 * after the decorator, within `maxGap` lines, whose name matches the method
 * name read from source (when given). Decorator stacks are allowed in between.
 */
export function decoratedSymbol(index: SymbolSpanIndex, filePath: string, line: number, expectedName?: string, maxGap = 6): CodeNode | undefined {
  for (const node of index.declarationsByFile.get(filePath) ?? []) {
    if (node.startLine! <= line) continue;
    if (node.startLine! - line > maxGap) return undefined;
    return !expectedName || node.name === expectedName ? node : undefined;
  }
  return undefined;
}

/** A unique function/method declared in `filePath` with this exact name. */
export function uniqueDeclarationNamed(index: SymbolSpanIndex, filePath: string, name: string): CodeNode | undefined {
  const matches = (index.declarationsByFile.get(filePath) ?? []).filter((node) => node.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

export function canonicalSymbolId(node: CodeNode): string {
  return node.identityId ?? node.id;
}
