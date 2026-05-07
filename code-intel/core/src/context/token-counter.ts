/**
 * token-counter.ts  — Part B, B.7.1
 *
 * Lightweight token estimator for English + code mix.
 * Within ~10% of GPT tokenizer for typical content.
 * Used by the context builder to enforce per-block token budgets.
 */

import type { ContextDocument } from './builder.js';

/**
 * Estimate the token count for a text string.
 *
 * Formula: ceil((words × 1.3 + chars × 0.25) / 2)
 * — more accurate than naive length/4 for mixed code+prose.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return Math.ceil((words * 1.3 + chars * 0.25) / 2);
}

export interface BlockTokens {
  summary: number;
  logic: number;
  relation: number;
  focusCode: number;
  total: number;
}

/**
 * Measure per-block token counts for a ContextDocument.
 * Used by CLI `--show-context` and the CI benchmark gate.
 */
export function measureBlocks(doc: ContextDocument): BlockTokens {
  const summary  = estimateTokens(doc.summary);
  const logic    = estimateTokens(doc.logic);
  const relation = estimateTokens(doc.relation);
  const focusCode = estimateTokens(doc.focusCode);
  return { summary, logic, relation, focusCode, total: summary + logic + relation + focusCode };
}
