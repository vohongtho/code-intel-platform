/**
 * cfg/validate.ts
 *
 * Structural validation for a built `FunctionCfg`: every block referenced
 * by an edge or by entry/exit must actually exist, and the
 * predecessor/successor relation must be exactly consistent in both
 * directions (spec: "validation that every referenced block exists and
 * entry/exit invariants hold").
 */
import type { FunctionCfg } from './contracts.js';

export interface CfgValidationResult {
  valid: boolean;
  errors: readonly string[];
}

export function validateFunctionCfg(cfg: FunctionCfg): CfgValidationResult {
  const errors: string[] = [];
  const blockIds = Object.keys(cfg.blocks);
  const blockIdSet = new Set(blockIds);

  const orderSet = new Set(cfg.order);
  if (orderSet.size !== cfg.order.length) errors.push('order contains duplicate block ids');
  if (orderSet.size !== blockIdSet.size || [...orderSet].some((id) => !blockIdSet.has(id))) {
    errors.push('order does not match the set of blocks exactly');
  }

  if (!blockIdSet.has(cfg.entryBlockId)) errors.push(`entryBlockId ${cfg.entryBlockId} is not a known block`);
  if (!blockIdSet.has(cfg.exitBlockId)) errors.push(`exitBlockId ${cfg.exitBlockId} is not a known block`);

  const expectedPredecessors = new Map<string, string[]>();
  for (const id of blockIds) expectedPredecessors.set(id, []);

  for (const [key, block] of Object.entries(cfg.blocks)) {
    if (block.id !== key) errors.push(`block key ${key} does not match its id ${block.id}`);
    if (block.functionId !== cfg.functionId) errors.push(`block ${key} has mismatched functionId`);

    const successorIdSet = new Set(block.successors.map((edge) => edge.targetBlockId));
    if (successorIdSet.size !== block.successors.length) {
      errors.push(`block ${key} has duplicate successor edges to the same target`);
    }
    for (const edge of block.successors) {
      if (!blockIdSet.has(edge.targetBlockId)) {
        errors.push(`block ${key} has an edge to unknown block ${edge.targetBlockId}`);
        continue;
      }
      expectedPredecessors.get(edge.targetBlockId)!.push(key);
    }
  }

  for (const [key, block] of Object.entries(cfg.blocks)) {
    const expected = (expectedPredecessors.get(key) ?? []).slice().sort((a, b) => a.localeCompare(b));
    const actual = block.predecessors.slice().sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      errors.push(`block ${key} predecessors do not match the reverse of recorded successor edges`);
    }
  }

  if (blockIdSet.has(cfg.exitBlockId) && cfg.blocks[cfg.exitBlockId]!.successors.length > 0) {
    errors.push(`exitBlockId ${cfg.exitBlockId} must not have outgoing edges`);
  }

  return { valid: errors.length === 0, errors };
}
