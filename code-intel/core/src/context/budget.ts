import { estimateTokens, type BlockTokens } from './token-counter.js';

export const MIN_CONTEXT_TOKENS = 128;
export const MAX_CONTEXT_TOKENS = 6000;
export const DEFAULT_CONTEXT_TOKENS = 6000;

export type ContextBlockName = 'summary' | 'logic' | 'relation' | 'focusCode';

export class ContextBudgetValidationError extends Error {
  readonly code = 'INVALID_CONTEXT_TOKEN_BUDGET';
  constructor(message: string) {
    super(message);
    this.name = 'ContextBudgetValidationError';
  }
}

export function normalizeContextTokenBudget(
  value: unknown,
  options: { strict?: boolean; defaultValue?: number } = {},
): number {
  const fallback = options.defaultValue ?? DEFAULT_CONTEXT_TOKENS;
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    if (options.strict) throw new ContextBudgetValidationError('maxTokens must be a finite integer');
    return fallback;
  }
  if (value < MIN_CONTEXT_TOKENS || value > MAX_CONTEXT_TOKENS) {
    if (options.strict) {
      throw new ContextBudgetValidationError(
        `maxTokens must be between ${MIN_CONTEXT_TOKENS} and ${MAX_CONTEXT_TOKENS}`,
      );
    }
    return Math.max(MIN_CONTEXT_TOKENS, Math.min(MAX_CONTEXT_TOKENS, value));
  }
  return value;
}

export function trimTextToTokenBudget(
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean } {
  if (!text || estimateTokens(text) <= maxTokens) return { text, truncated: false };
  if (maxTokens <= 0) return { text: '', truncated: true };
  const marker = '\n… [truncated]';
  if (estimateTokens(marker) >= maxTokens) return { text: '', truncated: true };
  let low = 0;
  let high = text.length;
  let best = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = text.slice(0, middle).replace(/[\s\n]+$/u, '') + marker;
    if (estimateTokens(candidate) <= maxTokens) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { text: best, truncated: true };
}

export function measureContextBlocks(blocks: Record<ContextBlockName, string>): BlockTokens {
  const summary = estimateTokens(blocks.summary);
  const logic = estimateTokens(blocks.logic);
  const relation = estimateTokens(blocks.relation);
  const focusCode = estimateTokens(blocks.focusCode);
  return { summary, logic, relation, focusCode, total: summary + logic + relation + focusCode };
}

export function enforceContextBudget(
  blocks: Record<ContextBlockName, string>,
  maxTokens: number,
  order: ContextBlockName[] = ['focusCode', 'relation', 'logic', 'summary'],
): { blocks: Record<ContextBlockName, string>; blockTokens: BlockTokens; truncatedBlocks: ContextBlockName[] } {
  const result = { ...blocks };
  const truncated = new Set<ContextBlockName>();
  let measured = measureContextBlocks(result);
  for (const block of order) {
    if (measured.total <= maxTokens) break;
    const allowance = Math.max(0, maxTokens - (measured.total - measured[block]));
    const trimmed = trimTextToTokenBudget(result[block], allowance);
    result[block] = trimmed.text;
    if (trimmed.truncated) truncated.add(block);
    measured = measureContextBlocks(result);
  }
  for (const block of [...order].reverse()) {
    while (result[block] && measured.total > maxTokens) {
      result[block] = result[block].slice(0, -8).replace(/[\s\n]+$/u, '');
      truncated.add(block);
      measured = measureContextBlocks(result);
    }
  }
  return { blocks: result, blockTokens: measured, truncatedBlocks: [...truncated].sort() };
}
