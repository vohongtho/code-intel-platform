/**
 * cache/read-back.ts
 *
 * Verifies a cache entry's own internal structure before it is trusted as
 * a hit. `ir`/`cfg` artifacts get their dedicated structural validator
 * (ir/validate.ts, cfg/validate.ts); every other kind gets a minimal
 * shape check (an object carrying a boolean `truncated` field) — cheap
 * insurance against a corrupted or partially-written entry, not a
 * semantic re-verification of the analysis itself.
 */
import type { ProgramAnalysisArtifactKind } from '../contracts.js';
import { validateFunctionIr } from '../ir/validate.js';
import { validateFunctionCfg } from '../cfg/validate.js';
import type { FunctionIr } from '../ir/contracts.js';
import type { FunctionCfg } from '../cfg/contracts.js';

export interface ReadBackResult {
  valid: boolean;
  errors: readonly string[];
}

function hasTruncatedFlag(value: unknown): value is { truncated: boolean } {
  return typeof value === 'object' && value !== null && typeof (value as { truncated?: unknown }).truncated === 'boolean';
}

export function verifyReadBack(kind: ProgramAnalysisArtifactKind, value: unknown): ReadBackResult {
  if (kind === 'ir') return validateFunctionIr(value as FunctionIr);
  if (kind === 'cfg') return validateFunctionCfg(value as FunctionCfg);
  if (!hasTruncatedFlag(value)) return { valid: false, errors: [`artifact kind '${kind}' is missing a boolean truncated field`] };
  return { valid: true, errors: [] };
}
